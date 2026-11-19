import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { getErrorMessage } from '@/lib/error-utils';
import {
  ACTIVITY_MEDIA_BUCKET,
  getActivityPhotoContentType,
  isValidActivityStoragePath,
} from '@/lib/activity-media';

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
        'Cache-Control': 'private, max-age=300',
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
