import type { SupabaseClient } from '@supabase/supabase-js';

export type PhotoUploader = (
  sb: SupabaseClient,
  orgId: string,
  dataUrl: string,
  opts: { fileStem: string; requireStorage: true },
) => Promise<{ url: string; storagePath: string | null }>;

type Row = Record<string, unknown>;

export function newClientId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // RFC4122 v4 fallback for very old browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Determines whether a queued offline record belongs to the given signed-in user.
 * Prevents queued field logs/reports on a shared device from syncing under another user's session.
 */
export function isOwnedByUser(
  item: { ownerUserId?: string | null; payload?: Row },
  userId?: string | null,
): boolean {
  if (!userId) return true;
  if (typeof item.ownerUserId === 'string' && item.ownerUserId.trim()) {
    return item.ownerUserId === userId;
  }
  const payload = item.payload ?? {};
  const payloadOwner =
    (typeof payload.logged_by === 'string' && payload.logged_by.trim() ? payload.logged_by : null) ??
    (typeof payload.submitted_by === 'string' && payload.submitted_by.trim() ? payload.submitted_by : null);
  if (payloadOwner) {
    return payloadOwner === userId;
  }
  return true;
}

/**
 * Human-readable summary for a queued field activity item in the offline queue inspector.
 */
export function describeQueuedActivity(payload: Row): { title: string; subtitle: string } {
  const rawType = typeof payload.activity_type === 'string' ? payload.activity_type : 'field_activity';
  const typeLabel = rawType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const date = typeof payload.activity_date === 'string' ? payload.activity_date : '';
  const location =
    typeof payload.sub_site === 'string' && payload.sub_site.trim()
      ? payload.sub_site.trim()
      : typeof payload.location_note === 'string' && payload.location_note.trim()
        ? payload.location_note.trim()
        : '';
  const notes = typeof payload.notes === 'string' ? payload.notes.trim() : '';
  const subtitleParts = [date, location, notes ? notes.slice(0, 60) : ''].filter(Boolean);
  return {
    title: typeLabel,
    subtitle: subtitleParts.join(' · ') || 'Queued field log',
  };
}

/**
 * Human-readable summary for a queued accomplishment report in the offline queue inspector.
 */
export function describeQueuedReport(payload: Row, editingId: string | null): { title: string; subtitle: string } {
  const date = typeof payload.report_date === 'string' ? payload.report_date : '';
  const status = typeof payload.status === 'string' ? payload.status : 'draft';
  const entryCount = Array.isArray(payload.entries) ? payload.entries.length : 0;
  const action = editingId ? 'Update' : status === 'submitted' ? 'Submit' : 'Save draft';
  const subtitleParts = [
    date,
    entryCount > 0 ? `${entryCount} row${entryCount === 1 ? '' : 's'}` : '',
    status === 'submitted' ? 'Pending send to head' : 'Draft',
  ].filter(Boolean);
  return {
    title: `Shift Report (${action})`,
    subtitle: subtitleParts.join(' · ') || 'Queued shift report',
  };
}

/**
 * Pushes one queued field activity to the server so that retrying after ANY partial failure is safe:
 *  - the row carries a client-generated id, so a retry after a lost response hits the primary key
 *    (23505) and is treated as "already synced" instead of inserting a duplicate;
 *  - photos use deterministic file names (queueId + index), so a retry overwrites nothing and
 *    orphans nothing; an "already exists" storage error counts as success;
 *  - a photo that cannot be uploaded throws, so the item stays queued rather than saving a
 *    multi-megabyte base64 string into the database row.
 * Throws on any failure; the caller keeps the item queued.
 */
export async function syncQueuedActivity(
  sb: SupabaseClient,
  queueId: string,
  payload: Row,
  upload: PhotoUploader,
): Promise<Row> {
  const body: Row = { ...payload };
  if (typeof body.id !== 'string' || !body.id) body.id = newClientId();

  const orgId = typeof body.organization_id === 'string' ? body.organization_id : '';
  if (Array.isArray(body.photo_urls) && body.photo_urls.length > 0 && orgId) {
    const urls: string[] = [];
    const paths: string[] = Array.isArray(body.photo_storage_paths)
      ? body.photo_storage_paths.filter((p): p is string => typeof p === 'string')
      : [];
    let i = 0;
    for (const raw of body.photo_urls) {
      i += 1;
      if (typeof raw !== 'string') continue;
      if (raw.startsWith('data:image/')) {
        const up = await upload(sb, orgId, raw, { fileStem: `${queueId}-${i}`, requireStorage: true });
        urls.push(up.url);
        if (up.storagePath && !paths.includes(up.storagePath)) paths.push(up.storagePath);
      } else {
        urls.push(raw);
      }
    }
    body.photo_urls = urls;
    body.photo_storage_paths = paths;
  }

  const ins = await sb.from('daily_activities').insert(body).select('*').single();
  let row = ins.data as Row | null;
  if (ins.error) {
    if (ins.error.code === '23505') {
      const existing = await sb.from('daily_activities').select('*').eq('id', body.id as string).maybeSingle();
      if (existing.error || !existing.data) throw new Error(ins.error.message);
      row = existing.data as Row;
    } else {
      throw new Error(ins.error.message);
    }
  }
  if (!row) throw new Error('Activity was not saved');

  // Side effects are re-run on retry; they only move a task/job order forward, never duplicate rows.
  const pmTaskId = typeof payload.pm_task_id === 'string' ? payload.pm_task_id : null;
  if (pmTaskId) {
    const activityDate = typeof payload.activity_date === 'string' ? payload.activity_date : null;
    const notes = typeof payload.notes === 'string' ? payload.notes : '';
    const type = typeof payload.activity_type === 'string' ? payload.activity_type : 'activity';
    const r = await sb
      .from('pm_tasks')
      .update({ status: 'done', completed_at: activityDate, remarks: notes || `Synced from offline activity (${type})` })
      .eq('id', pmTaskId)
      .neq('status', 'done');
    if (r.error) throw new Error(r.error.message);
  }
  const jobOrderId = typeof payload.job_order_id === 'string' ? payload.job_order_id : null;
  if (jobOrderId) {
    const r = await sb
      .from('job_orders')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', jobOrderId)
      .neq('status', 'completed');
    if (r.error) throw new Error(r.error.message);
  }
  return row;
}

/**
 * Pushes one queued accomplishment report to the server idempotently:
 *  - new reports carry a client-generated UUID so a retry after a lost response hits 23505
 *    and resolves cleanly instead of creating duplicate shift reports;
 *  - edits target the existing editingId row directly.
 * Throws on any failure so the caller keeps the report queued and records the error.
 */
export async function syncQueuedReport(
  sb: SupabaseClient,
  editingId: string | null,
  payload: Row,
): Promise<Row> {
  if (editingId) {
    const { id: _dropId, ...patch } = payload;
    const upd = await sb.from('accomplishment_reports').update(patch).eq('id', editingId).select('*').single();
    if (upd.error || !upd.data) {
      throw new Error(upd.error?.message || 'Report update failed');
    }
    return upd.data as Row;
  }

  const body: Row = { ...payload };
  if (typeof body.id !== 'string' || !body.id) body.id = newClientId();

  const ins = await sb.from('accomplishment_reports').insert(body).select('*').single();
  let row = ins.data as Row | null;
  if (ins.error) {
    if (ins.error.code === '23505') {
      const existing = await sb
        .from('accomplishment_reports')
        .select('*')
        .eq('id', body.id as string)
        .maybeSingle();
      if (existing.error || !existing.data) throw new Error(ins.error.message);
      row = existing.data as Row;
    } else {
      throw new Error(ins.error.message);
    }
  }
  if (!row) throw new Error('Report was not saved');
  return row;
}
