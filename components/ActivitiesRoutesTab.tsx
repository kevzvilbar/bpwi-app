'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import type { DailyActivityRow } from '@/lib/activity-types';
import {
  buildRouteCacheKey,
  chunkRouteWaypoints,
  decodeEncodedPolyline,
  extractOperatorStops,
  formatDistanceKm,
  formatDuration,
  isValidCoordinate,
  parseLatLngPair,
  summarizeTeamFootprints,
  type BaseHqConfig,
  type LatLng,
  type RouteStop,
  type RouteTravelMode,
} from '@/lib/route-footprints';
import { triggerMapsQuotaExceeded } from '@/components/MapsQuotaBanner';

type RouteOp = {
  id: string;
  full_name: string;
  position: string | null;
};

type RouteArea = {
  id: string;
  code: string;
  name: string | null;
};

type ComputedRouteResult = {
  source: 'routes-sdk' | 'routes-api';
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  legs: Array<{ distanceMeters: number; durationSeconds: number }>;
  paths: LatLng[][];
};

const BASE_HQ_STORAGE_KEY = 'bpwi-base-hq-v1';
const ATTRIBUTION_IDS = ['gmp_mcp_codeassist_v1_aistudio'];
// Neutral Philippines overview center used only when 0 GPS points are plotted
const DEFAULT_PH_CENTER: LatLng = { lat: 10.7202, lng: 122.5621 };

function fmtTimeManila(iso: string | null | undefined) {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: '2-digit',
  }).format(dt);
}

function toSdkTravelMode(mode: RouteTravelMode): google.maps.TravelModeString {
  if (mode === 'TWO_WHEELER') return 'TWO_WHEELER';
  if (mode === 'WALK') return 'WALKING';
  return 'DRIVING';
}

function isQuotaErrorLike(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /OVER_QUERY_LIMIT|RESOURCE_EXHAUSTED|QuotaExceeded|OverQuotaMapError|429|quota/i.test(msg);
}

function StopMarker({
  stop,
  isSelected,
  onSelect,
  onClose,
}: {
  stop: RouteStop;
  isSelected: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const isBase = stop.kind !== 'activity';
  const glyph = isBase ? 'HQ' : String(stop.sequence);

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: stop.lat, lng: stop.lng }}
        title={`#${stop.sequence} ${stop.label}`}
        onClick={onSelect}
        zIndex={isSelected ? 200 : isBase ? 150 : 100 + stop.sequence}
      >
        <Pin
          background={isBase ? '#0f172a' : stop.color}
          borderColor={isSelected ? '#facc15' : '#ffffff'}
          glyphColor="#ffffff"
          scale={isSelected ? 1.25 : 1.05}
        >
          <span style={{ fontSize: 10, fontWeight: 800, color: '#ffffff', lineHeight: 1 }}>{glyph}</span>
        </Pin>
      </AdvancedMarker>
      {isSelected && marker && (
        <InfoWindow anchor={marker} onCloseClick={onClose} maxWidth={260}>
          <div style={{ color: '#0f172a', fontSize: 12.5, display: 'grid', gap: 4 }}>
            <div style={{ fontWeight: 800 }}>
              #{stop.sequence} · {stop.label}
            </div>
            {stop.sublabel && <div style={{ color: '#475569' }}>{stop.sublabel}</div>}
            {stop.timestamp && (
              <div style={{ fontSize: 11.5, color: '#334155' }}>
                Logged: <b>{fmtTimeManila(stop.timestamp)}</b>
                {stop.roleInActivity ? ` · ${stop.roleInActivity === 'lead' ? 'Lead' : 'Crew'}` : ''}
              </div>
            )}
            {stop.activity?.notes && (
              <div style={{ fontSize: 11.5, color: '#475569', whiteSpace: 'pre-wrap' }}>
                {stop.activity.notes.slice(0, 140)}
                {stop.activity.notes.length > 140 ? '…' : ''}
              </div>
            )}
            <div style={{ fontSize: 11, color: '#64748b' }}>
              {stop.lat.toFixed(5)}, {stop.lng.toFixed(5)}{' '}
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#0369a1', fontWeight: 700 }}
              >
                Open in Maps ↗
              </a>
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

function RouteLayer({
  stops,
  travelMode,
  routeCacheRef,
  onComputed,
  onStatusChange,
}: {
  stops: RouteStop[];
  travelMode: RouteTravelMode;
  routeCacheRef: React.MutableRefObject<Record<string, ComputedRouteResult>>;
  onComputed: (result: ComputedRouteResult | null) => void;
  onStatusChange: (status: { loading: boolean; error: string | null }) => void;
}) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  const stopCoordsKey = useMemo(
    () => buildRouteCacheKey(stops, travelMode),
    [stops, travelMode],
  );

  // Fit bounds whenever stops change
  useEffect(() => {
    if (!map || stops.length === 0) return;
    if (stops.length === 1) {
      map.panTo({ lat: stops[0].lat, lng: stops[0].lng });
      map.setZoom(15);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    for (const s of stops) {
      bounds.extend({ lat: s.lat, lng: s.lng });
    }
    map.fitBounds(bounds, 56);
  }, [map, stops]);

  useEffect(() => {
    // Cleanup any existing polylines before recalculating
    const clearPolylines = () => {
      polylinesRef.current.forEach((pl) => pl.setMap(null));
      polylinesRef.current = [];
    };
    clearPolylines();

    if (!map || stops.length < 2) {
      onComputed(null);
      onStatusChange({ loading: false, error: null });
      return clearPolylines;
    }

    const drawPaths = (paths: LatLng[][], isFallback: boolean) => {
      clearPolylines();
      const created: google.maps.Polyline[] = [];
      for (const path of paths) {
        if (path.length < 2) continue;
        const pl = new google.maps.Polyline({
          path,
          geodesic: isFallback,
          strokeColor: isFallback ? '#64748b' : '#2563eb',
          strokeOpacity: isFallback ? 0 : 0.9,
          strokeWeight: isFallback ? 3 : 5,
          icons: isFallback
            ? [
                {
                  icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.85, scale: 3 },
                  offset: '0',
                  repeat: '14px',
                },
              ]
            : [
                {
                  icon: {
                    path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                    scale: 2.6,
                    strokeColor: '#ffffff',
                    fillColor: '#1d4ed8',
                    fillOpacity: 1,
                    strokeWeight: 1,
                  },
                  offset: '50%',
                  repeat: '140px',
                },
              ],
          map,
        });
        created.push(pl);
      }
      polylinesRef.current = created;
    };

    const cached = routeCacheRef.current[stopCoordsKey];
    if (cached) {
      drawPaths(cached.paths, false);
      onComputed(cached);
      onStatusChange({ loading: false, error: null });
      return clearPolylines;
    }

    let cancelled = false;
    onStatusChange({ loading: true, error: null });

    const computeViaSdk = async (): Promise<ComputedRouteResult> => {
      if (!routesLib || !routesLib.Route || typeof routesLib.Route.computeRoutes !== 'function') {
        throw new Error('Maps JS Routes library not loaded');
      }
      const chunks = chunkRouteWaypoints(stops, 25);
      let totalDistanceMeters = 0;
      let totalDurationSeconds = 0;
      const legs: Array<{ distanceMeters: number; durationSeconds: number }> = [];
      const paths: LatLng[][] = [];
      const sdkMode = toSdkTravelMode(travelMode);

      for (const chunk of chunks) {
        const origin = { lat: chunk[0].lat, lng: chunk[0].lng };
        const destination = { lat: chunk[chunk.length - 1].lat, lng: chunk[chunk.length - 1].lng };
        const intermediates = chunk.slice(1, -1).map((pt) => ({
          location: { lat: pt.lat, lng: pt.lng },
        }));

        const req: google.maps.routes.ComputeRoutesRequest = {
          origin,
          destination,
          ...(intermediates.length > 0 ? { intermediates } : {}),
          travelMode: sdkMode,
          ...(sdkMode === 'DRIVING' || sdkMode === 'TWO_WHEELER'
            ? { routingPreference: 'TRAFFIC_UNAWARE' }
            : {}),
          fields: ['path', 'distanceMeters', 'durationMillis', 'legs'],
          internalUsageAttributionIds: ATTRIBUTION_IDS,
          language: 'en-PH',
          region: 'PH',
        };

        const response = await routesLib.Route.computeRoutes(req);
        const primary = response.routes?.[0];
        if (!primary) {
          throw new Error('No road route found between logged stops.');
        }

        totalDistanceMeters += primary.distanceMeters ?? 0;
        totalDurationSeconds += Math.round((primary.durationMillis ?? 0) / 1000);

        const primaryPath = (primary.path ?? [])
          .map((pt) => {
            const raw = pt as unknown as { lat: number | (() => number); lng: number | (() => number) };
            const lat = typeof raw.lat === 'function' ? raw.lat() : Number(raw.lat);
            const lng = typeof raw.lng === 'function' ? raw.lng() : Number(raw.lng);
            return { lat, lng };
          })
          .filter((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng));
        if (primaryPath.length >= 2) {
          paths.push(primaryPath);
        }

        const chunkLegs = primary.legs ?? [];
        if (chunkLegs.length > 0) {
          for (const leg of chunkLegs) {
            legs.push({
              distanceMeters: leg.distanceMeters ?? 0,
              durationSeconds: Math.round((leg.durationMillis ?? 0) / 1000),
            });
          }
        } else {
          legs.push({
            distanceMeters: primary.distanceMeters ?? 0,
            durationSeconds: Math.round((primary.durationMillis ?? 0) / 1000),
          });
        }
      }

      return {
        source: 'routes-sdk',
        totalDistanceMeters,
        totalDurationSeconds,
        legs,
        paths,
      };
    };

    const computeViaServerProxy = async (): Promise<ComputedRouteResult> => {
      const res = await fetch('/api/routes/compute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stops: stops.map((s) => ({ lat: s.lat, lng: s.lng })),
          travelMode,
        }),
      });
      const json = (await res.json()) as {
        totalDistanceMeters?: number;
        totalDurationSeconds?: number;
        legs?: Array<{ distanceMeters: number; durationSeconds: number }>;
        encodedPolylines?: string[];
        quotaExceeded?: boolean;
        error?: string;
      };
      if (res.status === 429 || json.quotaExceeded) {
        triggerMapsQuotaExceeded();
        throw new Error(json.error || 'Google Maps Platform quota exceeded.');
      }
      if (!res.ok) {
        throw new Error(json.error || `Routes calculation failed (HTTP ${res.status})`);
      }
      const paths = (json.encodedPolylines ?? [])
        .map((enc) => decodeEncodedPolyline(enc))
        .filter((pts) => pts.length >= 2);
      return {
        source: 'routes-api',
        totalDistanceMeters: json.totalDistanceMeters ?? 0,
        totalDurationSeconds: json.totalDurationSeconds ?? 0,
        legs: json.legs ?? [],
        paths,
      };
    };

    (async () => {
      try {
        let result: ComputedRouteResult;
        try {
          result = await computeViaSdk();
        } catch (sdkErr) {
          if (isQuotaErrorLike(sdkErr)) {
            triggerMapsQuotaExceeded();
            throw sdkErr;
          }
          result = await computeViaServerProxy();
        }

        if (cancelled) return;
        routeCacheRef.current[stopCoordsKey] = result;
        if (result.paths.length > 0) {
          drawPaths(result.paths, false);
        } else {
          drawPaths([stops.map((s) => ({ lat: s.lat, lng: s.lng }))], true);
        }
        onComputed(result);
        onStatusChange({ loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        if (isQuotaErrorLike(err)) {
          triggerMapsQuotaExceeded();
        }
        // Always draw dashed straight-line footprint fallback so the operator's stops stay connected
        drawPaths([stops.map((s) => ({ lat: s.lat, lng: s.lng }))], true);
        onComputed(null);
        onStatusChange({
          loading: false,
          error:
            err instanceof Error
              ? `${err.message} Showing straight-line distance fallback.`
              : 'Road route unavailable. Showing straight-line distance fallback.',
        });
      }
    })();

    return () => {
      cancelled = true;
      clearPolylines();
    };
  }, [map, routesLib, stops, travelMode, stopCoordsKey, routeCacheRef, onComputed, onStatusChange]);

  return null;
}

export default function ActivitiesRoutesTab(p: {
  date: string;
  canVerifyActivity: boolean;
  operatorId: string | null;
  operators: RouteOp[];
  areas: RouteArea[];
  activities: DailyActivityRow[];
  googleMapsApiKey: string;
}) {
  const [includeCrew, setIncludeCrew] = useState(true);
  const [travelMode, setTravelMode] = useState<RouteTravelMode>('DRIVE');
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);

  // Base HQ optional round-trip config (persisted locally in browser)
  const [baseHqEnabled, setBaseHqEnabled] = useState(false);
  const [baseHqLabel, setBaseHqLabel] = useState('Main Plant / Base HQ');
  const [baseHqLatStr, setBaseHqLatStr] = useState('');
  const [baseHqLngStr, setBaseHqLngStr] = useState('');
  const [hqEditorOpen, setHqEditorOpen] = useState(false);
  const [hqStatusMsg, setHqStatusMsg] = useState('');

  // Load saved Base HQ settings on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(BASE_HQ_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<BaseHqConfig>;
      if (typeof parsed.label === 'string' && parsed.label.trim()) {
        setBaseHqLabel(parsed.label.trim());
      }
      if (isValidCoordinate(parsed.lat, parsed.lng)) {
        setBaseHqLatStr(String(parsed.lat));
        setBaseHqLngStr(String(parsed.lng));
        if (parsed.enabled) setBaseHqEnabled(true);
      }
    } catch {
      // ignore invalid storage payload
    }
  }, []);

  const parsedHqCoords = useMemo(() => parseLatLngPair(baseHqLatStr, baseHqLngStr), [baseHqLatStr, baseHqLngStr]);

  const baseHqConfig: BaseHqConfig | null = useMemo(() => {
    if (!baseHqEnabled || !parsedHqCoords) return null;
    return {
      enabled: true,
      label: baseHqLabel.trim() || 'Base HQ',
      lat: parsedHqCoords.lat,
      lng: parsedHqCoords.lng,
    };
  }, [baseHqEnabled, baseHqLabel, parsedHqCoords]);

  const saveHqConfig = (next: { enabled: boolean; label: string; latStr: string; lngStr: string }) => {
    const coords = parseLatLngPair(next.latStr, next.lngStr);
    try {
      if (coords) {
        localStorage.setItem(
          BASE_HQ_STORAGE_KEY,
          JSON.stringify({
            enabled: next.enabled,
            label: next.label.trim() || 'Main Plant / Base HQ',
            lat: coords.lat,
            lng: coords.lng,
          }),
        );
      } else {
        localStorage.removeItem(BASE_HQ_STORAGE_KEY);
      }
    } catch {
      // ignore storage quota errors
    }
  };

  const areaNameById = useMemo(() => {
    const dict: Record<string, string> = {};
    for (const a of p.areas) {
      dict[a.id] = a.name ? `${a.code} (${a.name})` : a.code;
    }
    return dict;
  }, [p.areas]);

  const teamSummary = useMemo(
    () =>
      summarizeTeamFootprints(p.activities, p.operators, {
        date: p.date,
        includeCrew,
        baseHq: baseHqConfig,
      }),
    [p.activities, p.operators, p.date, includeCrew, baseHqConfig],
  );

  const defaultSelectedOpId = useMemo(() => {
    if (!p.canVerifyActivity) return p.operatorId ?? '';
    const firstWithGps = teamSummary.find((r) => r.mappedCount > 0);
    if (firstWithGps) return firstWithGps.operatorId;
    if (p.operatorId && p.operators.some((o) => o.id === p.operatorId)) return p.operatorId;
    return p.operators[0]?.id ?? '';
  }, [p.canVerifyActivity, p.operatorId, p.operators, teamSummary]);

  const [selectedOpId, setSelectedOpId] = useState<string>(defaultSelectedOpId);

  // Sync selected operator if date/role changes and current selection is empty or disallowed
  useEffect(() => {
    if (!p.canVerifyActivity) {
      setSelectedOpId(p.operatorId ?? '');
      return;
    }
    if (!selectedOpId || !p.operators.some((o) => o.id === selectedOpId)) {
      setSelectedOpId(defaultSelectedOpId);
    }
  }, [p.canVerifyActivity, p.operatorId, p.operators, selectedOpId, defaultSelectedOpId]);

  const effectiveOpId = p.canVerifyActivity ? selectedOpId : p.operatorId ?? '';

  const footprint = useMemo(() => {
    if (!effectiveOpId) {
      return {
        stops: [] as RouteStop[],
        mappedCount: 0,
        unmappedCount: 0,
        unmappedActivities: [] as DailyActivityRow[],
        straightLineTotalMeters: 0,
        straightLineLegsMeters: [] as number[],
        firstTimestamp: null,
        lastTimestamp: null,
      };
    }
    return extractOperatorStops(p.activities, {
      date: p.date,
      operatorId: effectiveOpId,
      includeCrew,
      baseHq: baseHqConfig,
      areaNameById,
    });
  }, [p.activities, p.date, effectiveOpId, includeCrew, baseHqConfig, areaNameById]);

  const [computedRoute, setComputedRoute] = useState<ComputedRouteResult | null>(null);
  const [routeStatus, setRouteStatus] = useState<{ loading: boolean; error: string | null }>({
    loading: false,
    error: null,
  });
  const routeCacheRef = useRef<Record<string, ComputedRouteResult>>({});

  // Reset selected marker info window when stops change
  useEffect(() => {
    setSelectedStopId(null);
  }, [effectiveOpId, p.date, includeCrew, baseHqConfig]);

  const selectedOp = useMemo(
    () => p.operators.find((o) => o.id === effectiveOpId) ?? null,
    [p.operators, effectiveOpId],
  );

  const captureCurrentHqGps = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setHqStatusMsg('Browser geolocation is unavailable on this device.');
      return;
    }
    setHqStatusMsg('Capturing device GPS…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const latStr = pos.coords.latitude.toFixed(6);
        const lngStr = pos.coords.longitude.toFixed(6);
        setBaseHqLatStr(latStr);
        setBaseHqLngStr(lngStr);
        setBaseHqEnabled(true);
        saveHqConfig({ enabled: true, label: baseHqLabel, latStr, lngStr });
        setHqStatusMsg(`✓ Captured Base HQ (${latStr}, ${lngStr})`);
      },
      (err) => {
        setHqStatusMsg(`GPS capture failed: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const copyHqFromFirstStop = () => {
    const firstActStop = footprint.stops.find((s) => s.kind === 'activity');
    if (!firstActStop) return;
    const latStr = firstActStop.lat.toFixed(6);
    const lngStr = firstActStop.lng.toFixed(6);
    setBaseHqLatStr(latStr);
    setBaseHqLngStr(lngStr);
    setBaseHqEnabled(true);
    saveHqConfig({ enabled: true, label: baseHqLabel, latStr, lngStr });
    setHqStatusMsg(`✓ Set Base HQ from Stop #${firstActStop.sequence}`);
  };

  const mapInitialCenter = useMemo<LatLng>(() => {
    if (footprint.stops.length > 0) {
      return { lat: footprint.stops[0].lat, lng: footprint.stops[0].lng };
    }
    return DEFAULT_PH_CENTER;
  }, [footprint.stops]);

  const effectiveApiKey =
    p.googleMapsApiKey || (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '');

  const totalLogsForOp = footprint.mappedCount + footprint.unmappedCount;
  const activeOpsWithGps = teamSummary.filter((r) => r.mappedCount > 0).length;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Controls Bar */}
      <div className="card" style={{ padding: 14, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <strong style={{ fontSize: 15 }}>Daily Field Footprints &amp; Travel Distance ({p.date})</strong>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Maps chronological GPS activity check-ins and estimates road-snapped travel distance via Google Maps Routes API.
            </div>
          </div>
          {p.canVerifyActivity && (
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
              {activeOpsWithGps} of {p.operators.length} staff with GPS pins on {p.date}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
          {p.canVerifyActivity ? (
            <label style={{ display: 'grid', gap: 4, fontSize: 12, minWidth: 220 }}>
              <span style={{ fontWeight: 700 }}>Operator / Field Staff</span>
              <select
                value={selectedOpId}
                onChange={(e) => setSelectedOpId(e.target.value)}
                style={{ minHeight: 34 }}
              >
                {p.operators.map((op) => {
                  const row = teamSummary.find((r) => r.operatorId === op.id);
                  const suffix = row && row.mappedCount > 0 ? ` (${row.mappedCount} GPS)` : ' (0 GPS)';
                  return (
                    <option key={op.id} value={op.id}>
                      {op.full_name}
                      {suffix}
                    </option>
                  );
                })}
              </select>
            </label>
          ) : (
            <div style={{ fontSize: 12.5, padding: '6px 10px', borderRadius: 8, background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
              Viewing your route: <b>{selectedOp?.full_name ?? 'Unlinked Operator Account'}</b>
            </div>
          )}

          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span style={{ fontWeight: 700 }}>Travel Mode</span>
            <select
              value={travelMode}
              onChange={(e) => setTravelMode(e.target.value as RouteTravelMode)}
              style={{ minHeight: 34 }}
            >
              <option value="DRIVE">Driving (Service Vehicle)</option>
              <option value="TWO_WHEELER">Motorcycle (2-Wheeler)</option>
              <option value="WALK">Walking</option>
            </select>
          </label>

          <div style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span style={{ fontWeight: 700 }}>Activity Role Scope</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                className={`btn ${!includeCrew ? 'btn-primary' : ''}`}
                onClick={() => setIncludeCrew(false)}
                style={{ minHeight: 34, fontSize: 12 }}
              >
                Lead Only
              </button>
              <button
                type="button"
                className={`btn ${includeCrew ? 'btn-primary' : ''}`}
                onClick={() => setIncludeCrew(true)}
                style={{ minHeight: 34, fontSize: 12 }}
              >
                Lead + Crew
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span style={{ fontWeight: 700 }}>Base HQ Round-Trip</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                className={`btn ${baseHqEnabled && parsedHqCoords ? 'btn-primary' : ''}`}
                onClick={() => {
                  if (!parsedHqCoords) {
                    setHqEditorOpen(true);
                    return;
                  }
                  const nextEnabled = !baseHqEnabled;
                  setBaseHqEnabled(nextEnabled);
                  saveHqConfig({
                    enabled: nextEnabled,
                    label: baseHqLabel,
                    latStr: baseHqLatStr,
                    lngStr: baseHqLngStr,
                  });
                }}
                style={{ minHeight: 34, fontSize: 12 }}
              >
                {baseHqEnabled && parsedHqCoords ? '✓ Round-Trip On' : 'Off (Stops Only)'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setHqEditorOpen((v) => !v)}
                style={{ minHeight: 34, fontSize: 12 }}
              >
                {hqEditorOpen ? 'Hide Base HQ' : 'Set Base HQ'}
              </button>
            </div>
          </div>
        </div>

        {/* Optional Base HQ Coordinate Setup Panel */}
        {hqEditorOpen && (
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              background: 'var(--surface-muted)',
              border: '1px solid var(--border)',
              display: 'grid',
              gap: 10,
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>
              Plant / Base HQ Coordinates (saved in this browser)
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
              <label style={{ display: 'grid', gap: 4, fontSize: 12, minWidth: 180 }}>
                <span>HQ Label</span>
                <input
                  type="text"
                  value={baseHqLabel}
                  onChange={(e) => setBaseHqLabel(e.target.value)}
                  placeholder="Main Plant / Base HQ"
                  style={{ minHeight: 34 }}
                />
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 12, width: 140 }}>
                <span>Latitude</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={baseHqLatStr}
                  onChange={(e) => setBaseHqLatStr(e.target.value)}
                  placeholder="e.g. 10.775100"
                  style={{ minHeight: 34 }}
                />
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 12, width: 140 }}>
                <span>Longitude</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={baseHqLngStr}
                  onChange={(e) => setBaseHqLngStr(e.target.value)}
                  placeholder="e.g. 122.543200"
                  style={{ minHeight: 34 }}
                />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const coords = parseLatLngPair(baseHqLatStr, baseHqLngStr);
                  if (!coords) {
                    setHqStatusMsg('Enter valid numeric latitude (-90 to 90) and longitude (-180 to 180).');
                    return;
                  }
                  setBaseHqEnabled(true);
                  saveHqConfig({
                    enabled: true,
                    label: baseHqLabel,
                    latStr: baseHqLatStr,
                    lngStr: baseHqLngStr,
                  });
                  setHqStatusMsg('✓ Base HQ saved and round-trip enabled.');
                }}
                style={{ minHeight: 34, fontSize: 12 }}
              >
                Save &amp; Enable
              </button>
              <button
                type="button"
                className="btn"
                onClick={captureCurrentHqGps}
                style={{ minHeight: 34, fontSize: 12 }}
              >
                Use Current Device GPS
              </button>
              {footprint.stops.some((s) => s.kind === 'activity') && (
                <button
                  type="button"
                  className="btn"
                  onClick={copyHqFromFirstStop}
                  style={{ minHeight: 34, fontSize: 12 }}
                >
                  Use Stop #1 GPS
                </button>
              )}
              {parsedHqCoords && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setBaseHqEnabled(false);
                    setBaseHqLatStr('');
                    setBaseHqLngStr('');
                    saveHqConfig({ enabled: false, label: baseHqLabel, latStr: '', lngStr: '' });
                    setHqStatusMsg('Cleared saved Base HQ.');
                  }}
                  style={{ minHeight: 34, fontSize: 12 }}
                >
                  Clear
                </button>
              )}
            </div>
            {hqStatusMsg && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{hqStatusMsg}</div>
            )}
          </div>
        )}
      </div>

      {/* Unlinked operator account guard */}
      {!p.canVerifyActivity && !effectiveOpId && (
        <div className="card" style={{ padding: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
          Your user account is not linked to an operator profile yet. Ask an administrator in Setup to link your account to view your daily footprints.
        </div>
      )}

      {/* KPI Summary Cards */}
      {effectiveOpId && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <div className="card" style={{ padding: 12, display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 700 }}>
              EST. ROAD DISTANCE
            </span>
            <strong style={{ fontSize: 22 }}>
              {footprint.stops.length < 2
                ? '0.00 km'
                : routeStatus.loading
                  ? 'Calculating…'
                  : computedRoute
                    ? formatDistanceKm(computedRoute.totalDistanceMeters)
                    : '—'}
            </strong>
            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
              {computedRoute
                ? `${travelMode === 'DRIVE' ? 'Driving' : travelMode === 'TWO_WHEELER' ? '2-Wheeler' : 'Walking'} route${baseHqConfig ? ' · incl. Base HQ' : ''}`
                : footprint.stops.length < 2
                  ? 'Needs at least 2 GPS points'
                  : 'Road route unavailable'}
            </span>
          </div>

          <div className="card" style={{ padding: 12, display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 700 }}>
              EST. TRAVEL TIME
            </span>
            <strong style={{ fontSize: 22 }}>
              {footprint.stops.length < 2
                ? '0 min'
                : routeStatus.loading
                  ? 'Calculating…'
                  : computedRoute
                    ? formatDuration(computedRoute.totalDurationSeconds)
                    : '—'}
            </strong>
            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
              {footprint.firstTimestamp && footprint.lastTimestamp
                ? `Logs: ${fmtTimeManila(footprint.firstTimestamp)} → ${fmtTimeManila(footprint.lastTimestamp)}`
                : 'No timestamped GPS stops'}
            </span>
          </div>

          <div className="card" style={{ padding: 12, display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 700 }}>
              STRAIGHT-LINE DISTANCE
            </span>
            <strong style={{ fontSize: 22 }}>
              {formatDistanceKm(footprint.straightLineTotalMeters)}
            </strong>
            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
              Point-to-point Haversine baseline
            </span>
          </div>

          <div className="card" style={{ padding: 12, display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 700 }}>
              GPS LOG COVERAGE
            </span>
            <strong style={{ fontSize: 22 }}>
              {footprint.mappedCount} / {totalLogsForOp}
            </strong>
            <span
              style={{
                fontSize: 11.5,
                color: footprint.unmappedCount > 0 ? 'var(--warn-fg)' : 'var(--text-secondary)',
                fontWeight: footprint.unmappedCount > 0 ? 700 : 400,
              }}
            >
              {footprint.unmappedCount > 0
                ? `${footprint.unmappedCount} log${footprint.unmappedCount === 1 ? '' : 's'} missing GPS`
                : totalLogsForOp > 0
                  ? '100% of logs have GPS'
                  : 'No activities logged on date'}
            </span>
          </div>
        </div>
      )}

      {/* Route Warning / Fallback Notice */}
      {routeStatus.error && (
        <div
          className="card"
          style={{
            padding: '9px 12px',
            background: 'var(--warn-bg)',
            border: '1px solid var(--warn-border)',
            color: 'var(--warn-fg)',
            fontSize: 12.5,
          }}
        >
          {routeStatus.error}
        </div>
      )}

      {/* Interactive Map Canvas */}
      {effectiveOpId && (
        <div className="card" style={{ padding: 12, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <strong style={{ fontSize: 14 }}>
              Route Map — {selectedOp?.full_name ?? 'Operator'} ({footprint.stops.length} plotted point{footprint.stops.length === 1 ? '' : 's'})
            </strong>
            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
              Click any numbered pin to inspect the activity log
            </span>
          </div>

          {!effectiveApiKey ? (
            <div
              style={{
                height: 320,
                borderRadius: 8,
                border: '1px dashed var(--border)',
                background: 'var(--surface-muted)',
                display: 'grid',
                placeItems: 'center',
                padding: 20,
                textAlign: 'center',
                color: 'var(--text-secondary)',
                fontSize: 13,
              }}
            >
              <div>
                <strong>Google Maps API key is not configured.</strong>
                <div style={{ marginTop: 6 }}>
                  Set <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> or <code>GOOGLE_MAPS_API_KEY</code> to enable interactive maps and road-snapped routing. Straight-line distances remain available below.
                </div>
              </div>
            </div>
          ) : footprint.stops.length === 0 ? (
            <div
              style={{
                height: 300,
                borderRadius: 8,
                border: '1px dashed var(--border)',
                background: 'var(--surface-muted)',
                display: 'grid',
                placeItems: 'center',
                padding: 20,
                textAlign: 'center',
                color: 'var(--text-secondary)',
                fontSize: 13,
              }}
            >
              <div>
                <strong>No GPS footprints recorded for {selectedOp?.full_name ?? 'this operator'} on {p.date}.</strong>
                <div style={{ marginTop: 6 }}>
                  {footprint.unmappedCount > 0
                    ? `${footprint.unmappedCount} activity log(s) exist on this date without captured GPS coordinates.`
                    : 'Field operators can capture GPS automatically using the GPS button inside the Activity Logger.'}
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{
                width: '100%',
                height: 460,
                borderRadius: 8,
                overflow: 'hidden',
                border: '1px solid var(--border)',
                position: 'relative',
              }}
            >
              <APIProvider
                apiKey={effectiveApiKey}
                libraries={['marker', 'routes']}
                language="en"
                region="PH"
              >
                <GoogleMap
                  mapId="DEMO_MAP_ID"
                  defaultCenter={mapInitialCenter}
                  defaultZoom={14}
                  gestureHandling="greedy"
                  mapTypeControl={true}
                  streetViewControl={false}
                  fullscreenControl={true}
                  internalUsageAttributionIds={ATTRIBUTION_IDS}
                  style={{ width: '100%', height: '100%' }}
                >
                  {footprint.stops.map((stop) => (
                    <StopMarker
                      key={stop.id}
                      stop={stop}
                      isSelected={selectedStopId === stop.id}
                      onSelect={() => setSelectedStopId(stop.id)}
                      onClose={() => setSelectedStopId(null)}
                    />
                  ))}
                  <RouteLayer
                    stops={footprint.stops}
                    travelMode={travelMode}
                    routeCacheRef={routeCacheRef}
                    onComputed={setComputedRoute}
                    onStatusChange={setRouteStatus}
                  />
                </GoogleMap>
              </APIProvider>
            </div>
          )}

          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
            Location note: Coordinates reflect operator-initiated GPS check-ins captured when submitting daily field activities. Road distances are estimates from Google Maps Routes API.
          </div>
        </div>
      )}

      {/* Chronological Stop-by-Stop Itinerary Table */}
      {effectiveOpId && footprint.stops.length > 0 && (
        <div className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
          <strong style={{ fontSize: 14 }}>Chronological Stop Itinerary &amp; Leg Distances</strong>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  <th style={{ padding: '7px 8px' }}>#</th>
                  <th style={{ padding: '7px 8px' }}>Time</th>
                  <th style={{ padding: '7px 8px' }}>Stop / Activity</th>
                  <th style={{ padding: '7px 8px' }}>Role</th>
                  <th style={{ padding: '7px 8px' }}>GPS Coordinates</th>
                  <th style={{ padding: '7px 8px', textAlign: 'right' }}>Leg Road Dist.</th>
                  <th style={{ padding: '7px 8px', textAlign: 'right' }}>Leg Est. Time</th>
                  <th style={{ padding: '7px 8px', textAlign: 'right' }}>Straight-Line</th>
                </tr>
              </thead>
              <tbody>
                {footprint.stops.map((stop, idx) => {
                  const legIdx = idx - 1;
                  const roadLeg = legIdx >= 0 ? computedRoute?.legs?.[legIdx] : undefined;
                  const straightLeg = legIdx >= 0 ? footprint.straightLineLegsMeters[legIdx] : undefined;
                  const isFocused = selectedStopId === stop.id;
                  return (
                    <tr
                      key={stop.id}
                      onClick={() => setSelectedStopId(stop.id)}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        background: isFocused ? 'var(--info-bg)' : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <td style={{ padding: '7px 8px', fontWeight: 800 }}>
                        <span
                          style={{
                            display: 'inline-block',
                            minWidth: 24,
                            textAlign: 'center',
                            padding: '2px 6px',
                            borderRadius: 6,
                            background: stop.kind === 'activity' ? stop.color : '#0f172a',
                            color: '#ffffff',
                            fontSize: 11,
                          }}
                        >
                          {stop.kind === 'activity' ? stop.sequence : 'HQ'}
                        </span>
                      </td>
                      <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>
                        {stop.timestamp ? fmtTimeManila(stop.timestamp) : stop.kind === 'base_start' ? 'Depart' : 'Return'}
                      </td>
                      <td style={{ padding: '7px 8px' }}>
                        <div style={{ fontWeight: 700 }}>{stop.label}</div>
                        {stop.sublabel && (
                          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{stop.sublabel}</div>
                        )}
                      </td>
                      <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>
                        {stop.kind !== 'activity'
                          ? 'Base HQ'
                          : stop.roleInActivity === 'lead'
                            ? 'Lead'
                            : 'Crew'}
                      </td>
                      <td style={{ padding: '7px 8px', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 11.5 }}>
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ color: 'var(--accent)', textDecoration: 'none' }}
                        >
                          {stop.lat.toFixed(5)}, {stop.lng.toFixed(5)} ↗
                        </a>
                      </td>
                      <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {idx === 0 ? 'Start' : roadLeg ? formatDistanceKm(roadLeg.distanceMeters) : '—'}
                      </td>
                      <td style={{ padding: '7px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {idx === 0 ? '—' : roadLeg ? formatDuration(roadLeg.durationSeconds) : '—'}
                      </td>
                      <td style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {idx === 0 ? '—' : formatDistanceKm(straightLeg)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Unmapped Logs Warning List */}
      {effectiveOpId && footprint.unmappedActivities.length > 0 && (
        <div
          className="card"
          style={{
            padding: 12,
            display: 'grid',
            gap: 6,
            background: 'var(--warn-bg)',
            border: '1px solid var(--warn-border)',
            color: 'var(--warn-fg)',
          }}
        >
          <strong style={{ fontSize: 13 }}>
            {footprint.unmappedActivities.length} Activity Log{footprint.unmappedActivities.length === 1 ? '' : 's'} Without GPS (Excluded from Map &amp; Distance)
          </strong>
          <div style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            {footprint.unmappedActivities.map((act) => (
              <div key={act.id}>
                • <b>{fmtTimeManila(act.started_at ?? act.created_at)}</b> — {act.activity_type.replace(/_/g, ' ')}
                {act.site_or_well ? ` · ${act.site_or_well}` : ''}
                {act.block_lot ? ` · ${act.block_lot}` : ''}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Supervisor Team Overview Table */}
      {p.canVerifyActivity && (
        <div className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <strong style={{ fontSize: 14 }}>Team Daily Footprint Overview ({p.date})</strong>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Click any staff member to inspect their road-snapped route and leg breakdown on the map above.
              </div>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  <th style={{ padding: '7px 8px' }}>Operator</th>
                  <th style={{ padding: '7px 8px', textAlign: 'right' }}>GPS Stops</th>
                  <th style={{ padding: '7px 8px', textAlign: 'right' }}>No-GPS Logs</th>
                  <th style={{ padding: '7px 8px' }}>Active Window</th>
                  <th style={{ padding: '7px 8px', textAlign: 'right' }}>Straight-Line Est.</th>
                  <th style={{ padding: '7px 8px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {teamSummary.map((row) => {
                  const isCurrent = row.operatorId === effectiveOpId;
                  return (
                    <tr
                      key={row.operatorId}
                      onClick={() => setSelectedOpId(row.operatorId)}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        background: isCurrent ? 'var(--info-bg)' : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <td style={{ padding: '7px 8px' }}>
                        <div style={{ fontWeight: 700 }}>{row.fullName}</div>
                        {row.position && (
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{row.position}</div>
                        )}
                      </td>
                      <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700 }}>
                        {row.mappedCount}
                      </td>
                      <td
                        style={{
                          padding: '7px 8px',
                          textAlign: 'right',
                          color: row.unmappedCount > 0 ? 'var(--warn-fg)' : 'var(--text-secondary)',
                          fontWeight: row.unmappedCount > 0 ? 700 : 400,
                        }}
                      >
                        {row.unmappedCount}
                      </td>
                      <td style={{ padding: '7px 8px', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                        {row.firstTimestamp && row.lastTimestamp
                          ? `${fmtTimeManila(row.firstTimestamp)} → ${fmtTimeManila(row.lastTimestamp)}`
                          : '—'}
                      </td>
                      <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {formatDistanceKm(row.straightLineMeters)}
                      </td>
                      <td style={{ padding: '7px 8px', textAlign: 'right' }}>
                        <button
                          type="button"
                          className={`btn ${isCurrent ? 'btn-primary' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedOpId(row.operatorId);
                          }}
                          style={{ minHeight: 28, padding: '2px 10px', fontSize: 11.5 }}
                        >
                          {isCurrent ? 'Viewing' : 'Inspect Route'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
