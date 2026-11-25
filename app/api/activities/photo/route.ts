import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { getErrorMessage } from '@/lib/error-utils';
import {
  ACTIVITY_MEDIA_BUCKET,
  getActivityPhotoContentType,
  isValidActivityStoragePath,
} from '@/lib/activity-media';
import { buildPhotoCacheHeaders } from '@/lib/photo-proxy';

/**
 * Authenticated, org-scoped image proxy for private 'activity-media' field photos.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const storagePath = (searchParams.get('path') ?? '').trim();

    if (!isValidActivityStoragePath(storagePath)) {
      return NextResponse.json({ error: 'Invalid photo path' }, { status: 400 });
    }

    const me = await supabaseServer();
    const {
      data: { user },
    } = await me.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: prof } = await me
      .from('user_profiles')
      .select('organization_id, is_active')
      .eq('id', user.id)
      .maybeSingle();

    if (!prof || prof.is_active === false || !prof.organization_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const pathOrgId = storagePath.split('/')[0]?.toLowerCase() ?? '';
    if (pathOrgId !== String(prof.organization_id).toLowerCase()) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Verify row-level RLS visibility on daily_activities before serving or returning 304.
    const { data: primaryAct } = await me
      .from('daily_activities')
      .select('id, is_sample')
      .contains('photo_storage_paths', [storagePath])
      .limit(1)
      .maybeSingle();

    let actRow = primaryAct;
    if (!actRow) {
      const legacyProxyUrl = `/api/activities/photo?path=${storagePath}`;
      const { data: legacyAct } = await me
        .from('daily_activities')
        .select('id, is_sample')
        .contains('photo_urls', [legacyProxyUrl])
        .limit(1)
        .maybeSingle();
      actRow = legacyAct;
    }
    if (!actRow) {
      const encodedProxyUrl = `/api/activities/photo?path=${encodeURIComponent(storagePath)}`;
      if (encodedProxyUrl !== `/api/activities/photo?path=${storagePath}`) {
        const { data: encodedLegacyAct } = await me
          .from('daily_activities')
          .select('id, is_sample')
          .contains('photo_urls', [encodedProxyUrl])
          .limit(1)
          .maybeSingle();
        actRow = encodedLegacyAct;
      }
    }

    if (!actRow) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
    }

    const { etag, headers: cacheHeaders, cacheable } = buildPhotoCacheHeaders(
      storagePath,
      Boolean(actRow.is_sample),
    );
    if (cacheable && etag) {
      const ifNoneMatch = req.headers.get('if-none-match');
      if (ifNoneMatch && ifNoneMatch.split(',').some((tag) => tag.trim() === etag || tag.trim() === '*')) {
        return new NextResponse(null, { status: 304, headers: cacheHeaders });
      }
    }

    const { data: blob, error } = await me.storage
      .from(ACTIVITY_MEDIA_BUCKET)
      .download(storagePath);

    if (error || !blob) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
    }

    const buf = await blob.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': getActivityPhotoContentType(storagePath),
        ...cacheHeaders,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(err, 'Failed to load photo') },
      { status: 500 },
    );
  }
}
