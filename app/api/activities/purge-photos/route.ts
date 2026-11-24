import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';
import { getSupabaseEnv } from '@/lib/supabase/env';
import { getErrorMessage } from '@/lib/error-utils';
import { ACTIVITY_MEDIA_BUCKET, extractActivityStoragePath, isStoragePathOwnedByOrg } from '@/lib/activity-media';

function isAuthorizedBearer(header: string, secret: string): boolean {
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  const provided = Buffer.from(header, 'utf8');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

async function executePhotoPurge(db: SupabaseClient, orgId?: string) {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const cutoffIso = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();
  let query = db
    .from('daily_activities')
    .select('id, organization_id, photo_storage_paths, photo_urls')
    .is('photos_purged_at', null)
    .or(`photos_expires_at.lt.${nowIso},and(photos_expires_at.is.null,created_at.lt.${cutoffIso})`);

  if (orgId) {
    query = query.eq('organization_id', orgId);
  }

  const { data: expiredRows, error: fetchErr } = await query;
  if (fetchErr) {
    return { error: fetchErr.message, status: 500 as const };
  }

  const rowsWithMedia = (expiredRows ?? []).filter(
    (r) =>
      (Array.isArray(r.photo_storage_paths) && r.photo_storage_paths.length > 0) ||
      (Array.isArray(r.photo_urls) && r.photo_urls.length > 0),
  );

  if (rowsWithMedia.length === 0) {
    return { purgedCount: 0, filesRemoved: 0, status: 200 as const };
  }

  // Only rows whose files were really removed may be marked purged. If a storage call fails, the
  // row keeps its paths so the next run retries; otherwise the files would be orphaned forever.
  const pathsByRow = new Map<string, string[]>();
  const allPaths: string[] = [];
  for (const row of rowsWithMedia) {
    const rowOrgId = typeof row.organization_id === 'string' ? row.organization_id : '';
    const pathSet = new Set<string>();
    const acceptPath = (candidate: string | null) => {
      if (!candidate) return;
      if (!rowOrgId || !isStoragePathOwnedByOrg(candidate, rowOrgId)) {
        console.warn(`[purge-photos] Skipped storage path outside row org (${rowOrgId || 'unknown'}): ${candidate}`);
        return;
      }
      pathSet.add(candidate);
    };
    if (Array.isArray(row.photo_storage_paths)) {
      for (const p of row.photo_storage_paths) {
        if (typeof p === 'string' && p.trim()) acceptPath(p.trim());
      }
    }
    if (Array.isArray(row.photo_urls)) {
      for (const u of row.photo_urls) {
        if (typeof u === 'string') {
          acceptPath(extractActivityStoragePath(u));
        }
      }
    }
    const paths = [...pathSet];
    pathsByRow.set(row.id, paths);
    allPaths.push(...paths);
  }

  const failedPaths = new Set<string>();
  let filesRemoved = 0;
  for (let i = 0; i < allPaths.length; i += 100) {
    const chunk = allPaths.slice(i, i + 100);
    const { error: rmErr } = await db.storage.from(ACTIVITY_MEDIA_BUCKET).remove(chunk);
    if (rmErr) {
      chunk.forEach((p) => failedPaths.add(p));
    } else {
      filesRemoved += chunk.length;
    }
  }

  const idsToUpdate = [...pathsByRow.entries()]
    .filter(([, paths]) => paths.every((p) => !failedPaths.has(p)))
    .map(([id]) => id);

  if (idsToUpdate.length === 0) {
    return {
      error: `Storage removal failed for ${failedPaths.size} file(s); nothing marked purged`,
      status: 500 as const,
    };
  }

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

  const { error: updErr } = await updQuery;
  if (updErr) {
    return { error: updErr.message, status: 500 as const };
  }

  return {
    purgedCount: idsToUpdate.length,
    filesRemoved,
    status: 200 as const,
  };
}

async function executeSamplePurge(db: SupabaseClient) {
  const nowIso = new Date().toISOString();
  const { data: expiredSamples, error: fetchErr } = await db
    .from('daily_activities')
    .select('id, organization_id, photo_storage_paths, photo_urls')
    .eq('is_sample', true)
    .lte('sample_expires_at', nowIso);

  if (!fetchErr && Array.isArray(expiredSamples) && expiredSamples.length > 0) {
    const samplePaths = new Set<string>();
    for (const row of expiredSamples) {
      const rowOrgId = typeof row.organization_id === 'string' ? row.organization_id : '';
      const accept = (candidate: string | null) => {
        if (candidate && rowOrgId && isStoragePathOwnedByOrg(candidate, rowOrgId)) {
          samplePaths.add(candidate);
        }
      };
      if (Array.isArray(row.photo_storage_paths)) {
        for (const p of row.photo_storage_paths) {
          if (typeof p === 'string' && p.trim()) accept(p.trim());
        }
      }
      if (Array.isArray(row.photo_urls)) {
        for (const u of row.photo_urls) {
          if (typeof u === 'string') accept(extractActivityStoragePath(u));
        }
      }
    }
    const pathList = [...samplePaths];
    for (let i = 0; i < pathList.length; i += 100) {
      await db.storage.from(ACTIVITY_MEDIA_BUCKET).remove(pathList.slice(i, i + 100));
    }
  }

  const { data: counts, error: rpcErr } = await db.rpc('purge_expired_sample_records');
  if (rpcErr) {
    return null;
  }
  const row = Array.isArray(counts) ? counts[0] : counts;
  return row ?? null;
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
    return NextResponse.json({ purgedCount: res.purgedCount, filesRemoved: res.filesRemoved, samplesPurged });
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
      samplesPurged = await executeSamplePurge(serviceDb);
    }
    const db = serviceDb ?? me;

    const res = await executePhotoPurge(db, orgId);
    if ('error' in res) {
      return NextResponse.json({ error: res.error }, { status: res.status });
    }
    return NextResponse.json({ purgedCount: res.purgedCount, filesRemoved: res.filesRemoved, samplesPurged });
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err, 'Purge failed') }, { status: 500 });
  }
}
