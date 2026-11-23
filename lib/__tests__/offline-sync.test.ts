import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeQueuedActivity,
  describeQueuedReport,
  isOwnedByUser,
  syncQueuedActivity,
  syncQueuedReport,
  type PhotoUploader,
} from '../offline-sync-core.ts';

type Err = { code?: string; message: string } | null;

/** Minimal in-memory stand-in for the Supabase client calls the sync uses. */
function fakeSb(opts: { insertFailsOnce?: boolean; pmError?: boolean; updateError?: boolean } = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  const pm: Record<string, unknown>[] = [];
  let insertCalls = 0;
  let failNext = Boolean(opts.insertFailsOnce);
  const sb = {
    from(table: string) {
      return {
        insert(body: Record<string, unknown>) {
          return {
            select: () => ({
              single: async () => {
                insertCalls += 1;
                if (failNext) {
                  failNext = false;
                  // the write landed but the response was lost -> client sees a network error
                  rows.set(body.id as string, body);
                  return { data: null, error: { message: 'network' } as Err };
                }
                if (rows.has(body.id as string)) {
                  return { data: null, error: { code: '23505', message: 'duplicate key' } as Err };
                }
                rows.set(body.id as string, body);
                return { data: body, error: null as Err };
              },
            }),
          };
        },
        select: () => ({
          eq: (_c: string, id: string) => ({
            maybeSingle: async () => ({ data: rows.get(id) ?? null, error: null as Err }),
          }),
        }),
        update(patch: Record<string, unknown>) {
          return {
            eq: (_c: string, id?: string) => ({
              neq: async () => {
                pm.push({ table, patch });
                return { error: opts.pmError ? ({ message: 'pm failed' } as Err) : null };
              },
              select: () => ({
                single: async () => {
                  if (opts.updateError) {
                    return { data: null, error: { message: 'update denied' } as Err };
                  }
                  const updated = { ...(rows.get(id ?? '') ?? {}), ...patch, id };
                  if (id) rows.set(id, updated);
                  return { data: updated, error: null as Err };
                },
              }),
            }),
          };
        },
      };
    },
  };
  return { sb: sb as never, rows, pm, insertCount: () => insertCalls };
}

const okUpload: PhotoUploader = async (_sb, org, _d, o) => ({
  url: `/api/activities/photo?path=${org}/2026-11-20/${o.fileStem}.webp`,
  storagePath: `${org}/2026-11-20/${o.fileStem}.webp`,
});

const payload = () => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', organization_id: 'org1', notes: 'x', photo_urls: [] as string[] });

describe('offline activity sync is idempotent', () => {
  it('a retry after a lost response does not create a duplicate row', async () => {
    const f = fakeSb({ insertFailsOnce: true });
    await assert.rejects(() => syncQueuedActivity(f.sb, 'q-1', payload(), okUpload), /network/);
    const row = await syncQueuedActivity(f.sb, 'q-1', payload(), okUpload);
    assert.equal(f.rows.size, 1);
    assert.equal(row.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  it('generates an id when a legacy queued item has none', async () => {
    const f = fakeSb();
    const { id: _drop, ...legacy } = payload();
    const row = await syncQueuedActivity(f.sb, 'q-2', legacy, okUpload);
    assert.match(String(row.id), /^[0-9a-f-]{36}$/);
  });

  it('uses deterministic photo names so retries do not orphan files', async () => {
    const f = fakeSb();
    const p = { ...payload(), photo_urls: ['data:image/webp;base64,AAA', 'https://x/y.jpg', 'data:image/png;base64,BBB'] };
    const row = await syncQueuedActivity(f.sb, 'q-3', p, okUpload);
    assert.deepEqual(row.photo_storage_paths, ['org1/2026-11-20/q-3-1.webp', 'org1/2026-11-20/q-3-3.webp']);
    assert.equal((row.photo_urls as string[])[1], 'https://x/y.jpg');
  });

  it('keeps the item queued (throws) instead of storing base64 when a photo cannot upload', async () => {
    const f = fakeSb();
    const bad: PhotoUploader = async () => {
      throw new Error('Photo upload failed');
    };
    const p = { ...payload(), photo_urls: ['data:image/webp;base64,AAA'] };
    await assert.rejects(() => syncQueuedActivity(f.sb, 'q-4', p, bad), /Photo upload failed/);
    assert.equal(f.rows.size, 0);
  });

  it('a failing task update surfaces, and the retry still does not duplicate the activity', async () => {
    const f = fakeSb({ pmError: true });
    const p = { ...payload(), pm_task_id: 't1', activity_date: '2026-11-20' };
    await assert.rejects(() => syncQueuedActivity(f.sb, 'q-5', p, okUpload), /pm failed/);
    await assert.rejects(() => syncQueuedActivity(f.sb, 'q-5', p, okUpload), /pm failed/);
    assert.equal(f.rows.size, 1);
  });

  it('writes lead and crew operators into completed_by_operator_ids when syncing a linked PM activity', async () => {
    const f = fakeSb();
    const p = {
      ...payload(),
      pm_task_id: 'pm-sub-1',
      activity_date: '2026-11-20',
      lead_operator_id: 'op-sub',
      crew_operator_ids: ['op-helper', 'op-sub'],
    };
    await syncQueuedActivity(f.sb, 'q-6', p, okUpload);
    assert.equal(f.pm.length, 1);
    assert.deepEqual(f.pm[0].patch, {
      status: 'done',
      completed_at: '2026-11-20',
      remarks: 'x',
      completed_by_operator_ids: ['op-sub', 'op-helper'],
    });
  });
});

describe('offline accomplishment report sync is idempotent', () => {
  const reportPayload = () => ({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    organization_id: 'org1',
    report_date: '2026-11-20',
    status: 'submitted',
    entries: [{ activity: 'Flush line' }],
  });

  it('recovers cleanly on 23505 retry after a lost insert response without duplicating', async () => {
    const f = fakeSb({ insertFailsOnce: true });
    await assert.rejects(() => syncQueuedReport(f.sb, null, reportPayload()), /network/);
    const row = await syncQueuedReport(f.sb, null, reportPayload());
    assert.equal(f.rows.size, 1);
    assert.equal(row.id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  });

  it('generates a client UUID when a legacy queued report has no id', async () => {
    const f = fakeSb();
    const { id: _drop, ...legacy } = reportPayload();
    const row = await syncQueuedReport(f.sb, null, legacy);
    assert.match(String(row.id), /^[0-9a-f-]{36}$/);
  });

  it('updates an existing report when editingId is set and throws on RLS failure', async () => {
    const f = fakeSb();
    const row = await syncQueuedReport(f.sb, 'rep-existing-1', reportPayload());
    assert.equal(row.id, 'rep-existing-1');
    assert.equal(row.status, 'submitted');

    const failSb = fakeSb({ updateError: true });
    await assert.rejects(() => syncQueuedReport(failSb.sb, 'rep-existing-1', reportPayload()), /update denied/);
  });
});

describe('offline queue user ownership scoping and descriptions', () => {
  it('isolates queued items by ownerUserId and payload fallback', () => {
    assert.equal(isOwnedByUser({ ownerUserId: 'user-a' }, 'user-a'), true);
    assert.equal(isOwnedByUser({ ownerUserId: 'user-a' }, 'user-b'), false);
    assert.equal(isOwnedByUser({ payload: { logged_by: 'user-a' } }, 'user-a'), true);
    assert.equal(isOwnedByUser({ payload: { logged_by: 'user-a' } }, 'user-b'), false);
    assert.equal(isOwnedByUser({ payload: { submitted_by: 'user-a' } }, 'user-b'), false);
    assert.equal(isOwnedByUser({ payload: {} }, 'user-b'), true);
    assert.equal(isOwnedByUser({ ownerUserId: 'user-a' }, undefined), true);
  });

  it('formats readable queue summaries for activities and reports', () => {
    const act = describeQueuedActivity({
      activity_type: 'pump_monitoring',
      activity_date: '2026-11-20',
      sub_site: 'Pavia PS1',
      notes: 'Checked pressure',
    });
    assert.equal(act.title, 'Pump Monitoring');
    assert.equal(act.subtitle, '2026-11-20 · Pavia PS1 · Checked pressure');

    const rep = describeQueuedReport(
      { report_date: '2026-11-20', status: 'submitted', entries: [{}, {}] },
      null,
    );
    assert.equal(rep.title, 'Shift Report (Submit)');
    assert.equal(rep.subtitle, '2026-11-20 · 2 rows · Pending send to head');
  });
});
