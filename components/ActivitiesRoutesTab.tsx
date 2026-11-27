'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { DailyActivityRow } from '@/lib/activity-types';
import { reportClientTelemetry } from '@/lib/client-telemetry';
import { fmtTimeManila } from '@/lib/date';
import { startHighAccuracyGpsCapture } from '@/lib/gps-accuracy';
import { getMapStyleOptions, getPublicTileAdminNotice, resolveMapTileConfig } from '@/lib/map-tiles';
import {
  buildRouteCacheKey,
  buildStraightLineRoute,
  decodeEncodedPolyline,
  extractOperatorStops,
  formatDistanceKm,
  formatDuration,
  isValidCoordinate,
  parseLatLngPair,
  summarizeTeamFootprints,
  type BaseHqConfig,
  type LatLng,
  type RouteLegEstimate,
  type RouteSource,
  type RouteStop,
  type RouteTravelMode,
} from '@/lib/route-footprints';
import FreeRouteMap, { type FreeMapStyle } from '@/components/FreeRouteMap';
import RouteStopsList from '@/components/RouteStopsList';
import RoutesTeamOverview from '@/components/RoutesTeamOverview';
import { AlertBanner, EmptyState, SegmentedTabs, StatCard } from '@/components/ui';

const GpsPinPickerModal = dynamic(() => import('@/components/GpsPinPickerModal'), { ssr: false });

type RouteOp = { id: string; full_name: string; position: string | null };
type RouteArea = { id: string; code: string; name: string | null };
type ComputedRouteResult = {
  source: RouteSource;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  legs: RouteLegEstimate[];
  paths: LatLng[][];
};

const BASE_HQ_STORAGE_KEY = 'bpwi-base-hq-v1';
const TRAVEL_MODE_LABELS: Record<RouteTravelMode, string> = {
  DRIVE: 'Driving',
  TWO_WHEELER: 'Motorcycle',
  WALK: 'Walking',
};
const EMPTY_FOOTPRINT = {
  stops: [] as RouteStop[],
  mappedCount: 0,
  unmappedCount: 0,
  unmappedActivities: [] as DailyActivityRow[],
  straightLineTotalMeters: 0,
  straightLineLegsMeters: [] as number[],
  firstTimestamp: null as string | null,
  lastTimestamp: null as string | null,
};
const MUTED_BOX_STYLE = {
  borderRadius: 8,
  background: 'var(--surface-muted)',
  border: '1px solid var(--border)',
};

function saveHqToStorage(enabled: boolean, label: string, latStr: string, lngStr: string) {
  const coords = parseLatLngPair(latStr, lngStr);
  try {
    if (coords) {
      localStorage.setItem(
        BASE_HQ_STORAGE_KEY,
        JSON.stringify({ enabled, label: label.trim() || 'Main Plant / Base HQ', lat: coords.lat, lng: coords.lng }),
      );
    } else {
      localStorage.removeItem(BASE_HQ_STORAGE_KEY);
    }
  } catch {
    // ignore storage quota errors
  }
}

export default function ActivitiesRoutesTab(p: {
  date: string;
  canVerifyActivity: boolean;
  isAdmin?: boolean;
  operatorId: string | null;
  operators: RouteOp[];
  areas: RouteArea[];
  activities: DailyActivityRow[];
}) {
  const [includeCrew, setIncludeCrew] = useState(true);
  const [travelMode, setTravelMode] = useState<RouteTravelMode>('DRIVE');
  const [mapStyle, setMapStyle] = useState<FreeMapStyle>('street');
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);

  const [baseHqEnabled, setBaseHqEnabled] = useState(false);
  const [baseHqLabel, setBaseHqLabel] = useState('Main Plant / Base HQ');
  const [baseHqLatStr, setBaseHqLatStr] = useState('');
  const [baseHqLngStr, setBaseHqLngStr] = useState('');
  const [hqEditorOpen, setHqEditorOpen] = useState(false);
  const [hqStatusMsg, setHqStatusMsg] = useState('');
  const [capturingHqGps, setCapturingHqGps] = useState(false);
  const [hqPinModalOpen, setHqPinModalOpen] = useState(false);
  const [hqHintCoords, setHqHintCoords] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const cancelHqGpsRef = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    cancelHqGpsRef.current?.();
    cancelHqGpsRef.current = null;
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(BASE_HQ_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<BaseHqConfig>;
      if (typeof parsed.label === 'string' && parsed.label.trim()) setBaseHqLabel(parsed.label.trim());
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
    return { enabled: true, label: baseHqLabel.trim() || 'Base HQ', lat: parsedHqCoords.lat, lng: parsedHqCoords.lng };
  }, [baseHqEnabled, baseHqLabel, parsedHqCoords]);

  const areaNameById = useMemo(() => {
    const dict: Record<string, string> = {};
    for (const a of p.areas) dict[a.id] = a.name ? `${a.code} (${a.name})` : a.code;
    return dict;
  }, [p.areas]);

  const teamSummary = useMemo(
    () => summarizeTeamFootprints(p.activities, p.operators, { date: p.date, includeCrew, baseHq: baseHqConfig }),
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

  useEffect(() => {
    if (!p.canVerifyActivity) {
      setSelectedOpId(p.operatorId ?? '');
    } else if (!selectedOpId || !p.operators.some((o) => o.id === selectedOpId)) {
      setSelectedOpId(defaultSelectedOpId);
    }
  }, [p.canVerifyActivity, p.operatorId, p.operators, selectedOpId, defaultSelectedOpId]);

  const effectiveOpId = p.canVerifyActivity ? selectedOpId : p.operatorId ?? '';

  const footprint = useMemo(() => {
    if (!effectiveOpId) return EMPTY_FOOTPRINT;
    return extractOperatorStops(p.activities, {
      date: p.date,
      operatorId: effectiveOpId,
      includeCrew,
      baseHq: baseHqConfig,
      areaNameById,
    });
  }, [p.activities, p.date, effectiveOpId, includeCrew, baseHqConfig, areaNameById]);

  const [computedRoute, setComputedRoute] = useState<ComputedRouteResult | null>(null);
  const [routeStatus, setRouteStatus] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  const [storeWarning, setStoreWarning] = useState<string | null>(null);
  const routeCacheRef = useRef<Record<string, ComputedRouteResult>>({});

  useEffect(() => {
    setSelectedStopId(null);
  }, [effectiveOpId, p.date, includeCrew, baseHqConfig]);

  const stopCoordsKey = useMemo(() => buildRouteCacheKey(footprint.stops, travelMode), [footprint.stops, travelMode]);

  useEffect(() => {
    if (footprint.stops.length < 2) {
      setComputedRoute(null);
      setRouteStatus({ loading: false, error: null });
      return;
    }
    const cached = routeCacheRef.current[stopCoordsKey];
    if (cached) {
      setComputedRoute(cached);
      setRouteStatus({ loading: false, error: null });
      return;
    }

    const controller = new AbortController();
    setRouteStatus({ loading: true, error: null });

    (async () => {
      try {
        const res = await fetch('/api/routes/compute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ stops: footprint.stops.map((s) => ({ lat: s.lat, lng: s.lng })), travelMode }),
        });
        const json = (await res.json()) as {
          source?: RouteSource;
          fallbackReason?: string;
          storeWarning?: string;
          totalDistanceMeters?: number;
          totalDurationSeconds?: number;
          legs?: RouteLegEstimate[];
          encodedPolylines?: string[];
          error?: string;
        };
        if (controller.signal.aborted) return;

        setStoreWarning(typeof json.storeWarning === 'string' && json.storeWarning ? json.storeWarning : null);
        if (res.status === 503) {
          reportClientTelemetry({
            event: 'route_compute_503',
            category: json.storeWarning ? 'shared_store_degraded' : 'service_unavailable',
            httpStatus: 503,
            route: '/activities',
            message: json.error || 'Route calculation unavailable (503)',
          });
        }
        if (!res.ok) throw new Error(json.error || `Route calculation failed (HTTP ${res.status})`);
        const paths = (json.encodedPolylines ?? []).map((enc) => decodeEncodedPolyline(enc)).filter((pts) => pts.length >= 2);
        const source: RouteSource = json.source === 'osrm' ? 'osrm' : 'straight-line';
        const result: ComputedRouteResult = {
          source,
          totalDistanceMeters: json.totalDistanceMeters ?? 0,
          totalDurationSeconds: json.totalDurationSeconds ?? 0,
          legs: json.legs ?? [],
          paths,
        };

        if (source === 'osrm') {
          routeCacheRef.current[stopCoordsKey] = result;
          setComputedRoute(result);
          setRouteStatus({ loading: false, error: null });
        } else {
          setComputedRoute(result);
          setRouteStatus({
            loading: false,
            error: json.fallbackReason
              ? `${json.fallbackReason} Showing straight-line distance baseline.`
              : 'Road routing service unavailable. Showing straight-line distance baseline.',
          });
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const fallback = buildStraightLineRoute(footprint.stops);
        setComputedRoute({
          source: 'straight-line',
          totalDistanceMeters: fallback.totalDistanceMeters,
          totalDurationSeconds: 0,
          legs: fallback.legs,
          paths: [],
        });
        setRouteStatus({
          loading: false,
          error:
            err instanceof Error
              ? `${err.message} Showing straight-line distance baseline.`
              : 'Road routing unavailable. Showing straight-line distance baseline.',
        });
      }
    })();

    return () => controller.abort();
  }, [footprint.stops, travelMode, stopCoordsKey]);

  const selectedOp = useMemo(
    () => p.operators.find((o) => o.id === effectiveOpId) ?? null,
    [p.operators, effectiveOpId],
  );

  const applyHqCoords = (latStr: string, lngStr: string, statusText: string) => {
    setBaseHqLatStr(latStr);
    setBaseHqLngStr(lngStr);
    setBaseHqEnabled(true);
    saveHqToStorage(true, baseHqLabel, latStr, lngStr);
    setHqStatusMsg(statusText);
  };

  const captureCurrentHqGps = () => {
    if (capturingHqGps) {
      cancelHqGpsRef.current?.();
      cancelHqGpsRef.current = null;
      setCapturingHqGps(false);
      setHqStatusMsg('Cancelled GPS capture.');
      return;
    }
    setCapturingHqGps(true);
    setHqStatusMsg('Locking high-accuracy GPS (target ≤3m, max 10m)…');
    cancelHqGpsRef.current = startHighAccuracyGpsCapture({
      onProgress: (prog) => {
        setHqHintCoords({ ...prog.lastCoords, accuracy: prog.bestAccuracy });
        setHqStatusMsg(
          prog.validCount > 0
            ? `Refining Base HQ… ±${prog.currentAccuracy}m (${prog.validCount}/${prog.targetSamples} tight fixes)`
            : `Locking Base HQ… ±${prog.currentAccuracy}m (waiting for ≤10m · ${prog.elapsedSec}s)`,
        );
      },
      onLocked: (res) => {
        cancelHqGpsRef.current = null;
        setCapturingHqGps(false);
        const latStr = res.lat.toFixed(6);
        const lngStr = res.lng.toFixed(6);
        setHqHintCoords({ lat: res.lat, lng: res.lng, accuracy: res.accuracy });
        applyHqCoords(latStr, lngStr, `✓ Captured Base HQ (${latStr}, ${lngStr} · GPS ±${res.accuracy}m)`);
      },
      onError: (failure) => {
        cancelHqGpsRef.current = null;
        setCapturingHqGps(false);
        if (failure.lastCoords) setHqHintCoords({ ...failure.lastCoords, accuracy: failure.bestAccuracy });
        setHqStatusMsg(failure.message);
      },
    });
  };

  const copyHqFromFirstStop = () => {
    const firstActStop = footprint.stops.find((s) => s.kind === 'activity');
    if (!firstActStop) return;
    applyHqCoords(firstActStop.lat.toFixed(6), firstActStop.lng.toFixed(6), `✓ Set Base HQ from Stop #${firstActStop.sequence}`);
  };

  const totalLogsForOp = footprint.mappedCount + footprint.unmappedCount;
  const activeOpsWithGps = teamSummary.filter((r) => r.mappedCount > 0).length;
  const isFallbackLine = !computedRoute || computedRoute.source === 'straight-line' || computedRoute.paths.length === 0;
  const tileConfig = resolveMapTileConfig(mapStyle);
  const publicTileNotice = p.isAdmin ? getPublicTileAdminNotice(mapStyle, tileConfig) : null;

  const hqInputs = [
    { label: 'HQ Label', value: baseHqLabel, onChange: setBaseHqLabel, placeholder: 'Main Plant / Base HQ', decimal: false },
    { label: 'Latitude', value: baseHqLatStr, onChange: setBaseHqLatStr, placeholder: 'e.g. 10.775100', decimal: true },
    { label: 'Longitude', value: baseHqLngStr, onChange: setBaseHqLngStr, placeholder: 'e.g. 122.543200', decimal: true },
  ];

  const roadDistValue =
    footprint.stops.length < 2
      ? '0.00 km'
      : routeStatus.loading
        ? 'Calculating…'
        : computedRoute
          ? formatDistanceKm(computedRoute.totalDistanceMeters)
          : '—';
  const roadDistSubtitle =
    footprint.stops.length < 2
      ? 'Needs at least 2 GPS points'
      : computedRoute?.source === 'straight-line'
        ? 'Straight-line fallback (road router unavailable)'
        : computedRoute
          ? `${TRAVEL_MODE_LABELS[travelMode]} OSRM route${baseHqConfig ? ' · incl. Base HQ' : ''}`
          : 'Road route unavailable';
  const travelTimeValue =
    footprint.stops.length < 2
      ? '0 min'
      : routeStatus.loading
        ? 'Calculating…'
        : computedRoute?.source === 'osrm'
          ? formatDuration(computedRoute.totalDurationSeconds)
          : '—';
  const coverageSubtitle =
    footprint.unmappedCount > 0
      ? `${footprint.unmappedCount} log${footprint.unmappedCount === 1 ? '' : 's'} missing GPS`
      : totalLogsForOp > 0
        ? '100% of logs have GPS'
        : 'No activities logged on date';

  return (
    <div className="stack-md">
      <div className="card card-pad stack-md">
        <div className="row-between-wrap">
          <div>
            <strong style={{ fontSize: 15 }}>Daily Field Footprints &amp; Travel Distance ({p.date})</strong>
            <div className="text-secondary-sm">
              Plots chronological GPS check-ins on the map and estimates road distance using configured OSRM routing.
            </div>
          </div>
          {p.canVerifyActivity && (
            <span className="text-secondary-sm font-bold">
              {activeOpsWithGps} of {p.operators.length} staff with GPS pins on {p.date}
            </span>
          )}
        </div>

        <div className="row-wrap" style={{ alignItems: 'end', gap: 10 }}>
          {p.canVerifyActivity ? (
            <label className="field-label" style={{ flex: '1 1 200px', minWidth: 0 }}>
              <span>Operator / Field Staff</span>
              <select className="input" value={selectedOpId} onChange={(e) => setSelectedOpId(e.target.value)}>
                {p.operators.map((op) => {
                  const row = teamSummary.find((r) => r.operatorId === op.id);
                  return (
                    <option key={op.id} value={op.id}>
                      {op.full_name} ({row && row.mappedCount > 0 ? `${row.mappedCount} GPS` : '0 GPS'})
                    </option>
                  );
                })}
              </select>
            </label>
          ) : (
            <div className="card-pad-xs text-sm" style={{ ...MUTED_BOX_STYLE, minHeight: 38, display: 'flex', alignItems: 'center' }}>
              Viewing your route: <b>{selectedOp?.full_name ?? 'Unlinked Operator Account'}</b>
            </div>
          )}

          <label className="field-label">
            <span>Travel Mode</span>
            <select className="input" value={travelMode} onChange={(e) => setTravelMode(e.target.value as RouteTravelMode)}>
              <option value="DRIVE">Driving (Service Vehicle)</option>
              <option value="TWO_WHEELER">Motorcycle (Road Profile)</option>
              <option value="WALK">Walking</option>
            </select>
          </label>

          <div className="field-label">
            <span>Activity Role Scope</span>
            <SegmentedTabs
              ariaLabel="Activity role scope"
              size="sm"
              value={includeCrew ? 'all' : 'lead'}
              onChange={(v) => setIncludeCrew(v === 'all')}
              items={[{ id: 'lead', label: 'Lead Only' }, { id: 'all', label: 'Lead + Crew' }]}
            />
          </div>

          <div className="field-label">
            <span>Base HQ Round-Trip</span>
            <div className="row-xs">
              <button
                type="button"
                className={`btn ${baseHqEnabled && parsedHqCoords ? 'btn-primary' : ''}`}
                onClick={() => {
                  if (!parsedHqCoords) return setHqEditorOpen(true);
                  const nextEnabled = !baseHqEnabled;
                  setBaseHqEnabled(nextEnabled);
                  saveHqToStorage(nextEnabled, baseHqLabel, baseHqLatStr, baseHqLngStr);
                }}
              >
                {baseHqEnabled && parsedHqCoords ? '✓ Round-Trip On' : 'Off (Stops Only)'}
              </button>
              <button type="button" className="btn" onClick={() => setHqEditorOpen((v) => !v)}>
                {hqEditorOpen ? 'Hide Base HQ' : 'Set Base HQ'}
              </button>
            </div>
          </div>
        </div>

        {hqEditorOpen && (
          <div className="card-pad-sm stack-sm" style={MUTED_BOX_STYLE}>
            <div className="text-sm font-bold">Plant / Base HQ Coordinates (saved in this browser)</div>
            <div className="row-wrap" style={{ alignItems: 'end' }}>
              {hqInputs.map((f) => (
                <label key={f.label} className="field-label" style={{ flex: '1 1 140px', minWidth: 0 }}>
                  <span>{f.label}</span>
                  <input
                    className="input"
                    type="text"
                    inputMode={f.decimal ? 'decimal' : undefined}
                    value={f.value}
                    onChange={(e) => f.onChange(e.target.value)}
                    placeholder={f.placeholder}
                  />
                </label>
              ))}
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  if (!parseLatLngPair(baseHqLatStr, baseHqLngStr)) {
                    setHqStatusMsg('Enter valid numeric latitude (-90 to 90) and longitude (-180 to 180).');
                    return;
                  }
                  applyHqCoords(baseHqLatStr, baseHqLngStr, '✓ Base HQ saved and round-trip enabled.');
                }}
              >
                Save &amp; Enable
              </button>
              <button type="button" className="btn btn-sm" onClick={captureCurrentHqGps}>
                {capturingHqGps ? '🛰️ Locking ≤10m… (Cancel)' : 'Use Device GPS (≤10m)'}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  cancelHqGpsRef.current?.();
                  cancelHqGpsRef.current = null;
                  setCapturingHqGps(false);
                  setHqPinModalOpen(true);
                }}
              >
                🗺️ Pin HQ on Map
              </button>
              {footprint.stops.some((s) => s.kind === 'activity') && (
                <button type="button" className="btn btn-sm" onClick={copyHqFromFirstStop}>
                  Use Stop #1 GPS
                </button>
              )}
              {parsedHqCoords && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setBaseHqEnabled(false);
                    setBaseHqLatStr('');
                    setBaseHqLngStr('');
                    saveHqToStorage(false, baseHqLabel, '', '');
                    setHqStatusMsg('Cleared saved Base HQ.');
                  }}
                >
                  Clear
                </button>
              )}
            </div>
            {hqStatusMsg && <div className="text-secondary-sm">{hqStatusMsg}</div>}
          </div>
        )}

        {hqPinModalOpen && (
          <GpsPinPickerModal
            open={hqPinModalOpen}
            isAdmin={p.isAdmin}
            initialLat={parsedHqCoords?.lat ?? null}
            initialLng={parsedHqCoords?.lng ?? null}
            hintCoords={hqHintCoords}
            title="Pin Base HQ Location"
            onClose={() => setHqPinModalOpen(false)}
            onConfirm={({ lat, lng }) => {
              const latStr = lat.toFixed(6);
              const lngStr = lng.toFixed(6);
              setHqPinModalOpen(false);
              applyHqCoords(latStr, lngStr, `✓ Pinned Base HQ (${latStr}, ${lngStr})`);
            }}
          />
        )}
      </div>

      {!p.canVerifyActivity && !effectiveOpId && (
        <div className="card card-pad text-secondary-sm">
          Your user account is not linked to an operator profile yet. Ask an administrator in Setup to link your account to view your daily footprints.
        </div>
      )}

      {effectiveOpId && (
        <div className="grid-auto-sm">
          <StatCard label="EST. ROAD DISTANCE" value={roadDistValue} subtitle={roadDistSubtitle} />
          <StatCard
            label="EST. TRAVEL TIME"
            value={travelTimeValue}
            subtitle={
              footprint.firstTimestamp && footprint.lastTimestamp
                ? `Logs: ${fmtTimeManila(footprint.firstTimestamp)} → ${fmtTimeManila(footprint.lastTimestamp)}`
                : 'No timestamped GPS stops'
            }
          />
          <StatCard label="STRAIGHT-LINE DISTANCE" value={formatDistanceKm(footprint.straightLineTotalMeters)} subtitle="Point-to-point Haversine baseline" />
          <StatCard
            label="GPS LOG COVERAGE"
            value={`${footprint.mappedCount} / ${totalLogsForOp}`}
            subtitleTone={footprint.unmappedCount > 0 ? 'warn' : 'default'}
            subtitle={coverageSubtitle}
          />
        </div>
      )}

      {routeStatus.error && <AlertBanner tone="warn">{routeStatus.error}</AlertBanner>}
      {p.isAdmin && storeWarning && (
        <AlertBanner tone="warn"><strong>Shared route store degraded:</strong> {storeWarning}</AlertBanner>
      )}

      {effectiveOpId && (
        <div className="routes-desktop-split">
          <div className="card card-pad-sm stack-sm" style={{ minWidth: 0 }}>
            <div className="row-between-wrap">
              <div>
                <strong style={{ fontSize: 14 }}>
                  Route Map — {selectedOp?.full_name ?? 'Operator'} ({footprint.stops.length} plotted point{footprint.stops.length === 1 ? '' : 's'})
                </strong>
                <div className="text-secondary-xs">Click any numbered pin to inspect the activity log</div>
              </div>
              <SegmentedTabs
                ariaLabel="Map style"
                size="sm"
                value={mapStyle}
                onChange={setMapStyle}
                items={getMapStyleOptions()}
              />
            </div>

            {footprint.stops.length === 0 ? (
              <EmptyState
                minHeight={300}
                title={`No GPS footprints recorded for ${selectedOp?.full_name ?? 'this operator'} on ${p.date}.`}
                description={
                  footprint.unmappedCount > 0
                    ? `${footprint.unmappedCount} activity log(s) exist on this date without captured GPS coordinates.`
                    : 'Field operators can capture GPS automatically using the GPS button inside the Activity Logger.'
                }
              />
            ) : (
              <div style={{ width: '100%', height: 'clamp(340px, 56vh, 520px)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                <FreeRouteMap
                  stops={footprint.stops}
                  routePaths={computedRoute?.paths ?? []}
                  isFallbackLine={isFallbackLine}
                  selectedStopId={selectedStopId}
                  onSelectStop={setSelectedStopId}
                  mapStyle={mapStyle}
                />
              </div>
            )}

            {publicTileNotice && (
              <AlertBanner tone="warn"><strong>Public map tiles active:</strong> {publicTileNotice}</AlertBanner>
            )}
            <div className="text-secondary-xs">
              Location note: Coordinates reflect operator-initiated GPS check-ins captured when submitting daily field activities. Active map tiles: {tileConfig.providerLabel}; road distances computed via server-side OSRM routing with straight-line fallback.
            </div>
          </div>

          <div style={{ maxHeight: 520, overflowY: 'auto', minWidth: 0 }}>
            <RouteStopsList
              stops={footprint.stops}
              unmappedActivities={footprint.unmappedActivities}
              straightLineLegsMeters={footprint.straightLineLegsMeters}
              computedRoute={computedRoute}
              selectedStopId={selectedStopId}
              onSelectStop={setSelectedStopId}
            />
          </div>
        </div>
      )}

      {p.canVerifyActivity && (
        <RoutesTeamOverview
          date={p.date}
          teamSummary={teamSummary}
          selectedOpId={effectiveOpId}
          onSelectOperator={setSelectedOpId}
        />
      )}
    </div>
  );
}
