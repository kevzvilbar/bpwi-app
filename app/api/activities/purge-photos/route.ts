import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';
import { getSupabaseEnv } from '@/lib/supabase/env';

async function executePhotoPurge(db: SupabaseClient, orgId?: string) {
  const nowIso = new Date().toISOString();
  let query = db
    .from('daily_activities')
    .select('id, photo_storage_paths')
    .lt('photos_expires_at', nowIso)
    .is('photos_purged_at', null);

  if (orgId) {
    query = query.eq('organization_id', orgId);
  }

  const { data: expiredRows, error: fetchErr } = await query;
  if (fetchErr) {
    return { error: fetchErr.message, status: 500 as const };
  }

  if (!expiredRows || expiredRows.length === 0) {
    return { purgedCount: 0, filesRemoved: 0, status: 200 as const };
  }

  const allPaths: string[] = [];
  const idsToUpdate: string[] = [];
  for (const row of expiredRows) {
    idsToUpdate.push(row.id);
    if (Array.isArray(row.photo_storage_paths)) {
      for (const p of row.photo_storage_paths) {
        if (typeof p === 'string' && p.trim()) {
          allPaths.push(p.trim());
        }
      }
    }
  }

  let filesRemoved = 0;
  if (allPaths.length > 0) {
    for (let i = 0; i < allPaths.length; i += 100) {
      const chunk = allPaths.slice(i, i + 100);
      const { error: rmErr } = await db.storage.from('activity-media').remove(chunk);
      if (!rmErr) {
        filesRemoved += chunk.length;
      }
    }
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

/**
 * Scheduled cron endpoint (Vercel Cron) to purge expired >30-day photos across all organizations.
 */
export async function GET(req: Request) {
  try {
    const cronSecret = (process.env.CRON_SECRET ?? '').trim();
    const authHeader = req.headers.get('authorization') ?? '';
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { url } = getSupabaseEnv();
    const secretKey = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
    if (!url || !secretKey) {
      return NextResponse.json({ error: 'Server secret key not configured' }, { status: 503 });
    }

    const db = createClient(url, secretKey, { auth: { persistSession: false } });
    const res = await executePhotoPurge(db);
    if ('error' in res) {
      return NextResponse.json({ error: res.error }, { status: res.status });
    }
    return NextResponse.json({ purgedCount: res.purgedCount, filesRemoved: res.filesRemoved });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Cron purge failed' }, { status: 500 });
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
    const db = url && secretKey ? createClient(url, secretKey, { auth: { persistSession: false } }) : me;

    const res = await executePhotoPurge(db, orgId);
    if ('error' in res) {
      return NextResponse.json({ error: res.error }, { status: res.status });
    }
    return NextResponse.json({ purgedCount: res.purgedCount, filesRemoved: res.filesRemoved });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Purge failed' }, { status: 500 });
  }
}
