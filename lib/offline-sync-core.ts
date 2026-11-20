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
