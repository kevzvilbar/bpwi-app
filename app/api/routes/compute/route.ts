import { NextRequest, NextResponse } from 'next/server';
import { getAuthProfile } from '@/lib/profile';
import {
  RouteResultCache,
  SlidingWindowRateLimiter,
  resolveRoutingPolicy,
  shouldUseRemainingBudget,
} from '@/lib/route-compute-guard';
import {
  buildRouteCacheKey,
  buildStraightLineRoute,
  chunkRouteWaypoints,
  compressConsecutiveDuplicateStops,
  expandCompressedLegs,
  formatOsrmCoordinates,
  getOsrmEndpoints,
  haversineMeters,
  isValidCoordinate,
  type LatLng,
  type RouteLegEstimate,
  type RouteTravelMode,
} from '@/lib/route-footprints';

export const maxDuration = 20;

const ALLOWED_MODES = new Set<RouteTravelMode>(['DRIVE', 'TWO_WHEELER', 'WALK']);
const REQUEST_BUDGET_MS = 12_000;
const ATTEMPT_TIMEOUT_MS = 4_500;

const totalLimiter = new SlidingWindowRateLimiter({ limit: 60, windowMs: 5 * 60_000 });
const upstreamLimiter = new SlidingWindowRateLimiter({ limit: 20, windowMs: 5 * 60_000 });
const routeCache = new RouteResultCache<{
  routedLegs: RouteLegEstimate[];
  encodedPolylines: string[];
}>({ maxEntries: 300, ttlMs: 30 * 60_000 });

type ComputeRequestBody = {
  stops?: Array<{ lat?: unknown; lng?: unknown }>;
  travelMode?: unknown;
};

type OsrmRouteLeg = {
  distance?: number;
  duration?: number;
};

type OsrmRoute = {
  distance?: number;
  duration?: number;
  geometry?: string;
  legs?: OsrmRouteLeg[];
};

type OsrmResponse = {
  code?: string;
  message?: string;
  routes?: OsrmRoute[];
};

export async function POST(req: NextRequest) {
  const profile = await getAuthProfile();
  if (!profile.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!profile.isActive) {
    return NextResponse.json({ error: 'Account pending approval' }, { status: 403 });
  }

  const totalRate = totalLimiter.check(profile.user.id);
  if (!totalRate.allowed) {
    return NextResponse.json(
      { error: 'Too many route calculations. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': String(totalRate.retryAfterSeconds) } },
    );
  }

  let body: ComputeRequestBody;
  try {
    body = (await req.json()) as ComputeRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
  }

  const rawStops = Array.isArray(body.stops) ? body.stops : [];
  if (rawStops.length < 2) {
    return NextResponse.json({ error: 'At least 2 GPS stops are required to compute a route' }, { status: 400 });
  }
  if (rawStops.length > 60) {
    return NextResponse.json({ error: 'Maximum 60 stops per route calculation' }, { status: 400 });
  }

  const stops: LatLng[] = [];
  for (const s of rawStops) {
    if (!isValidCoordinate(s?.lat, s?.lng)) {
      return NextResponse.json({ error: 'One or more GPS coordinates are invalid' }, { status: 400 });
    }
    stops.push({ lat: s.lat, lng: s.lng as number });
  }

  const requestedMode =
    typeof body.travelMode === 'string'
      ? (body.travelMode.toUpperCase() as RouteTravelMode)
      : 'DRIVE';
  const travelMode: RouteTravelMode = ALLOWED_MODES.has(requestedMode) ? requestedMode : 'DRIVE';

  const { uniqueStops, legMap } = compressConsecutiveDuplicateStops(stops);
  if (uniqueStops.length < 2) {
    return NextResponse.json({
      source: 'osrm',
      totalDistanceMeters: 0,
      totalDurationSeconds: 0,
      legs: stops.slice(1).map(() => ({ distanceMeters: 0, durationSeconds: 0 })),
      encodedPolylines: [],
      travelMode,
    });
  }

  const policy = resolveRoutingPolicy({
    osrmBaseUrl: process.env.OSRM_BASE_URL,
    allowPublicFallback: process.env.ALLOW_PUBLIC_OSRM_FALLBACK,
    nodeEnv: process.env.NODE_ENV,
  });
  const endpoints = getOsrmEndpoints(travelMode, policy.customBaseUrl, policy.allowPublicFallback);

  if (endpoints.length === 0) {
    const fallback = buildStraightLineRoute(stops);
    return NextResponse.json({
      source: 'straight-line',
      fallbackReason: 'Road routing server is not configured (set OSRM_BASE_URL to a self-hosted OSRM instance).',
      totalDistanceMeters: fallback.totalDistanceMeters,
      totalDurationSeconds: 0,
      legs: fallback.legs,
      encodedPolylines: [],
      travelMode,
    });
  }

  const cacheKey = `${endpoints.join(',')}::${buildRouteCacheKey(uniqueStops, travelMode)}`;
  const cached = routeCache.get(cacheKey);
  if (cached) {
    const legs = expandCompressedLegs(legMap, cached.routedLegs, stops);
    return NextResponse.json(
      {
        source: 'osrm',
        cached: true,
        totalDistanceMeters: legs.reduce((sum, l) => sum + l.distanceMeters, 0),
        totalDurationSeconds: legs.reduce((sum, l) => sum + l.durationSeconds, 0),
        legs,
        encodedPolylines: cached.encodedPolylines,
        travelMode,
      },
      { headers: { 'X-Route-Cache': 'HIT' } },
    );
  }

  const upstreamRate = upstreamLimiter.check(profile.user.id);
  if (!upstreamRate.allowed) {
    return NextResponse.json(
      { error: 'Rate limit reached for road routing requests. Please wait a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(upstreamRate.retryAfterSeconds) } },
    );
  }

  const chunks = chunkRouteWaypoints(uniqueStops, 25);
  const routedLegs: RouteLegEstimate[] = [];
  const encodedPolylines: string[] = [];
  const startedAtMs = Date.now();
  const deadEndpoints = new Set<string>();
  let lastError = '';

  for (const chunk of chunks) {
    const coords = formatOsrmCoordinates(chunk);
    let chunkSucceeded = false;

    for (const endpoint of endpoints) {
      if (deadEndpoints.has(endpoint)) continue;
      const timeoutMs = shouldUseRemainingBudget(startedAtMs, REQUEST_BUDGET_MS, ATTEMPT_TIMEOUT_MS);
      if (timeoutMs <= 0) {
        lastError = 'Routing time budget exceeded';
        break;
      }

      const url = `${endpoint}/${coords}?overview=full&geometries=polyline&steps=false`;
      try {
        const res = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'bpwi-app/1.0 (BP Waterworks Field Operations)',
          },
          cache: 'no-store',
          signal: AbortSignal.timeout(timeoutMs),
        });

        const parsed = (await res.json().catch(() => null)) as OsrmResponse | null;
        if (!res.ok || parsed?.code !== 'Ok' || !parsed.routes?.[0]) {
          lastError = parsed?.message || `Routing service HTTP ${res.status}`;
          deadEndpoints.add(endpoint);
          continue;
        }

        const primary = parsed.routes[0];
        if (typeof primary.geometry === 'string' && primary.geometry.length > 0) {
          encodedPolylines.push(primary.geometry);
        }

        const expectedChunkLegs = chunk.length - 1;
        const apiLegs = Array.isArray(primary.legs) ? primary.legs : [];
        if (apiLegs.length === expectedChunkLegs) {
          for (const leg of apiLegs) {
            routedLegs.push({
              distanceMeters: typeof leg.distance === 'number' && Number.isFinite(leg.distance) ? Math.round(leg.distance) : 0,
              durationSeconds: typeof leg.duration === 'number' && Number.isFinite(leg.duration) ? Math.round(leg.duration) : 0,
            });
          }
        } else if (expectedChunkLegs === 1) {
          routedLegs.push({
            distanceMeters: typeof primary.distance === 'number' && Number.isFinite(primary.distance) ? Math.round(primary.distance) : 0,
            durationSeconds: typeof primary.duration === 'number' && Number.isFinite(primary.duration) ? Math.round(primary.duration) : 0,
          });
        } else {
          for (let i = 0; i < expectedChunkLegs; i += 1) {
            const apiLeg = apiLegs[i];
            routedLegs.push({
              distanceMeters:
                typeof apiLeg?.distance === 'number' && Number.isFinite(apiLeg.distance)
                  ? Math.round(apiLeg.distance)
                  : haversineMeters(chunk[i], chunk[i + 1]),
              durationSeconds:
                typeof apiLeg?.duration === 'number' && Number.isFinite(apiLeg.duration)
                  ? Math.round(apiLeg.duration)
                  : 0,
            });
          }
        }

        chunkSucceeded = true;
        break;
      } catch (err) {
        deadEndpoints.add(endpoint);
        lastError = err instanceof Error ? err.message : 'Failed to contact OSRM routing server';
      }
    }

    if (!chunkSucceeded) {
      const fallback = buildStraightLineRoute(stops);
      return NextResponse.json({
        source: 'straight-line',
        fallbackReason: lastError || 'Road routing service is temporarily unavailable.',
        totalDistanceMeters: fallback.totalDistanceMeters,
        totalDurationSeconds: 0,
        legs: fallback.legs,
        encodedPolylines: [],
        travelMode,
      });
    }
  }

  routeCache.set(cacheKey, { routedLegs, encodedPolylines });

  const legs = expandCompressedLegs(legMap, routedLegs, stops);
  const totalDistanceMeters = legs.reduce((sum, l) => sum + l.distanceMeters, 0);
  const totalDurationSeconds = legs.reduce((sum, l) => sum + l.durationSeconds, 0);

  return NextResponse.json(
    {
      source: 'osrm',
      cached: false,
      totalDistanceMeters,
      totalDurationSeconds,
      legs,
      encodedPolylines,
      travelMode,
    },
    { headers: { 'X-Route-Cache': 'MISS' } },
  );
}
