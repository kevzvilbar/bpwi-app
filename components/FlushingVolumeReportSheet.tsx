'use client';

import type { DailyActivityRow } from '@/lib/activity-types';
import { formatTaggedGpsPosition } from '@/lib/gps-accuracy';
import {
  WATER_DENSITY_KG_M3,
  formatFlushingMeterStatusLabel,
  hydrateFlushingSummaryFromDetails,
} from '@/lib/flushing-volume';
import {
  BPWI_COMPANY_ADDRESS,
  REPORT_BORDER,
  REPORT_BORDER_HEAVY,
  REPORT_META_BOX_STYLE,
  REPORT_SECTION_BAR_STYLE,
  REPORT_TABLE_STYLE,
  ReportLetterhead,
  ReportSignatureGrid,
  formatReportPrintedTs,
} from '@/components/ReportSheetPrimitives';

interface FlushingVolumeReportSheetProps {
  activity: DailyActivityRow;
  orgName: string;
  areaLabel: string;
  leadOpName: string;
  crewNames?: string[];
}

const B = REPORT_BORDER;

/**
 * Printable BPWI "COMPUTATION OF FLUSHING VOLUME" sheet matching BPWI's orifice volume format
 * (without billing/cost rows). Supports Metered differentials and per-blow-off Torricelli math.
 */
export default function FlushingVolumeReportSheet({
  activity,
  orgName,
  areaLabel,
  leadOpName,
  crewNames = [],
}: FlushingVolumeReportSheetProps) {
  const d = activity.details ?? {};
  const summary = hydrateFlushingSummaryFromDetails(d);
  const gpsInfo = formatTaggedGpsPosition(activity.gps_lat, activity.gps_lng, d);
  const refCode = `ACT-${activity.id.slice(0, 8).toUpperCase()}`;
  const locationLine = [activity.site_or_well, activity.block_lot].filter(Boolean).join(' · ') || '—';
  const isOrifice = summary.meterStatus !== 'metered';

  const basisLabel =
    summary.basis === 'orifice_theoretical'
      ? 'Theoretical Orifice Computation (Blow-Off Sum)'
      : summary.basis === 'mother_meter'
        ? 'Mother Meter Reading (Final − Initial)'
        : summary.basis === 'blowoff_meters'
          ? 'Blow-Off Meters Sum (Final − Initial)'
          : 'Not computed';

  return (
    <div style={{ color: '#0f172a', fontSize: 11.5, lineHeight: 1.35, display: 'grid', gap: 12 }}>
      <ReportLetterhead
        orgName={orgName}
        subtitle={BPWI_COMPANY_ADDRESS}
        title="COMPUTATION OF FLUSHING VOLUME"
        refCode={refCode}
        dateLabel={`Date: ${activity.activity_date}`}
        printedTs={formatReportPrintedTs(new Date().toISOString())}
      />

      {/* Site & Meter Metadata */}
      <div style={REPORT_META_BOX_STYLE}>
        <div><b>Business Area / Station:</b> {areaLabel || '—'}</div>
        <div><b>Location / Line:</b> {locationLine}</div>
        <div><b>Mother Meter Status:</b> {formatFlushingMeterStatusLabel(summary.meterStatus)}</div>
        <div><b>Volume Basis:</b> {basisLabel}</div>
        <div style={{ gridColumn: '1 / -1' }}>
          <b>GPS Position:</b> {gpsInfo ? `${gpsInfo.coords} (${gpsInfo.sourceLabel})` : 'Not tagged'}
        </div>
      </div>

      {/* Section I: Formula & Total Volume Callout */}
      <div style={{ border: REPORT_BORDER_HEAVY }}>
        <div style={REPORT_SECTION_BAR_STYLE}>
          I. Computation Summary
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.25fr 0.75fr',
            gap: 12,
            padding: '10px 12px',
            alignItems: 'center',
          }}
        >
          {isOrifice ? (
            <div style={{ fontSize: 11 }}>
              <div style={{ fontWeight: 800, marginBottom: 4 }}>FORMULA USED (Torricelli Orifice Equation):</div>
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5, paddingLeft: 10, display: 'grid', gap: 2 }}>
                <div>Q = μ × A × √(2ΔP / ρ), &nbsp; ρ = {WATER_DENSITY_KG_M3.toLocaleString()} kg/m³</div>
                <div>V = Σ (Q × t), &nbsp; A = π(d/2)²</div>
              </div>
              <div style={{ fontSize: 9.8, color: '#475569', marginTop: 4 }}>
                Theoretical orifice discharge estimate computed across {summary.blowOffPoints.length} blow-off point(s).
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 11 }}>
              <div style={{ fontWeight: 800, marginBottom: 4 }}>FORMULA USED (Meter Differential):</div>
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5, paddingLeft: 10, display: 'grid', gap: 2 }}>
                <div>V = Final Reading − Initial Reading</div>
                <div>
                  Mother Meter: {summary.motherMeterInitial ?? '—'} → {summary.motherMeterFinal ?? '—'} m³
                  {summary.motherMeterVolumeM3 !== null ? ` (${summary.motherMeterVolumeM3.toFixed(2)} m³)` : ''}
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gap: 4 }}>
            <div style={{ fontWeight: 800, fontSize: 11 }}>Total Flushing Volume:</div>
            <div
              style={{
                border: '1.5px solid #0f172a',
                background: '#fef08a',
                padding: '6px 10px',
                textAlign: 'center',
                fontWeight: 800,
                fontSize: 15,
              }}
            >
              {summary.totalVolumeM3 !== null ? `${summary.totalVolumeM3.toFixed(2)} m³` : 'Not computed'}
            </div>
            <div style={{ textAlign: 'center', fontSize: 10, color: '#475569' }}>cubic meters</div>
          </div>
        </div>
      </div>

      {/* Section II: Per Blow-Off Point Breakdown */}
      <div style={{ border: REPORT_BORDER_HEAVY }}>
        <div style={REPORT_SECTION_BAR_STYLE}>
          II. Blow-Off Points &amp; Field Observed Data
        </div>
        {isOrifice ? (
          <table style={{ ...REPORT_TABLE_STYLE, fontSize: 10.5 }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                <th style={{ borderBottom: B, borderRight: B, padding: '4px 6px', textAlign: 'left' }}>Blow-Off Point</th>
                <th style={{ borderBottom: B, borderRight: B, padding: '4px 6px', textAlign: 'right' }}>d (mm)</th>
                <th style={{ borderBottom: B, borderRight: B, padding: '4px 6px', textAlign: 'right' }}>h (PSI / ΔP Pa)</th>
                <th style={{ borderBottom: B, borderRight: B, padding: '4px 6px', textAlign: 'right' }}>μ</th>
                <th style={{ borderBottom: B, borderRight: B, padding: '4px 6px', textAlign: 'right' }}>A (m²)</th>
                <th style={{ borderBottom: B, borderRight: B, padding: '4px 6px', textAlign: 'right' }}>Q (m³/s)</th>
                <th style={{ borderBottom: B, borderRight: B, padding: '4px 6px', textAlign: 'right' }}>Duration</th>
                <th style={{ borderBottom: B, padding: '4px 6px', textAlign: 'right' }}>Volume (m³)</th>
              </tr>
            </thead>
            <tbody>
              {summary.blowOffPoints.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 8, textAlign: 'center', color: '#64748b' }}>
                    No blow-off points recorded.
                  </td>
                </tr>
              ) : (
                summary.blowOffPoints.map((pt, i) => {
                  const o = pt.orifice;
                  const tw = pt.startTime && pt.endTime ? ` (${pt.startTime}–${pt.endTime})` : '';
                  return (
                    <tr key={i}>
                      <td style={{ borderBottom: B, borderRight: B, padding: '4px 6px', fontWeight: 600 }}>{pt.name}</td>
                      <td style={{ borderBottom: B, borderRight: B, padding: '4px 6px', textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                        {o?.diameterMm ?? '—'}
                      </td>
                      <td style={{ borderBottom: B, borderRight: B, padding: '4px 6px', textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                        {o ? `${o.pressurePsi} / ${o.deltaPa.toFixed(0)}` : '—'}
                      </td>
                      <td style={{ borderBottom: B, borderRight: B, padding: '4px 6px', textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                        {o ? o.dischargeCoeff.toFixed(2) : '—'}
                      </td>
                      <td style={{ borderBottom: B, borderRight: B, padding: '4px 6px', textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                        {o ? o.areaM2.toFixed(4) : '—'}
                      </td>
                      <td style={{ borderBottom: B, borderRight: B, padding: '4px 6px', textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                        {o ? o.flowM3PerSec.toFixed(4) : '—'}
                      </td>
                      <td style={{ borderBottom: B, borderRight: B, padding: '4px 6px', textAlign: 'right' }}>
                        {o ? `${o.durationMinutes}m${tw}` : '—'}
                      </td>
                      <td style={{ borderBottom: B, padding: '4px 6px', textAlign: 'right', fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>
                        {pt.volumeM3 !== null ? pt.volumeM3.toFixed(2) : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
              <tr style={{ background: '#f8fafc', fontWeight: 800 }}>
                <td colSpan={7} style={{ borderTop: B, borderRight: B, padding: '5px 8px', textAlign: 'right' }}>
                  TOTAL FLUSHING VOLUME:
                </td>
                <td style={{ borderTop: B, padding: '5px 6px', textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                  {summary.totalVolumeM3 !== null ? `${summary.totalVolumeM3.toFixed(2)} m³` : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <table style={REPORT_TABLE_STYLE}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                <th style={{ borderBottom: B, borderRight: B, padding: '4px 8px', textAlign: 'left' }}>Blow-Off Point</th>
                <th style={{ borderBottom: B, borderRight: B, padding: '4px 8px', textAlign: 'right' }}>Initial (m³)</th>
                <th style={{ borderBottom: B, borderRight: B, padding: '4px 8px', textAlign: 'right' }}>Final (m³)</th>
                <th style={{ borderBottom: B, padding: '4px 8px', textAlign: 'right' }}>Volume (m³)</th>
              </tr>
            </thead>
            <tbody>
              {summary.blowOffPoints.map((pt, i) => (
                <tr key={i}>
                  <td style={{ borderBottom: B, borderRight: B, padding: '4px 8px', fontWeight: 600 }}>{pt.name}</td>
                  <td style={{ borderBottom: B, borderRight: B, padding: '4px 8px', textAlign: 'right' }}>{pt.initialRead ?? '—'}</td>
                  <td style={{ borderBottom: B, borderRight: B, padding: '4px 8px', textAlign: 'right' }}>{pt.finalRead ?? '—'}</td>
                  <td style={{ borderBottom: B, padding: '4px 8px', textAlign: 'right', fontWeight: 700 }}>
                    {pt.volumeM3 !== null ? pt.volumeM3.toFixed(2) : '—'}
                  </td>
                </tr>
              ))}
              <tr style={{ background: '#f8fafc', fontWeight: 800 }}>
                <td colSpan={3} style={{ borderTop: B, borderRight: B, padding: '5px 8px', textAlign: 'right' }}>
                  TOTAL FLUSHING VOLUME ({summary.basis === 'mother_meter' ? 'Mother Meter' : 'Blow-Off Sum'}):
                </td>
                <td style={{ borderTop: B, padding: '5px 8px', textAlign: 'right' }}>
                  {summary.totalVolumeM3 !== null ? `${summary.totalVolumeM3.toFixed(2)} m³` : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {activity.notes && (
        <div style={{ border: B, padding: '8px 10px', fontSize: 11 }}>
          <b>Field Observations / Notes:</b> <i>&ldquo;{activity.notes}&rdquo;</i>
        </div>
      )}

      {/* Signatures */}
      <ReportSignatureGrid
        entries={[
          {
            printedName: leadOpName,
            roleTitle: 'Prepared By (Field Operations)',
            subtitle: crewNames.length > 0 ? `Crew: ${crewNames.join(', ')}` : 'Lead Operator / Personnel',
          },
          {
            roleTitle: 'Checked / Verified By',
            subtitle: 'Supervisor / Operations Head',
          },
        ]}
        gap={36}
      />
    </div>
  );
}
