import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';
import { getSupabaseEnv } from '@/lib/supabase/env';
import { getErrorMessage } from '@/lib/error-utils';
import { ACTIVITY_MEDIA_BUCKET, extractActivityStoragePath, isSamplePhotoPath, isStoragePathOwnedByOrg } from '@/lib/activity-media';
import { isPhotoPurgeEligible } from '@/lib/photo-retention';

function isAuthorizedBearer(header: string, secret: string): boolean {
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  const provided = Buffer.from(header, 'utf8');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

interface ActivityPhotoRow {
  id: string;
  organization_id: string | null;
  activity_type?: string | null;
  status?: string | null;
  photo_hold?: boolean | null;
  photo_storage_paths: unknown;
  photo_urls: unknown;
  photos_expires_at?: string | null;
  created_at?: string | null;
}

function collectMediaRowsAndPaths(rows: ActivityPhotoRow[], logPrefix: string) {
  const rowsWithMedia = rows.filter(
    (r) =>
      (Array.isArray(r.photo_storage_paths) && r.photo_storage_paths.length > 0) ||
      (Array.isArray(r.photo_urls) && r.photo_urls.length > 0),
  );
  const pathsByRow = new Map<string, string[]>();
  const allPathSet = new Set<string>();

  for (const row of rowsWithMedia) {
    const rowOrgId = typeof row.organization_id === 'string' ? row.organization_id : '';
    const pathSet = new Set<string>();
    const acceptPath = (candidate: string | null) => {
      if (!candidate) return;
      if (!rowOrgId || !isStoragePathOwnedByOrg(candidate, rowOrgId)) {
        console.warn(`${logPrefix} Skipped storage path outside row org (${rowOrgId || 'unknown'}): ${candidate}`);
        return;
      }
      pathSet.add(candidate);
      allPathSet.add(candidate);
    };
    if (Array.isArray(row.photo_storage_paths)) {
      for (const p of row.photo_storage_paths) {
        if (typeof p === 'string' && p.trim()) acceptPath(p.trim());
      }
    }
    if (Array.isArray(row.photo_urls)) {
      for (const u of row.photo_urls) {
        if (typeof u === 'string') acceptPath(extractActivityStoragePath(u));
      }
    }
    pathsByRow.set(row.id, [...pathSet]);
  }

  return { pathsByRow, allPaths: [...allPathSet] };
}

async function removeStoragePathsInChunks(db: SupabaseClient, allPaths: string[], logPrefix: string) {
  const failedPaths = new Set<string>();
  let filesRemoved = 0;
  for (let i = 0; i < allPaths.length; i += 100) {
    const chunk = allPaths.slice(i, i + 100);
    const { error: rmErr } = await db.storage.from(ACTIVITY_MEDIA_BUCKET).remove(chunk);
    if (rmErr) {
      console.error(`${logPrefix} Storage removal failed for ${chunk.length} file(s): ${rmErr.message}`);
      chunk.forEach((p) => failedPaths.add(p));
    } else {
      filesRemoved += chunk.length;
    }
  }
  return { failedPaths, filesRemoved };
}

const PHOTO_PURGE_BATCH = 100;
const PHOTO_PURGE_MAX_BATCHES = 50;

async function executePhotoPurge(db: SupabaseClient, orgId?: string) {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const cutoffIso = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();
  const ceilingIso = new Date(nowMs - 365 * 24 * 60 * 60 * 1000).toISOString();

  let purgedCount = 0;
  let filesRemoved = 0;
  // Rows whose Storage removal failed (or whose evidence is flagged/held under 365d) stay unpurged at the
  // front of the ordering; page past them so they cannot block newer rows.
  let skippedRows = 0;
  let heldOrFlaggedSkipped = 0;
  const allFailedPaths = new Set<string>();
  let hasMore = true;

  for (let batch = 0; hasMore && batch < PHOTO_PURGE_MAX_BATCHES; batch += 1) {
    let query = db
      .from('daily_activities')
      .select('id, organization_id, activity_type, status, photo_hold, photo_storage_paths, photo_urls, photos_expires_at, created_at')
      .is('photos_purged_at', null)
      .or(`photos_expires_at.lt.${nowIso},and(photos_expires_at.is.null,created_at.lt.${cutoffIso}),created_at.lt.${ceilingIso}`)
      // Only rows that still hold media. Photo-less rows are never marked purged, so without this filter
      // they accumulate, fill the response (PostgREST caps it) and hide the rows that do need purging.
      .or('photo_storage_paths.neq.{},photo_urls.neq.{}');

    if (orgId) {
      query = query.eq('organization_id', orgId);
    }

    const { data: expiredRows, error: fetchErr } = await query
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(skippedRows, skippedRows + PHOTO_PURGE_BATCH - 1);
    if (fetchErr) {
      return { error: fetchErr.message, status: 500 as const };
    }

    const fetched = (expiredRows ?? []) as ActivityPhotoRow[];
    // A server row cap below the batch size must not end the loop early, so stop only on an empty page.
    hasMore = fetched.length > 0;
    if (!hasMore) break;

    const eligibleRows = fetched.filter((r) => isPhotoPurgeEligible(r, nowMs));
    heldOrFlaggedSkipped += fetched.length - eligibleRows.length;
    if (eligibleRows.length === 0) {
      skippedRows += fetched.length;
      continue;
    }

    const { pathsByRow, allPaths } = collectMediaRowsAndPaths(eligibleRows, '[purge-photos]');

    // Only rows whose files were really removed may be marked purged. If a storage call fails, the
    // row keeps its paths so the next run retries; otherwise the files would be orphaned forever.
    const removal = await removeStoragePathsInChunks(db, allPaths, '[purge-photos]');
    filesRemoved += removal.filesRemoved;
    removal.failedPaths.forEach((p) => allFailedPaths.add(p));

    const idsToUpdate = [...pathsByRow.entries()]
      .filter(([, paths]) => paths.every((p) => !removal.failedPaths.has(p)))
      .map(([id]) => id);
    skippedRows += fetched.length - idsToUpdate.length;

    if (idsToUpdate.length === 0) continue;

    let updQuery = db
      .from('daily_activities')
      .update({
        photo_urls: [],
        photo_storage_paths: [],
        photos_purged_at: nowIso,
      })
      .in('id', idsToUpdate);

    if (orgId) {
      updQuery = updQuery.eq('organization_id', orgId);
    }

    // Count what the database really changed: an update filtered out by RLS succeeds with zero rows, and
    // those rows must be paged past instead of being fetched again.
    const { data: updated, error: updErr } = await updQuery.select('id');
    if (updErr) {
      return { error: updErr.message, status: 500 as const };
    }
    const updatedCount = updated?.length ?? 0;
    purgedCount += updatedCount;
    skippedRows += idsToUpdate.length - updatedCount;
  }

  if (purgedCount === 0 && allFailedPaths.size > 0) {
    return {
      error: `Storage removal failed for ${allFailedPaths.size} file(s); nothing marked purged`,
      status: 500 as const,
    };
  }

    return {
      purgedCount,
      filesRemoved,
      skippedRows,
      heldOrFlaggedSkipped,
      // True only when the per-run batch limit was reached with rows possibly still waiting.
      hasMore,
      status: 200 as const,
    };
}

const SAMPLE_QUEUE_BATCH = 500;

/**
 * Removes the Storage objects of already-deleted sample activities. purge_expired_sample_records() queues
 * each photo path in `sample_photo_cleanup` before it deletes the expired rows, so row deletion never
 * waits for this route; failed removals stay queued (attempts + last_error) and are retried next run.
 */
async function drainSamplePhotoQueue(db: SupabaseClient, orgId?: string) {
  let query = db
    .from('sample_photo_cleanup')
    .select('id, organization_id, storage_path, attempts')
    .order('queued_at', { ascending: true })
    .limit(SAMPLE_QUEUE_BATCH);
  if (orgId) query = query.eq('organization_id', orgId);

  const { data, error } = await query;
  if (error) {
    console.error(`[purge-samples] Failed to read sample photo queue: ${error.message}`);
    return { filesRemoved: 0, failedFiles: 0, queueError: true };
  }

  const rows = (data ?? []) as Array<{ id: string; organization_id: string; storage_path: string; attempts: number }>;
  if (rows.length === 0) return { filesRemoved: 0, failedFiles: 0, queueError: false };

  const removable: typeof rows = [];
  const invalidIds: string[] = [];
  for (const row of rows) {
    if (isStoragePathOwnedByOrg(row.storage_path, row.organization_id) && isSamplePhotoPath(row.storage_path)) {
      removable.push(row);
    } else {
      invalidIds.push(row.id); // can never be safely purged as a sample photo; drop instead of retrying forever
    }
  }
  if (invalidIds.length > 0) {
    console.warn(`[purge-samples] Dropping ${invalidIds.length} invalid or non-sample queued path(s)`);
    await db.from('sample_photo_cleanup').delete().in('id', invalidIds);
  }

  const { failedPaths, filesRemoved } = await removeStoragePathsInChunks(
    db,
    [...new Set(removable.map((r) => r.storage_path))],
    '[purge-samples]',
  );

  const doneIds = removable.filter((r) => !failedPaths.has(r.storage_path)).map((r) => r.id);
  const failedIds = removable.filter((r) => failedPaths.has(r.storage_path)).map((r) => r.id);
  if (doneIds.length > 0) {
    const { error: delErr } = await db.from('sample_photo_cleanup').delete().in('id', doneIds);
    if (delErr) console.error(`[purge-samples] Failed to clear processed queue rows: ${delErr.message}`);
  }
  for (const row of removable.filter((r) => failedIds.includes(r.id))) {
    await db
      .from('sample_photo_cleanup')
      .update({ attempts: row.attempts + 1, last_error: 'Storage removal failed' })
      .eq('id', row.id);
  }

  return { filesRemoved, failedFiles: failedPaths.size, queueError: false };
}

/**
 * Deletes expired 24h sample logs (rows go in SQL, independent of this route) and then removes the
 * photo files that were queued for them.
 */
async function executeSamplePurge(db: SupabaseClient, orgId?: string) {
  const { data: counts, error: rpcErr } = await db.rpc('purge_expired_sample_records');
  if (rpcErr) {
    console.error(`[purge-samples] purge_expired_sample_records RPC failed: ${rpcErr.message}`);
  }
  const drained = await drainSamplePhotoQueue(db, orgId);
  const row = (Array.isArray(counts) ? counts[0] : counts) as Record<string, unknown> | null | undefined;
  return { ...(row ?? {}), ...drained, rpcError: Boolean(rpcErr) };
}

/**
 * Scheduled cron endpoint (Vercel Cron) to purge expired >30-day photos across all organizations.
 */
export async function GET(req: Request) {
  try {
    const cronSecret = (process.env.CRON_SECRET ?? '').trim();
    const authHeader = req.headers.get('authorization') ?? '';
    if (!isAuthorizedBearer(authHeader, cronSecret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { url } = getSupabaseEnv();
    const secretKey = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
    if (!url || !secretKey) {
      return NextResponse.json({ error: 'Server secret key not configured' }, { status: 503 });
    }

    const db = createClient(url, secretKey, { auth: { persistSession: false } });
    // Also sweep expired shared route cache & rate-limit entries and 24h expired sample logs
    await db.rpc('purge_expired_route_compute_state').then(() => undefined, () => undefined);
    const samplesPurged = await executeSamplePurge(db);
    const res = await executePhotoPurge(db);
    if ('error' in res) {
      return NextResponse.json({ error: res.error }, { status: res.status });
    }
    const telemetryPiiRes = await db.rpc('purge_expired_telemetry_pii', { p_retention_days: 365 });
    if (telemetryPiiRes.error) {
      console.error(
        JSON.stringify({
          type: 'cron_pii_purge_failed',
          ts: new Date().toISOString(),
          error: telemetryPiiRes.error.message,
        }),
      );
      return NextResponse.json(
        {
          error: `Telemetry PII purge failed: ${telemetryPiiRes.error.message}`,
          purgedCount: res.purgedCount,
          filesRemoved: res.filesRemoved,
          skippedRows: res.skippedRows,
          heldOrFlaggedSkipped: res.heldOrFlaggedSkipped,
          hasMore: res.hasMore,
          samplesPurged,
        },
        { status: 500 },
      );
    }
    const telemetryRow = Array.isArray(telemetryPiiRes.data)
      ? (telemetryPiiRes.data[0] as { activities_scrubbed?: number; job_orders_scrubbed?: number } | undefined)
      : undefined;
    return NextResponse.json({
      purgedCount: res.purgedCount,
      filesRemoved: res.filesRemoved,
      skippedRows: res.skippedRows,
      heldOrFlaggedSkipped: res.heldOrFlaggedSkipped,
      hasMore: res.hasMore,
      samplesPurged,
      telemetryPiiPurged: telemetryRow ?? { activities_scrubbed: 0, job_orders_scrubbed: 0 },
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err, 'Cron purge failed') }, { status: 500 });
  }
}

/**
 * Manual supervisor trigger to purge expired >30-day photos for the current organization.
 */
export async function POST() {
  try {
    const me = await supabaseServer();
    const {
      data: { user },
    } = await me.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: prof } = await me
      .from('user_profiles')
      .select('role, organization_id, is_active')
      .eq('id', user.id)
      .maybeSingle();

    if (!prof || prof.is_active === false) {
      return NextResponse.json({ error: 'Inactive profile' }, { status: 403 });
    }
    if (!prof.organization_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!['admin', 'scheduler', 'manager'].includes(prof.role ?? '')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const orgId = prof.organization_id as string;
    const { url } = getSupabaseEnv();
    const secretKey = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
    const serviceDb = url && secretKey ? createClient(url, secretKey, { auth: { persistSession: false } }) : null;
    let samplesPurged: unknown = null;
    if (serviceDb) {
      await serviceDb.rpc('purge_expired_route_compute_state').then(() => undefined, () => undefined);
      samplesPurged = await executeSamplePurge(serviceDb, orgId);
    }
    const db = serviceDb ?? me;

    const res = await executePhotoPurge(db, orgId);
    if ('error' in res) {
      return NextResponse.json({ error: res.error }, { status: res.status });
    }
    return NextResponse.json({
      purgedCount: res.purgedCount,
      filesRemoved: res.filesRemoved,
      skippedRows: res.skippedRows,
      heldOrFlaggedSkipped: res.heldOrFlaggedSkipped,
      hasMore: res.hasMore,
      samplesPurged,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err, 'Purge failed') }, { status: 500 });
  }
}
