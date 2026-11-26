'use client';

import { fmtTimeManila } from '@/lib/date';
import { formatDistanceKm, type TeamFootprintSummary } from '@/lib/route-footprints';

export default function RoutesTeamOverview(p: {
  date: string;
  teamSummary: TeamFootprintSummary[];
  selectedOpId: string;
  onSelectOperator: (operatorId: string) => void;
}) {
  return (
    <div className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong style={{ fontSize: 14 }}>Team Daily Footprint Overview ({p.date})</strong>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Click any staff member to inspect their OpenStreetMap route and leg breakdown on the map above.
          </div>
        </div>
      </div>
      <div className="responsive-table-wrap scroll-x">
        <table className="data-table data-table-sticky">
          <thead>
            <tr style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
              <th style={{ padding: '7px 8px' }}>Operator</th>
              <th style={{ padding: '7px 8px', textAlign: 'right' }}>GPS Stops</th>
              <th style={{ padding: '7px 8px', textAlign: 'right' }}>No-GPS Logs</th>
              <th style={{ padding: '7px 8px' }}>Active Window</th>
              <th style={{ padding: '7px 8px', textAlign: 'right' }}>Straight-Line Est.</th>
              <th style={{ padding: '7px 8px', textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {p.teamSummary.map((row) => {
              const isCurrent = row.operatorId === p.selectedOpId;
              return (
                <tr
                  key={row.operatorId}
                  onClick={() => p.onSelectOperator(row.operatorId)}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    background: isCurrent ? 'var(--info-bg)' : undefined,
                    cursor: 'pointer',
                  }}
                >
                  <td style={{ padding: '7px 8px' }}>
                    <div style={{ fontWeight: 700 }}>{row.fullName}</div>
                    {row.position && (
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{row.position}</div>
                    )}
                  </td>
                  <td className="tabular-nums" style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {row.mappedCount}
                  </td>
                  <td
                    className="tabular-nums"
                    style={{
                      padding: '7px 8px',
                      textAlign: 'right',
                      color: row.unmappedCount > 0 ? 'var(--warn-fg)' : 'var(--text-secondary)',
                      fontWeight: row.unmappedCount > 0 ? 700 : 400,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.unmappedCount}
                  </td>
                  <td className="tabular-nums" style={{ padding: '7px 8px', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                    {row.firstTimestamp && row.lastTimestamp
                      ? `${fmtTimeManila(row.firstTimestamp)} → ${fmtTimeManila(row.lastTimestamp)}`
                      : '—'}
                  </td>
                  <td className="tabular-nums" style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {formatDistanceKm(row.straightLineMeters)}
                  </td>
                  <td style={{ padding: '7px 8px', textAlign: 'right' }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${isCurrent ? 'btn-primary' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        p.onSelectOperator(row.operatorId);
                      }}
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
      <div className="responsive-cards">
        {p.teamSummary.map((row) => {
          const isCurrent = row.operatorId === p.selectedOpId;
          return (
            <div
              key={row.operatorId}
              className="card"
              onClick={() => p.onSelectOperator(row.operatorId)}
              style={{
                padding: 10,
                display: 'grid',
                gap: 8,
                background: isCurrent ? 'var(--info-bg)' : 'var(--surface-muted)',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{row.fullName}</div>
                  {row.position && (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{row.position}</div>
                  )}
                </div>
                <button
                  type="button"
                  className={`btn btn-sm ${isCurrent ? 'btn-primary' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    p.onSelectOperator(row.operatorId);
                  }}
                >
                  {isCurrent ? 'Viewing' : 'Inspect Route'}
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 6, fontSize: 11.5 }}>
                <div>
                  <div className="text-secondary-xs">GPS Stops / No-GPS</div>
                  <div className="font-bold tabular-nums">
                    {row.mappedCount} stops
                    {row.unmappedCount > 0 && (
                      <span style={{ color: 'var(--warn-fg)', marginLeft: 4 }}>({row.unmappedCount} unmapped)</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-secondary-xs">Active Window</div>
                  <div className="tabular-nums">
                    {row.firstTimestamp && row.lastTimestamp
                      ? `${fmtTimeManila(row.firstTimestamp)} → ${fmtTimeManila(row.lastTimestamp)}`
                      : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-secondary-xs">Straight-Line Est.</div>
                  <div className="font-bold tabular-nums">{formatDistanceKm(row.straightLineMeters)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
