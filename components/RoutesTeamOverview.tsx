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
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr style={{ textAlign: 'left' }}>
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
                        p.onSelectOperator(row.operatorId);
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
  );
}
