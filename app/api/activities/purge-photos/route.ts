import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';
import { getSupabaseEnv } from '@/lib/supabase/env';

/**
 * Purges expired activity photos (past photos_expires_at and not yet purged)
 * from the Supabase Storage 'activity-media' bucket while keeping activity text/telemetry intact.
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
    if (!['admin', 'scheduler', 'manager', 'operator'].includes(prof.role ?? '')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const orgId = prof.organization_id as string;
    const nowIso = new Date().toISOString();

    const { url } = getSupabaseEnv();
    const secretKey = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
    const db = url && secretKey ? createClient(url, secretKey, { auth: { persistSession: false } }) : me;

    const { data: expiredRows, error: fetchErr } = await db
      .from('daily_activities')
      .select('id, photo_storage_paths')
      .eq('organization_id', orgId)
      .lt('photos_expires_at', nowIso)
      .is('photos_purged_at', null);

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    if (!expiredRows || expiredRows.length === 0) {
      return NextResponse.json({ purgedCount: 0, filesRemoved: 0 });
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

    const { error: updErr } = await db
      .from('daily_activities')
      .update({
        photo_urls: [],
        photo_storage_paths: [],
        photos_purged_at: nowIso,
      })
      .in('id', idsToUpdate)
      .eq('organization_id', orgId);

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    return NextResponse.json({
      purgedCount: idsToUpdate.length,
      filesRemoved,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Purge failed' }, { status: 500 });
  }
}
