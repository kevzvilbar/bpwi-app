import { ACTIVITY_BY_ID, type DailyActivityRow } from './activity-types.ts';

export type LatLng = {
  lat: number;
  lng: number;
};

export type RouteTravelMode = 'DRIVE' | 'TWO_WHEELER' | 'WALK';

export type BaseHqConfig = {
  enabled: boolean;
  label: string;
  lat: number;
  lng: number;
};

export type RouteStop = {
  id: string;
  kind: 'activity' | 'base_start' | 'base_end';
  sequence: number;
  lat: number;
  lng: number;
  timestamp: string | null;
  label: string;
  sublabel: string | null;
  color: string;
  roleInActivity?: 'lead' | 'crew';
  activity?: DailyActivityRow;
};

export type OperatorFootprint = {
  stops: RouteStop[];
  mappedCount: number;
  unmappedCount: number;
  unmappedActivities: DailyActivityRow[];
  straightLineTotalMeters: number;
  straightLineLegsMeters: number[];
  firstTimestamp: string | null;
  lastTimestamp: string | null;
};

export type TeamFootprintSummary = {
  operatorId: string;
  fullName: string;
  position: string | null;
  mappedCount: number;
  unmappedCount: number;
  totalLogs: number;
  straightLineMeters: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
};

export function isValidCoordinate(lat: unknown, lng: unknown): lat is number {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  // Exclude exact (0, 0) sentinel coordinates
  if (lat === 0 && lng === 0) return false;
  return true;
}

export function parseLatLngPair(latRaw: string, lngRaw: string): LatLng | null {
  const latStr = latRaw.trim();
  const lngStr = lngRaw.trim();
  if (!latStr || !lngStr) return null;
  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (!isValidCoordinate(lat, lng)) return null;
  return { lat, lng };
}

/**
 * Great-circle (Haversine) distance in meters between two WGS-84 coordinates.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  return Math.round(R * c);
}

function stopSortKey(a: DailyActivityRow): number {
  const iso = a.started_at ?? a.completed_at ?? a.created_at;
  const ms = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Extracts chronological GPS stops for a single operator on a given date,
 * optionally including activities where the operator participated as crew
 * and optionally bracketing the route with a Plant/Base HQ round-trip.
 */
export function extractOperatorStops(
  activities: DailyActivityRow[],
  opts: {
    date: string;
    operatorId: string;
    includeCrew: boolean;
    baseHq?: BaseHqConfig | null;
    areaNameById?: Record<string, string>;
  },
): OperatorFootprint {
  const matched = activities.filter((a) => {
    if (a.activity_date !== opts.date) return false;
    if (a.lead_operator_id === opts.operatorId) return true;
    if (opts.includeCrew && (a.crew_operator_ids ?? []).includes(opts.operatorId)) return true;
    return false;
  });

  const mapped: DailyActivityRow[] = [];
  const unmapped: DailyActivityRow[] = [];

  for (const act of matched) {
    if (isValidCoordinate(act.gps_lat, act.gps_lng)) {
      mapped.push(act);
    } else {
      unmapped.push(act);
    }
  }

  mapped.sort((a, b) => {
    const diff = stopSortKey(a) - stopSortKey(b);
    if (diff !== 0) return diff;
    const createdDiff = (a.created_at ?? '').localeCompare(b.created_at ?? '');
    if (createdDiff !== 0) return createdDiff;
    return a.id.localeCompare(b.id);
  });

  unmapped.sort((a, b) => stopSortKey(a) - stopSortKey(b));

  const stops: RouteStop[] = [];
  const useBase = Boolean(
    opts.baseHq?.enabled &&
      isValidCoordinate(opts.baseHq.lat, opts.baseHq.lng) &&
      mapped.length > 0,
  );

  if (useBase && opts.baseHq) {
    stops.push({
      id: 'base-hq-start',
      kind: 'base_start',
      sequence: 1,
      lat: opts.baseHq.lat,
      lng: opts.baseHq.lng,
      timestamp: null,
      label: opts.baseHq.label.trim() || 'Base HQ (Departure)',
      sublabel: 'Round-trip departure point',
      color: '#0f172a',
    });
  }

  for (const act of mapped) {
    const meta = ACTIVITY_BY_ID[act.activity_type];
    const areaName = act.area_code_id && opts.areaNameById ? opts.areaNameById[act.area_code_id] : null;
    const subParts = [areaName, act.site_or_well, act.block_lot].filter(Boolean);
    stops.push({
      id: act.id,
      kind: 'activity',
      sequence: stops.length + 1,
      lat: act.gps_lat as number,
      lng: act.gps_lng as number,
      timestamp: act.started_at ?? act.completed_at ?? act.created_at ?? null,
      label: meta?.label ?? act.activity_type,
      sublabel: subParts.length > 0 ? subParts.join(' · ') : null,
      color: meta?.color ?? '#0369a1',
      roleInActivity: act.lead_operator_id === opts.operatorId ? 'lead' : 'crew',
      activity: act,
    });
  }

  if (useBase && opts.baseHq) {
    stops.push({
      id: 'base-hq-end',
      kind: 'base_end',
      sequence: stops.length + 1,
      lat: opts.baseHq.lat,
      lng: opts.baseHq.lng,
      timestamp: null,
      label: `${opts.baseHq.label.trim() || 'Base HQ'} (Return)`,
      sublabel: 'Round-trip return point',
      color: '#0f172a',
    });
  }

  const straightLineLegsMeters: number[] = [];
  let straightLineTotalMeters = 0;
  for (let i = 0; i < stops.length - 1; i += 1) {
    const leg = haversineMeters(stops[i], stops[i + 1]);
    straightLineLegsMeters.push(leg);
    straightLineTotalMeters += leg;
  }

  const activityStops = stops.filter((s) => s.kind === 'activity');
  const firstTimestamp = activityStops[0]?.timestamp ?? null;
  const lastTimestamp = activityStops[activityStops.length - 1]?.timestamp ?? null;

  return {
    stops,
    mappedCount: mapped.length,
    unmappedCount: unmapped.length,
    unmappedActivities: unmapped,
    straightLineTotalMeters,
    straightLineLegsMeters,
    firstTimestamp,
    lastTimestamp,
  };
}

/**
 * Summarizes daily GPS footprints across all operators for the supervisor overview table.
 */
export function summarizeTeamFootprints(
  activities: DailyActivityRow[],
  operators: Array<{ id: string; full_name: string; position: string | null }>,
  opts: {
    date: string;
    includeCrew: boolean;
    baseHq?: BaseHqConfig | null;
  },
): TeamFootprintSummary[] {
  const rows: TeamFootprintSummary[] = operators.map((op) => {
    const fp = extractOperatorStops(activities, {
      date: opts.date,
      operatorId: op.id,
      includeCrew: opts.includeCrew,
      baseHq: opts.baseHq,
    });
    return {
      operatorId: op.id,
      fullName: op.full_name,
      position: op.position,
      mappedCount: fp.mappedCount,
      unmappedCount: fp.unmappedCount,
      totalLogs: fp.mappedCount + fp.unmappedCount,
      straightLineMeters: fp.straightLineTotalMeters,
      firstTimestamp: fp.firstTimestamp,
      lastTimestamp: fp.lastTimestamp,
    };
  });

  rows.sort((a, b) => {
    if (b.mappedCount !== a.mappedCount) return b.mappedCount - a.mappedCount;
    if (b.totalLogs !== a.totalLogs) return b.totalLogs - a.totalLogs;
    return a.fullName.localeCompare(b.fullName);
  });

  return rows;
}

/**
 * Splits a multi-stop route into overlapping chunks compatible with multi-stop
 * routing endpoints (e.g. OSRM / Routes API max intermediate waypoint limits;
 * default 25 -> 27 stops/chunk). Adjacent chunks share the boundary stop so
 * concatenating leg results yields exactly `stops.length - 1` legs.
 */
export function chunkRouteWaypoints<T extends LatLng>(stops: T[], maxIntermediates = 25): T[][] {
  if (stops.length < 2) return [];
  const step = Math.max(1, maxIntermediates + 1);
  const chunks: T[][] = [];
  for (let start = 0; start < stops.length - 1; start += step) {
    const end = Math.min(stops.length - 1, start + step);
    chunks.push(stops.slice(start, end + 1));
    if (end === stops.length - 1) break;
  }
  return chunks;
}

/**
 * Parses Google Routes API duration strings (e.g. "1234s" or "1234.5s") into seconds.
 */
export function parseGoogleDurationSeconds(duration: string | number | null | undefined): number {
  if (typeof duration === 'number') {
    return Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : 0;
  }
  if (typeof duration !== 'string') return 0;
  const trimmed = duration.trim();
  const m = /^(\d+(?:\.\d+)?)s$/i.exec(trimmed);
  if (!m) return 0;
  const val = Number(m[1]);
  return Number.isFinite(val) && val >= 0 ? Math.round(val) : 0;
}

/**
 * Decodes a Google Encoded Polyline string (precision 1e5) into LatLng coordinates.
 */
export function decodeEncodedPolyline(encoded: string): LatLng[] {
  if (!encoded) return [];
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = 0;
    do {
      if (index >= encoded.length) return points;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dLat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dLat;

    shift = 0;
    result = 0;
    do {
      if (index >= encoded.length) return points;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dLng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dLng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

export function formatDistanceKm(meters: number | null | undefined): string {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) return '—';
  if (meters > 0 && meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds === 0) return '0 min';
  const totalMins = Math.round(seconds / 60);
  if (totalMins < 1) return '< 1 min';
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs === 0) return `${mins} min`;
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

export function buildRouteCacheKey(stops: LatLng[], travelMode: RouteTravelMode): string {
  const coords = stops.map((s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join('|');
  return `${travelMode}::${coords}`;
}

export type RouteSource = 'osrm' | 'straight-line';

export type RouteLegEstimate = {
  distanceMeters: number;
  durationSeconds: number;
};

/** Formats LatLng coordinates in OSRM `lng,lat;lng,lat` path order. */
export function formatOsrmCoordinates(stops: LatLng[]): string {
  return stops.map((s) => `${s.lng.toFixed(6)},${s.lat.toFixed(6)}`).join(';');
}

/** Returns ordered free OSRM endpoints for the selected travel mode (or custom self-hosted base URL). */
export function getOsrmEndpoints(travelMode: RouteTravelMode, customBaseUrl?: string): string[] {
  const trimmed = customBaseUrl?.trim().replace(/\/+$/, '');
  const profile = travelMode === 'WALK' ? 'foot' : 'driving';
  if (trimmed) {
    return [`${trimmed}/route/v1/${profile}`];
  }
  if (travelMode === 'WALK') {
    return ['https://routing.openstreetmap.de/routed-foot/route/v1/foot'];
  }
  return [
    'https://router.project-osrm.org/route/v1/driving',
    'https://routing.openstreetmap.de/routed-car/route/v1/driving',
  ];
}

/**
 * Collapses consecutive identical coordinates (< 1m apart) so routing services
 * do not receive zero-length duplicate adjacent waypoints, while tracking how
 * original stop-to-stop legs map back onto the deduplicated routed legs.
 */
export function compressConsecutiveDuplicateStops(stops: LatLng[]): {
  uniqueStops: LatLng[];
  legMap: Array<number | null>;
} {
  if (stops.length === 0) {
    return { uniqueStops: [], legMap: [] };
  }
  const uniqueStops: LatLng[] = [stops[0]];
  const legMap: Array<number | null> = [];
  let routedLegIdx = 0;

  for (let i = 0; i < stops.length - 1; i += 1) {
    if (haversineMeters(stops[i], stops[i + 1]) < 1) {
      legMap.push(null);
    } else {
      uniqueStops.push(stops[i + 1]);
      legMap.push(routedLegIdx);
      routedLegIdx += 1;
    }
  }

  return { uniqueStops, legMap };
}

/** Expands routed legs back to all original stop-to-stop intervals (0m/0s for compressed duplicates). */
export function expandCompressedLegs(
  legMap: Array<number | null>,
  routedLegs: RouteLegEstimate[],
  originalStops: LatLng[],
): RouteLegEstimate[] {
  return legMap.map((mappedIdx, i) => {
    if (mappedIdx === null) {
      return { distanceMeters: 0, durationSeconds: 0 };
    }
    const leg = routedLegs[mappedIdx];
    if (leg) return leg;
    const distanceMeters =
      originalStops[i] && originalStops[i + 1]
        ? haversineMeters(originalStops[i], originalStops[i + 1])
        : 0;
    return { distanceMeters, durationSeconds: 0 };
  });
}

/** Computes a point-to-point Haversine baseline route when road routing is unavailable. */
export function buildStraightLineRoute(stops: LatLng[]): {
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  legs: RouteLegEstimate[];
} {
  const legs: RouteLegEstimate[] = [];
  let totalDistanceMeters = 0;
  for (let i = 0; i < stops.length - 1; i += 1) {
    const distanceMeters = haversineMeters(stops[i], stops[i + 1]);
    legs.push({ distanceMeters, durationSeconds: 0 });
    totalDistanceMeters += distanceMeters;
  }
  return {
    totalDistanceMeters,
    totalDurationSeconds: 0,
    legs,
  };
}
