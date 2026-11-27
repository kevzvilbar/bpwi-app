import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { SlidingWindowRateLimiter } from '@/lib/route-compute-guard';
import { MAX_TELEMETRY_BYTES, sanitizeClientTelemetryPayload } from '@/lib/client-telemetry';

// Best-effort, per-serverless-instance throttle: acceptable for this authenticated, log-only endpoint
// that never writes to the database; do not reuse this pattern to protect anything that mutates data.
const userTelemetryLimiter = new SlidingWindowRateLimiter({ limit: 20, windowMs: 60_000 });

/**
 * Receives bounded client-side offline sync / route-compute error diagnostics and emits structured JSON logs.
 */
export async function POST(req: Request) {
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

  if (!userTelemetryLimiter.check(user.id).allowed) {
    return new NextResponse(null, { status: 204 });
  }

  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_TELEMETRY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  let rawText = '';
  try {
    rawText = await req.text();
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  if (Buffer.byteLength(rawText, 'utf8') > MAX_TELEMETRY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const sanitized = sanitizeClientTelemetryPayload(parsed);
  if (!sanitized) {
    return new NextResponse(null, { status: 400 });
  }

  console.error(
    JSON.stringify({
      type: 'client_telemetry',
      ts: new Date().toISOString(),
      orgId: prof.organization_id,
      userId: user.id,
      ...sanitized,
    }),
  );

  return new NextResponse(null, { status: 204 });
}
