import { NextRequest, NextResponse } from 'next/server';
import { getProfile } from '@/lib/profile';
import {
  chunkRouteWaypoints,
  isValidCoordinate,
  parseGoogleDurationSeconds,
  type LatLng,
  type RouteTravelMode,
} from '@/lib/route-footprints';

const ALLOWED_MODES = new Set<RouteTravelMode>(['DRIVE', 'TWO_WHEELER', 'WALK']);
const ROUTES_ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const FIELD_MASK = [
  'routes.distanceMeters',
  'routes.duration',
  'routes.polyline.encodedPolyline',
  'routes.legs.distanceMeters',
  'routes.legs.duration',
].join(',');

type ComputeRequestBody = {
  stops?: Array<{ lat?: unknown; lng?: unknown }>;
  travelMode?: unknown;
};

type GoogleRouteLeg = {
  distanceMeters?: number;
  duration?: string;
};

type GoogleRoute = {
  distanceMeters?: number;
  duration?: string;
  polyline?: { encodedPolyline?: string };
  legs?: GoogleRouteLeg[];
};

type GoogleRoutesResponse = {
  routes?: GoogleRoute[];
  error?: {
    code?: number;
    status?: string;
    message?: string;
  };
};

function isQuotaError(status: number, body?: GoogleRoutesResponse | null, rawText = ''): boolean {
  if (status === 429) return true;
  const combined = `${body?.error?.status ?? ''} ${body?.error?.message ?? ''} ${rawText}`;
  return /RESOURCE_EXHAUSTED|OVER_QUERY_LIMIT|QuotaExceeded|quota/i.test(combined);
}

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

  const requestedMode = typeof body.travelMode === 'string' ? (body.travelMode.toUpperCase() as RouteTravelMode) : 'DRIVE';
  const travelMode: RouteTravelMode = ALLOWED_MODES.has(requestedMode) ? requestedMode : 'DRIVE';

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Google Maps API key is not configured on the server.', missingKey: true },
      { status: 503 },
    );
  }

  const chunks = chunkRouteWaypoints(stops, 25);
  let totalDistanceMeters = 0;
  let totalDurationSeconds = 0;
  const legs: Array<{ distanceMeters: number; durationSeconds: number }> = [];
  const encodedPolylines: string[] = [];

  for (const chunk of chunks) {
    const origin = chunk[0];
    const destination = chunk[chunk.length - 1];
    const intermediates = chunk.slice(1, -1);

    const payload: Record<string, unknown> = {
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
      travelMode,
      units: 'METRIC',
      languageCode: 'en-PH',
      regionCode: 'PH',
    };

    if (intermediates.length > 0) {
      payload.intermediates = intermediates.map((pt) => ({
        location: { latLng: { latitude: pt.lat, longitude: pt.lng } },
      }));
    }

    if (travelMode === 'DRIVE' || travelMode === 'TWO_WHEELER') {
      payload.routingPreference = 'TRAFFIC_UNAWARE';
    }

    let res: Response;
    try {
      res = await fetch(ROUTES_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to contact Google Routes API' },
        { status: 502 },
      );
    }

    const rawText = await res.text();
    let parsed: GoogleRoutesResponse | null = null;
    try {
      parsed = JSON.parse(rawText) as GoogleRoutesResponse;
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      if (isQuotaError(res.status, parsed, rawText)) {
        return NextResponse.json(
          { quotaExceeded: true, error: 'Google Maps Platform quota exceeded.' },
          { status: 429 },
        );
      }
      return NextResponse.json(
        { error: parsed?.error?.message || `Routes API error (HTTP ${res.status})` },
        { status: res.status >= 400 && res.status < 500 ? res.status : 502 },
      );
    }

    const primary = parsed?.routes?.[0];
    if (!primary) {
      return NextResponse.json(
        { error: 'No drivable road route was found between the logged GPS points.' },
        { status: 404 },
      );
    }

    totalDistanceMeters += typeof primary.distanceMeters === 'number' ? primary.distanceMeters : 0;
    totalDurationSeconds += parseGoogleDurationSeconds(primary.duration);
    if (primary.polyline?.encodedPolyline) {
      encodedPolylines.push(primary.polyline.encodedPolyline);
    }

    const chunkLegs = primary.legs ?? [];
    if (chunkLegs.length > 0) {
      for (const leg of chunkLegs) {
        legs.push({
          distanceMeters: typeof leg.distanceMeters === 'number' ? leg.distanceMeters : 0,
          durationSeconds: parseGoogleDurationSeconds(leg.duration),
        });
      }
    } else {
      legs.push({
        distanceMeters: typeof primary.distanceMeters === 'number' ? primary.distanceMeters : 0,
        durationSeconds: parseGoogleDurationSeconds(primary.duration),
      });
    }
  }

  return NextResponse.json({
    totalDistanceMeters,
    totalDurationSeconds,
    legs,
    encodedPolylines,
    travelMode,
  });
}
