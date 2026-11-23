'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { DailyActivityRow } from '@/lib/activity-types';
import { fmtTimeManila } from '@/lib/date';
import { startHighAccuracyGpsCapture } from '@/lib/gps-accuracy';
import { resolveMapTileConfig } from '@/lib/map-tiles';
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
import RoutesTeamOverview from '@/components/RoutesTeamOverview';
import { AlertBanner, EmptyState, SegmentedTabs, StatCard } from '@/components/ui';

const GpsPinPickerModal = dynamic(() => import('@/components/GpsPinPickerModal'), { ssr: false });

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
  source: RouteSource;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  legs: RouteLegEstimate[];
  paths: LatLng[][];
};

const BASE_HQ_STORAGE_KEY = 'bpwi-base-hq-v1';

export default function ActivitiesRoutesTab(p: {
  date: string;
  canVerifyActivity: boolean;
  operatorId: string | null;
  operators: RouteOp[];
  areas: RouteArea[];
  activities: DailyActivityRow[];
}) {
  const [includeCrew, setIncludeCrew] = useState(true);
  const [travelMode, setTravelMode] = useState<RouteTravelMode>('DRIVE');
  const [mapStyle, setMapStyle] = useState<FreeMapStyle>('street');
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);

  // Base HQ optional round-trip config (persisted locally in browser)
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

  useEffect(() => {
    return () => {
      cancelHqGpsRef.current?.();
      cancelHqGpsRef.current = null;
    };
  }, []);

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

  useEffect(() => {
    setSelectedStopId(null);
  }, [effectiveOpId, p.date, includeCrew, baseHqConfig]);

  const stopCoordsKey = useMemo(
    () => buildRouteCacheKey(footprint.stops, travelMode),
    [footprint.stops, travelMode],
  );

  // Fetch free OSRM road route (with AbortController + straight-line fallback)
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
          body: JSON.stringify({
            stops: footprint.stops.map((s) => ({ lat: s.lat, lng: s.lng })),
            travelMode,
          }),
        });

        const json = (await res.json()) as {
          source?: RouteSource;
          fallbackReason?: string;
          totalDistanceMeters?: number;
          totalDurationSeconds?: number;
          legs?: RouteLegEstimate[];
          encodedPolylines?: string[];
          error?: string;
        };

        if (!res.ok) {
          throw new Error(json.error || `Route calculation failed (HTTP ${res.status})`);
        }

        if (controller.signal.aborted) return;

        const paths = (json.encodedPolylines ?? [])
          .map((enc) => decodeEncodedPolyline(enc))
          .filter((pts) => pts.length >= 2);
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

    return () => {
      controller.abort();
    };
  }, [footprint.stops, travelMode, stopCoordsKey]);

  const selectedOp = useMemo(
    () => p.operators.find((o) => o.id === effectiveOpId) ?? null,
    [p.operators, effectiveOpId],
  );

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
        setBaseHqLatStr(latStr);
        setBaseHqLngStr(lngStr);
        setBaseHqEnabled(true);
        saveHqConfig({ enabled: true, label: baseHqLabel, latStr, lngStr });
        setHqStatusMsg(`✓ Captured Base HQ (${latStr}, ${lngStr} · GPS ±${res.accuracy}m)`);
      },
      onError: (failure) => {
        cancelHqGpsRef.current = null;
        setCapturingHqGps(false);
        if (failure.lastCoords) {
          setHqHintCoords({ ...failure.lastCoords, accuracy: failure.bestAccuracy });
        }
        setHqStatusMsg(failure.message);
      },
    });
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

  const totalLogsForOp = footprint.mappedCount + footprint.unmappedCount;
  const activeOpsWithGps = teamSummary.filter((r) => r.mappedCount > 0).length;
  const isFallbackLine = !computedRoute || computedRoute.source === 'straight-line' || computedRoute.paths.length === 0;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Controls Bar */}
      <div className="card" style={{ padding: 14, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <strong style={{ fontSize: 15 }}>Daily Field Footprints &amp; Travel Distance ({p.date})</strong>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Plots chronological GPS check-ins on the map and estimates road distance using configured OSRM routing.
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
                className="input"
                value={selectedOpId}
                onChange={(e) => setSelectedOpId(e.target.value)}
                style={{ width: 'auto', minHeight: 36 }}
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
              className="input"
              value={travelMode}
              onChange={(e) => setTravelMode(e.target.value as RouteTravelMode)}
              style={{ width: 'auto', minHeight: 36 }}
            >
              <option value="DRIVE">Driving (Service Vehicle)</option>
              <option value="TWO_WHEELER">Motorcycle (Road Profile)</option>
              <option value="WALK">Walking</option>
            </select>
          </label>

          <div style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span style={{ fontWeight: 700 }}>Activity Role Scope</span>
            <SegmentedTabs
              ariaLabel="Activity role scope"
              size="sm"
              value={includeCrew ? 'all' : 'lead'}
              onChange={(v) => setIncludeCrew(v === 'all')}
              items={[
                { id: 'lead', label: 'Lead Only' },
                { id: 'all', label: 'Lead + Crew' },
              ]}
            />
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
                  className="input"
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
                  className="input"
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
                  className="input"
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
                {capturingHqGps ? '🛰️ Locking ≤10m… (Cancel)' : 'Use Device GPS (≤10m)'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  cancelHqGpsRef.current?.();
                  cancelHqGpsRef.current = null;
                  setCapturingHqGps(false);
                  setHqPinModalOpen(true);
                }}
                style={{ minHeight: 34, fontSize: 12 }}
              >
                🗺️ Pin HQ on Map
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
        {hqPinModalOpen && (
          <GpsPinPickerModal
            open={hqPinModalOpen}
            initialLat={parsedHqCoords?.lat ?? null}
            initialLng={parsedHqCoords?.lng ?? null}
            hintCoords={hqHintCoords}
            title="Pin Base HQ Location"
            onClose={() => setHqPinModalOpen(false)}
            onConfirm={({ lat, lng }) => {
              const latStr = lat.toFixed(6);
              const lngStr = lng.toFixed(6);
              setHqPinModalOpen(false);
              setBaseHqLatStr(latStr);
              setBaseHqLngStr(lngStr);
              setBaseHqEnabled(true);
              saveHqConfig({ enabled: true, label: baseHqLabel, latStr, lngStr });
              setHqStatusMsg(`✓ Pinned Base HQ (${latStr}, ${lngStr})`);
            }}
          />
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
          <StatCard
            label="EST. ROAD DISTANCE"
            value={
              footprint.stops.length < 2
                ? '0.00 km'
                : routeStatus.loading
                  ? 'Calculating…'
                  : computedRoute
                    ? formatDistanceKm(computedRoute.totalDistanceMeters)
                    : '—'
            }
            subtitle={
              footprint.stops.length < 2
                ? 'Needs at least 2 GPS points'
                : computedRoute?.source === 'straight-line'
                  ? 'Straight-line fallback (road router unavailable)'
                  : computedRoute
                    ? `${travelMode === 'DRIVE' ? 'Driving' : travelMode === 'TWO_WHEELER' ? 'Motorcycle' : 'Walking'} OSRM route${baseHqConfig ? ' · incl. Base HQ' : ''}`
                    : 'Road route unavailable'
            }
          />
          <StatCard
            label="EST. TRAVEL TIME"
            value={
              footprint.stops.length < 2
                ? '0 min'
                : routeStatus.loading
                  ? 'Calculating…'
                  : computedRoute?.source === 'osrm'
                    ? formatDuration(computedRoute.totalDurationSeconds)
                    : '—'
            }
            subtitle={
              footprint.firstTimestamp && footprint.lastTimestamp
                ? `Logs: ${fmtTimeManila(footprint.firstTimestamp)} → ${fmtTimeManila(footprint.lastTimestamp)}`
                : 'No timestamped GPS stops'
            }
          />
          <StatCard
            label="STRAIGHT-LINE DISTANCE"
            value={formatDistanceKm(footprint.straightLineTotalMeters)}
            subtitle="Point-to-point Haversine baseline"
          />
          <StatCard
            label="GPS LOG COVERAGE"
            value={`${footprint.mappedCount} / ${totalLogsForOp}`}
            subtitleTone={footprint.unmappedCount > 0 ? 'warn' : 'default'}
            subtitle={
              footprint.unmappedCount > 0
                ? `${footprint.unmappedCount} log${footprint.unmappedCount === 1 ? '' : 's'} missing GPS`
                : totalLogsForOp > 0
                  ? '100% of logs have GPS'
                  : 'No activities logged on date'
            }
          />
        </div>
      )}

      {/* Route Warning / Fallback Notice */}
      {routeStatus.error && <AlertBanner tone="warn">{routeStatus.error}</AlertBanner>}

      {/* Interactive Free Map Canvas */}
      {effectiveOpId && (
        <div className="card" style={{ padding: 12, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <strong style={{ fontSize: 14 }}>
                Route Map — {selectedOp?.full_name ?? 'Operator'} ({footprint.stops.length} plotted point{footprint.stops.length === 1 ? '' : 's'})
              </strong>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                Click any numbered pin to inspect the activity log
              </div>
            </div>
            <SegmentedTabs
              ariaLabel="Map style"
              size="sm"
              value={mapStyle}
              onChange={setMapStyle}
              items={[
                { id: 'street', label: 'Street (OSM)' },
                { id: 'satellite', label: 'Satellite' },
              ]}
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
            <div
              style={{
                width: '100%',
                height: 460,
                borderRadius: 8,
                overflow: 'hidden',
                border: '1px solid var(--border)',
              }}
            >
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

          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
            Location note: Coordinates reflect operator-initiated GPS check-ins captured when submitting daily field activities. Active map tiles: {resolveMapTileConfig(mapStyle).providerLabel}; road distances computed via server-side OSRM routing with straight-line fallback.
          </div>
        </div>
      )}

      {/* Chronological Stop-by-Stop Itinerary Table */}
      {effectiveOpId && footprint.stops.length > 0 && (
        <div className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
          <strong style={{ fontSize: 14 }}>Chronological Stop Itinerary &amp; Leg Distances</strong>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr style={{ textAlign: 'left' }}>
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
                          href={`https://www.openstreetmap.org/?mlat=${stop.lat}&mlon=${stop.lng}#map=17/${stop.lat}/${stop.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ color: 'var(--accent)', textDecoration: 'none' }}
                        >
                          {stop.lat.toFixed(5)}, {stop.lng.toFixed(5)} ↗
                        </a>{' '}
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ color: 'var(--text-muted)', fontSize: 10.5, textDecoration: 'none' }}
                        >
                          (GMaps)
                        </a>
                      </td>
                      <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {idx === 0 ? 'Start' : roadLeg ? formatDistanceKm(roadLeg.distanceMeters) : '—'}
                      </td>
                      <td style={{ padding: '7px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {idx === 0
                          ? '—'
                          : roadLeg && computedRoute?.source === 'osrm'
                            ? formatDuration(roadLeg.durationSeconds)
                            : '—'}
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
        <AlertBanner tone="warn">
          <div style={{ display: 'grid', gap: 6 }}>
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
        </AlertBanner>
      )}

      {/* Supervisor Team Overview Table */}
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
