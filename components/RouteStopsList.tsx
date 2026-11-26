'use client';

import type { DailyActivityRow } from '@/lib/activity-types';
import { fmtTimeManila } from '@/lib/date';
import {
  formatDistanceKm,
  formatDuration,
  type RouteLegEstimate,
  type RouteSource,
  type RouteStop,
} from '@/lib/route-footprints';
import { AlertBanner } from '@/components/ui';

export interface RouteStopsListProps {
  stops: RouteStop[];
  unmappedActivities: DailyActivityRow[];
  straightLineLegsMeters: number[];
  computedRoute: {
    source: RouteSource;
    legs: RouteLegEstimate[];
  } | null;
  selectedStopId: string | null;
  onSelectStop: (stopId: string) => void;
}

/** Chronological GPS stop itinerary with leg distance/duration breakdown and unmapped-log warnings. */
export default function RouteStopsList({
  stops,
  unmappedActivities,
  straightLineLegsMeters,
  computedRoute,
  selectedStopId,
  onSelectStop,
}: RouteStopsListProps) {
  return (
    <>
      {stops.length > 0 && (
        <div className="card card-pad stack-md">
          <strong style={{ fontSize: 14 }}>Chronological Stop Itinerary &amp; Leg Distances</strong>
          <div className="responsive-table-wrap scroll-x">
            <table className="data-table">
              <thead>
                <tr style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                  <th>#</th>
                  <th>Time</th>
                  <th>Stop / Activity</th>
                  <th>Role</th>
                  <th>GPS Coordinates</th>
                  <th className="text-right">Leg Road Dist.</th>
                  <th className="text-right">Leg Est. Time</th>
                  <th className="text-right">Straight-Line</th>
                </tr>
              </thead>
              <tbody>
                {stops.map((stop, idx) => {
                  const legIdx = idx - 1;
                  const roadLeg = legIdx >= 0 ? computedRoute?.legs?.[legIdx] : undefined;
                  const straightLeg = legIdx >= 0 ? straightLineLegsMeters[legIdx] : undefined;
                  const isFocused = selectedStopId === stop.id;
                  return (
                    <tr
                      key={stop.id}
                      onClick={() => onSelectStop(stop.id)}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        background: isFocused ? 'var(--info-bg)' : undefined,
                        cursor: 'pointer',
                      }}
                    >
                      <td className="font-bold">
                        <span
                          className="text-center"
                          style={{
                            display: 'inline-block',
                            minWidth: 24,
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
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {stop.timestamp ? fmtTimeManila(stop.timestamp) : stop.kind === 'base_start' ? 'Depart' : 'Return'}
                      </td>
                      <td>
                        <div className="font-bold">{stop.label}</div>
                        {stop.sublabel && <div className="text-secondary-xs">{stop.sublabel}</div>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {stop.kind !== 'activity' ? 'Base HQ' : stop.roleInActivity === 'lead' ? 'Lead' : 'Crew'}
                      </td>
                      <td className="mono-xs" style={{ whiteSpace: 'nowrap' }}>
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
                      <td className="text-right font-bold tabular-nums" style={{ whiteSpace: 'nowrap' }}>
                        {idx === 0 ? 'Start' : roadLeg ? formatDistanceKm(roadLeg.distanceMeters) : '—'}
                      </td>
                      <td className="text-right tabular-nums" style={{ whiteSpace: 'nowrap' }}>
                        {idx === 0
                          ? '—'
                          : roadLeg && computedRoute?.source === 'osrm'
                            ? formatDuration(roadLeg.durationSeconds)
                            : '—'}
                      </td>
                      <td className="text-right text-secondary-sm tabular-nums" style={{ whiteSpace: 'nowrap' }}>
                        {idx === 0 ? '—' : formatDistanceKm(straightLeg)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="responsive-cards">
            {stops.map((stop, idx) => {
              const legIdx = idx - 1;
              const roadLeg = legIdx >= 0 ? computedRoute?.legs?.[legIdx] : undefined;
              const straightLeg = legIdx >= 0 ? straightLineLegsMeters[legIdx] : undefined;
              const isFocused = selectedStopId === stop.id;
              return (
                <div
                  key={stop.id}
                  onClick={() => onSelectStop(stop.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectStop(stop.id);
                    }
                  }}
                  className="card"
                  style={{
                    padding: 10,
                    display: 'grid',
                    gap: 6,
                    background: isFocused ? 'var(--info-bg)' : 'var(--surface-muted)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span
                        className="text-center font-bold"
                        style={{
                          display: 'inline-block',
                          minWidth: 26,
                          padding: '2px 6px',
                          borderRadius: 6,
                          background: stop.kind === 'activity' ? stop.color : '#0f172a',
                          color: '#ffffff',
                          fontSize: 11,
                          flexShrink: 0,
                        }}
                      >
                        {stop.kind === 'activity' ? stop.sequence : 'HQ'}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div className="font-bold" style={{ fontSize: 13 }}>{stop.label}</div>
                        {stop.sublabel && <div className="text-secondary-xs">{stop.sublabel}</div>}
                      </div>
                    </div>
                    <div className="text-right" style={{ flexShrink: 0, fontSize: 11.5 }}>
                      <div className="font-bold">
                        {stop.timestamp ? fmtTimeManila(stop.timestamp) : stop.kind === 'base_start' ? 'Depart' : 'Return'}
                      </div>
                      <div className="text-secondary-xs">
                        {stop.kind !== 'activity' ? 'Base HQ' : stop.roleInActivity === 'lead' ? 'Lead' : 'Crew'}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, fontSize: 11.5 }}>
                    <div>
                      <div className="text-secondary-xs">Road Dist.</div>
                      <div className="font-bold tabular-nums">{idx === 0 ? 'Start' : roadLeg ? formatDistanceKm(roadLeg.distanceMeters) : '—'}</div>
                    </div>
                    <div>
                      <div className="text-secondary-xs">Est. Time</div>
                      <div className="tabular-nums">
                        {idx === 0 ? '—' : roadLeg && computedRoute?.source === 'osrm' ? formatDuration(roadLeg.durationSeconds) : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-secondary-xs">Straight-Line</div>
                      <div className="tabular-nums text-secondary-sm">{idx === 0 ? '—' : formatDistanceKm(straightLeg)}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${stop.lat}&mlon=${stop.lng}#map=17/${stop.lat}/${stop.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="btn btn-sm mono-xs"
                      style={{ textDecoration: 'none' }}
                    >
                      OSM {stop.lat.toFixed(4)}, {stop.lng.toFixed(4)} ↗
                    </a>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="btn btn-sm"
                      style={{ textDecoration: 'none' }}
                    >
                      Open GMaps ↗
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {unmappedActivities.length > 0 && (
        <AlertBanner tone="warn">
          <div className="stack-sm">
            <strong style={{ fontSize: 13 }}>
              {unmappedActivities.length} Activity Log{unmappedActivities.length === 1 ? '' : 's'} Without GPS (Excluded from Map &amp; Distance)
            </strong>
            <div className="stack-xs text-sm">
              {unmappedActivities.map((act) => (
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
    </>
  );
}
