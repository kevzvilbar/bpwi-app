import { NextRequest, NextResponse } from 'next/server';
import { getProfile } from '@/lib/profile';
import {
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

const ALLOWED_MODES = new Set<RouteTravelMode>(['DRIVE', 'TWO_WHEELER', 'WALK']);

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
  const profile = await getProfile();
  if (!profile.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!profile.isActive) {
    return NextResponse.json({ error: 'Account pending approval' }, { status: 403 });
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

  const chunks = chunkRouteWaypoints(uniqueStops, 25);
  const endpoints = getOsrmEndpoints(travelMode, process.env.OSRM_BASE_URL);
  const routedLegs: RouteLegEstimate[] = [];
  const encodedPolylines: string[] = [];
  let lastError = '';

  for (const chunk of chunks) {
    const coords = formatOsrmCoordinates(chunk);
    let chunkSucceeded = false;

    for (const endpoint of endpoints) {
      const url = `${endpoint}/${coords}?overview=full&geometries=polyline&steps=false`;
      try {
        const res = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'bpwi-app/1.0 (BP Waterworks Field Operations)',
          },
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        });

        const parsed = (await res.json().catch(() => null)) as OsrmResponse | null;
        if (!res.ok || parsed?.code !== 'Ok' || !parsed.routes?.[0]) {
          lastError = parsed?.message || `Routing service HTTP ${res.status}`;
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
        lastError = err instanceof Error ? err.message : 'Failed to contact free OSRM routing server';
      }
    }

    if (!chunkSucceeded) {
      const fallback = buildStraightLineRoute(stops);
      return NextResponse.json({
        source: 'straight-line',
        fallbackReason: lastError || 'Free OpenStreetMap routing service is temporarily unavailable.',
        totalDistanceMeters: fallback.totalDistanceMeters,
        totalDurationSeconds: 0,
        legs: fallback.legs,
        encodedPolylines: [],
        travelMode,
      });
    }
  }

  const legs = expandCompressedLegs(legMap, routedLegs, stops);
  const totalDistanceMeters = legs.reduce((sum, l) => sum + l.distanceMeters, 0);
  const totalDurationSeconds = legs.reduce((sum, l) => sum + l.durationSeconds, 0);

  return NextResponse.json({
    source: 'osrm',
    totalDistanceMeters,
    totalDurationSeconds,
    legs,
    encodedPolylines,
    travelMode,
  });
}
