import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { syncQueuedActivity, type PhotoUploader } from '../offline-sync-core.ts';

type Err = { code?: string; message: string } | null;

/** Minimal in-memory stand-in for the Supabase client calls the sync uses. */
function fakeSb(opts: { insertFailsOnce?: boolean; pmError?: boolean } = {}) {
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
            eq: () => ({
              neq: async () => {
                pm.push({ table, patch });
                return { error: opts.pmError ? ({ message: 'pm failed' } as Err) : null };
              },
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
});
