import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getAuthProfile } from '@/lib/profile';
import { getSupabaseEnv } from '@/lib/supabase/env';
import {
  DegradedStoreAlertGate,
  RouteResultCache,
  SlidingWindowRateLimiter,
  buildOrgScopedRouteCacheKey,
  formatSharedStoreDegradedNotice,
  isCacheableRoutePayload,
  resolveRoutingPolicy,
  shouldFailClosedOnDegradedRateLimit,
  shouldUseRemainingBudget,
  type RouteStoreDegradedReason,
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

type SharedCachePayload = {
  routedLegs: RouteLegEstimate[];
  encodedPolylines: string[];
};

const degradedAlertGate = new DegradedStoreAlertGate(5 * 60_000);
let cachedServiceClient: { keySig: string; client: SupabaseClient } | null = null;

function getServiceRouteClient(): SupabaseClient | null {
  const { url } = getSupabaseEnv();
  const secretKey = (
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    ''
  ).trim();
  if (!url || !secretKey) return null;
  const sig = `${url}::${secretKey}`;
  if (cachedServiceClient && cachedServiceClient.keySig === sig) {
    return cachedServiceClient.client;
  }
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  cachedServiceClient = { keySig: sig, client };
  return client;
}

function logStoreDegradation(reason: RouteStoreDegradedReason, detail?: string) {
  const key = detail ? `${reason}:${detail}` : reason;
  if (degradedAlertGate.shouldAlert(key)) {
    console.warn(
      `[route-compute] Shared store degraded (${reason})${detail ? ` — ${detail}` : ''}; falling back to per-instance memory.`,
    );
  }
}

interface SharedRateLimitCheck {
  allowed: boolean;
  retryAfterSeconds: number;
  store: 'shared' | 'memory' | 'unavailable';
  degradedReason: RouteStoreDegradedReason | null;
  failClosed: boolean;
}

function resolveDegradedRateLimit(
  reason: RouteStoreDegradedReason,
  fallback: SlidingWindowRateLimiter,
  userId: string,
): SharedRateLimitCheck {
  if (
    shouldFailClosedOnDegradedRateLimit({
      nodeEnv: process.env.NODE_ENV,
      allowMemoryFallback: process.env.ALLOW_MEMORY_RATE_LIMIT_FALLBACK,
    })
  ) {
    return {
      allowed: false,
      retryAfterSeconds: 60,
      store: 'unavailable',
      degradedReason: reason,
      failClosed: true,
    };
  }
  const local = fallback.check(userId);
  return {
    allowed: local.allowed,
    retryAfterSeconds: local.retryAfterSeconds,
    store: 'memory',
    degradedReason: reason,
    failClosed: false,
  };
}

function buildRateLimitRejection(
  rate: SharedRateLimitCheck,
  limitMessage: string,
  isAdmin: boolean,
): NextResponse {
  if (rate.failClosed) {
    return NextResponse.json(
      {
        error: 'Route calculation is temporarily unavailable because the shared rate-limit store is not configured or reachable.',
        routeStore: 'unavailable',
        ...(isAdmin && rate.degradedReason
          ? { storeWarning: formatSharedStoreDegradedNotice(rate.degradedReason, true) }
          : {}),
      },
      {
        status: 503,
        headers: {
          'Retry-After': String(rate.retryAfterSeconds),
          'X-Route-Store': rate.store,
        },
      },
    );
  }
  return NextResponse.json(
    { error: limitMessage },
    {
      status: 429,
      headers: {
        'Retry-After': String(rate.retryAfterSeconds),
        'X-Route-Store': rate.store,
      },
    },
  );
}

async function checkSharedRateLimit(
  serviceDb: SupabaseClient | null,
  bucket: 'total' | 'upstream',
  fallback: SlidingWindowRateLimiter,
  userId: string,
): Promise<SharedRateLimitCheck> {
  if (!serviceDb) {
    logStoreDegradation('missing_service_key');
    return resolveDegradedRateLimit('missing_service_key', fallback, userId);
  }

  try {
    const { data, error } = await serviceDb.rpc('check_route_compute_rate_limit', {
      p_user_id: userId,
      p_bucket: bucket,
    });
    if (!error && Array.isArray(data) && data[0]) {
      const row = data[0] as { allowed?: unknown; retry_after_seconds?: unknown };
      if (typeof row.allowed === 'boolean') {
        return {
          allowed: row.allowed,
          retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds) || 1),
          store: 'shared',
          degradedReason: null,
          failClosed: false,
        };
      }
    }
    logStoreDegradation('rpc_unavailable', error?.message ?? 'empty RPC result');
  } catch (err) {
    logStoreDegradation('rpc_unavailable', err instanceof Error ? err.message : 'RPC exception');
  }

  return resolveDegradedRateLimit('rpc_unavailable', fallback, userId);
}

async function readSharedRouteCache(
  serviceDb: SupabaseClient | null,
  orgId: string,
  scopedCacheKey: string,
  memKey: string,
): Promise<{
  hit: SharedCachePayload | null;
  store: 'shared' | 'memory';
  degradedReason: RouteStoreDegradedReason | null;
}> {
  const mem = routeCache.get(memKey);
  if (mem) {
    return {
      hit: mem,
      store: serviceDb ? 'shared' : 'memory',
      degradedReason: serviceDb ? null : 'missing_service_key',
    };
  }
  if (!serviceDb) {
    logStoreDegradation('missing_service_key');
    return { hit: null, store: 'memory', degradedReason: 'missing_service_key' };
  }

  try {
    const { data, error } = await serviceDb.rpc('get_route_compute_cache', {
      p_org_id: orgId,
      p_cache_key: scopedCacheKey,
    });
    if (error) {
      logStoreDegradation('rpc_unavailable', error.message);
      return { hit: null, store: 'memory', degradedReason: 'rpc_unavailable' };
    }
    if (Array.isArray(data) && data[0]) {
      const row = data[0] as { routed_legs?: unknown; encoded_polylines?: unknown };
      if (Array.isArray(row.routed_legs) && Array.isArray(row.encoded_polylines)) {
        const payload: SharedCachePayload = {
          routedLegs: row.routed_legs as RouteLegEstimate[],
          encodedPolylines: row.encoded_polylines.filter((p): p is string => typeof p === 'string'),
        };
        routeCache.set(memKey, payload);
        return { hit: payload, store: 'shared', degradedReason: null };
      }
    }
    return { hit: null, store: 'shared', degradedReason: null };
  } catch (err) {
    logStoreDegradation('rpc_unavailable', err instanceof Error ? err.message : 'cache read error');
    return { hit: null, store: 'memory', degradedReason: 'rpc_unavailable' };
  }
}

async function writeSharedRouteCache(
  serviceDb: SupabaseClient | null,
  orgId: string,
  scopedCacheKey: string,
  memKey: string,
  payload: SharedCachePayload,
): Promise<{ store: 'shared' | 'memory'; degradedReason: RouteStoreDegradedReason | null }> {
  if (!isCacheableRoutePayload(scopedCacheKey, payload.routedLegs, payload.encodedPolylines)) {
    return {
      store: serviceDb ? 'shared' : 'memory',
      degradedReason: serviceDb ? null : 'missing_service_key',
    };
  }

  routeCache.set(memKey, payload);
  if (!serviceDb) {
    logStoreDegradation('missing_service_key');
    return { store: 'memory', degradedReason: 'missing_service_key' };
  }

  try {
    const { error } = await serviceDb.rpc('set_route_compute_cache', {
      p_org_id: orgId,
      p_cache_key: scopedCacheKey,
      p_routed_legs: payload.routedLegs,
      p_encoded_polylines: payload.encodedPolylines,
    });
    if (error) {
      logStoreDegradation('rpc_unavailable', error.message);
      return { store: 'memory', degradedReason: 'rpc_unavailable' };
    }
    return { store: 'shared', degradedReason: null };
  } catch (err) {
    logStoreDegradation('rpc_unavailable', err instanceof Error ? err.message : 'cache write error');
    return { store: 'memory', degradedReason: 'rpc_unavailable' };
  }
}

export async function POST(req: NextRequest) {
  const profile = await getAuthProfile();
  if (!profile.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!profile.isActive || !profile.orgId) {
    return NextResponse.json({ error: 'Account pending approval' }, { status: 403 });
  }

  const serviceDb = getServiceRouteClient();
  const totalRate = await checkSharedRateLimit(serviceDb, 'total', totalLimiter, profile.user.id);
  if (!totalRate.allowed) {
    return buildRateLimitRejection(
      totalRate,
      'Too many route calculations. Please wait before trying again.',
      profile.isAdmin,
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
    return NextResponse.json(
      {
        source: 'straight-line',
        routeStore: totalRate.store,
        ...(profile.isAdmin && totalRate.degradedReason
          ? { storeWarning: formatSharedStoreDegradedNotice(totalRate.degradedReason) }
          : {}),
        fallbackReason: 'Road routing server is not configured (set OSRM_BASE_URL to a self-hosted OSRM instance).',
        totalDistanceMeters: fallback.totalDistanceMeters,
        totalDurationSeconds: 0,
        legs: fallback.legs,
        encodedPolylines: [],
        travelMode,
      },
      { headers: { 'X-Route-Store': totalRate.store } },
    );
  }

  const stopKey = buildRouteCacheKey(uniqueStops, travelMode);
  const scopedCacheKey = `${endpoints.join(',')}::${stopKey}`;
  const memKey = buildOrgScopedRouteCacheKey(profile.orgId, endpoints, stopKey);

  const cachedLookup = await readSharedRouteCache(serviceDb, profile.orgId, scopedCacheKey, memKey);
  if (cachedLookup.hit) {
    const degraded = totalRate.degradedReason ?? cachedLookup.degradedReason;
    const effectiveStore = degraded ? 'memory' : 'shared';
    const legs = expandCompressedLegs(legMap, cachedLookup.hit.routedLegs, stops);
    return NextResponse.json(
      {
        source: 'osrm',
        cached: true,
        routeStore: effectiveStore,
        ...(profile.isAdmin && degraded ? { storeWarning: formatSharedStoreDegradedNotice(degraded) } : {}),
        totalDistanceMeters: legs.reduce((sum, l) => sum + l.distanceMeters, 0),
        totalDurationSeconds: legs.reduce((sum, l) => sum + l.durationSeconds, 0),
        legs,
        encodedPolylines: cachedLookup.hit.encodedPolylines,
        travelMode,
      },
      { headers: { 'X-Route-Cache': 'HIT', 'X-Route-Store': effectiveStore } },
    );
  }

  const upstreamRate = await checkSharedRateLimit(serviceDb, 'upstream', upstreamLimiter, profile.user.id);
  if (!upstreamRate.allowed) {
    return buildRateLimitRejection(
      upstreamRate,
      'Rate limit reached for road routing requests. Please wait a few minutes.',
      profile.isAdmin,
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
      const degraded = totalRate.degradedReason ?? upstreamRate.degradedReason;
      const effectiveStore = degraded ? 'memory' : 'shared';
      const fallback = buildStraightLineRoute(stops);
      return NextResponse.json(
        {
          source: 'straight-line',
          routeStore: effectiveStore,
          ...(profile.isAdmin && degraded ? { storeWarning: formatSharedStoreDegradedNotice(degraded) } : {}),
          fallbackReason: lastError || 'Road routing service is temporarily unavailable.',
          totalDistanceMeters: fallback.totalDistanceMeters,
          totalDurationSeconds: 0,
          legs: fallback.legs,
          encodedPolylines: [],
          travelMode,
        },
        { headers: { 'X-Route-Store': effectiveStore } },
      );
    }
  }

  const writeResult = await writeSharedRouteCache(
    serviceDb,
    profile.orgId,
    scopedCacheKey,
    memKey,
    { routedLegs, encodedPolylines },
  );
  const degraded = totalRate.degradedReason ?? upstreamRate.degradedReason ?? writeResult.degradedReason;
  const effectiveStore = degraded ? 'memory' : 'shared';

  const legs = expandCompressedLegs(legMap, routedLegs, stops);
  const totalDistanceMeters = legs.reduce((sum, l) => sum + l.distanceMeters, 0);
  const totalDurationSeconds = legs.reduce((sum, l) => sum + l.durationSeconds, 0);

  return NextResponse.json(
    {
      source: 'osrm',
      cached: false,
      routeStore: effectiveStore,
      ...(profile.isAdmin && degraded ? { storeWarning: formatSharedStoreDegradedNotice(degraded) } : {}),
      totalDistanceMeters,
      totalDurationSeconds,
      legs,
      encodedPolylines,
      travelMode,
    },
    { headers: { 'X-Route-Cache': 'MISS', 'X-Route-Store': effectiveStore } },
  );
}
