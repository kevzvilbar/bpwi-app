'use client';

import type { DailyActivityRow } from '@/lib/activity-types';
import { formatTaggedGpsPosition } from '@/lib/gps-accuracy';
import {
  WATER_DENSITY_KG_M3,
  computeLeakVolumeLoss,
  hydrateLeakLossDetails,
} from '@/lib/leak-volume-loss';
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

interface LeakVolumeLossReportSheetProps {
  activity: DailyActivityRow;
  orgName: string;
  areaLabel: string;
  leadOpName: string;
  crewNames?: string[];
}

const B = REPORT_BORDER;

/**
 * Printable BPWI "COMPUTATION OF VOLUME LOSS" document modeled on the official Excel sheet:
 * computes theoretical orifice water wastage (m³) and lists Labor (1 lot) + Materials Used
 * with intentionally blank Cost cells for manual area-tariff pricing by Billing.
 */
export default function LeakVolumeLossReportSheet({
  activity,
  orgName,
  areaLabel,
  leadOpName,
  crewNames = [],
}: LeakVolumeLossReportSheetProps) {
  const d = activity.details ?? {};
  const leak = hydrateLeakLossDetails(d);
  const calc = computeLeakVolumeLoss(leak);
  const gpsInfo = formatTaggedGpsPosition(activity.gps_lat, activity.gps_lng, d);
  const refCode = `ACT-${activity.id.slice(0, 8).toUpperCase()}`;

  const pipeSize = typeof d.pipeSize === 'string' && d.pipeSize.trim() ? d.pipeSize.trim() : '—';
  const leakType = typeof d.leakType === 'string' && d.leakType.trim() ? d.leakType.trim() : '—';
  const isThirdParty = leak.faultAttribution === 'third_party';

  const materials = Array.isArray(d.usedMaterials)
    ? d.usedMaterials
        .filter((m): m is { item?: unknown; qty?: unknown; unit?: unknown } => typeof m === 'object' && m !== null)
        .map((m) => ({
          item: String(m.item ?? '').trim(),
          qty: String(m.qty ?? '').trim() || '1',
          unit: typeof m.unit === 'string' && m.unit.trim() ? m.unit.trim() : 'pcs',
        }))
        .filter((m) => m.item !== '')
    : [];

  const locationLine = [activity.site_or_well, activity.block_lot].filter(Boolean).join(' · ') || '—';
  const timeWindow =
    leak.leakReportedAt && leak.valveIsolatedAt
      ? ` (${leak.leakReportedAt} → ${leak.valveIsolatedAt})`
      : '';

  const sigEntries = [
    {
      printedName: leadOpName,
      roleTitle: 'Prepared By (Field Operations)',
      subtitle: crewNames.length > 0 ? `Crew: ${crewNames.join(', ')}` : 'Lead Operator / Technician',
    },
    {
      roleTitle: 'Checked / Verified By',
      subtitle: 'Supervisor / Billing Representative',
    },
    ...(isThirdParty
      ? [
          {
            printedName: leak.responsibleParty || '',
            roleTitle: 'Acknowledged By (Responsible Party)',
            subtitle: 'Signature over Printed Name',
          },
        ]
      : []),
  ];

  return (
    <div style={{ color: '#0f172a', fontSize: 11.5, lineHeight: 1.35, display: 'grid', gap: 12 }}>
      <ReportLetterhead
        orgName={orgName}
        subtitle={BPWI_COMPANY_ADDRESS}
        title="COMPUTATION OF VOLUME LOSS"
        refCode={refCode}
        dateLabel={`Date: ${activity.activity_date}`}
        printedTs={formatReportPrintedTs(new Date().toISOString())}
      />

      {/* Incident / Site Metadata */}
      <div style={REPORT_META_BOX_STYLE}>
        <div><b>Business Area / Station:</b> {areaLabel || '—'}</div>
        <div><b>Location / Site:</b> {locationLine}</div>
        <div><b>Pipe Size &amp; Spec:</b> {pipeSize}</div>
        <div><b>Leak Classification / Cause:</b> {leakType}</div>
        <div>
          <b>Fault Attribution:</b>{' '}
          <span style={{ fontWeight: 700, color: isThirdParty ? '#991b1b' : '#0f172a' }}>
            {isThirdParty ? 'Customer / 3rd-Party Fault (Chargeable)' : 'Natural / Wear & Tear (Company NRW)'}
          </span>
        </div>
        <div><b>GPS Position:</b> {gpsInfo ? `${gpsInfo.coords} (${gpsInfo.sourceLabel})` : 'Not tagged'}</div>
        {isThirdParty && (
          <>
            <div><b>Responsible Party / Customer:</b> {leak.responsibleParty || '—'}</div>
            <div><b>Account # / Plate # / Ref:</b> {leak.responsibleAccountNo || '—'}</div>
          </>
        )}
      </div>

      {/* Section I: Theoretical Orifice Volume Loss */}
      <div style={{ border: REPORT_BORDER_HEAVY }}>
        <div style={REPORT_SECTION_BAR_STYLE}>
          I. Computation of Volume Loss
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.2fr 0.8fr',
            gap: 12,
            padding: '10px 12px',
            borderBottom: B,
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: 11 }}>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>FORMULA USED (Torricelli Orifice Equation):</div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5, paddingLeft: 10, display: 'grid', gap: 2 }}>
              <div>Q = μ × A × √(2ΔP / ρ)</div>
              <div>V = Q × t</div>
              <div>{calc?.formulaAreaText ?? (leak.openingShape === 'slit' ? 'A = L × W' : 'A = π(d/2)²')}</div>
            </div>
            <div style={{ fontSize: 9.8, color: '#475569', marginTop: 4 }}>
              Theoretical orifice discharge estimate based on field observed data.
            </div>
          </div>

          <div style={{ display: 'grid', gap: 4 }}>
            <div style={{ fontWeight: 800, fontSize: 11 }}>Total Volume:</div>
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
              {calc ? `${calc.totalVolumeM3.toFixed(2)} m³` : 'Not computed'}
            </div>
            <div style={{ textAlign: 'center', fontSize: 10, color: '#475569' }}>
              cubic meters
            </div>
          </div>
        </div>

        {/* Field Observed Data */}
        <table style={REPORT_TABLE_STYLE}>
          <thead>
            <tr style={{ background: '#f1f5f9' }}>
              <th style={{ borderBottom: B, borderRight: B, padding: '4px 8px', textAlign: 'left', width: '58%' }}>
                Symbol &amp; Parameter Description
              </th>
              <th style={{ borderBottom: B, borderRight: B, padding: '4px 8px', textAlign: 'right', width: '24%' }}>
                Field Observed Data
              </th>
              <th style={{ borderBottom: B, padding: '4px 8px', textAlign: 'left', width: '18%' }}>Unit</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Q = rate of discharge', calc ? calc.flowM3PerSec.toFixed(4) : '—', 'm³/sec'],
              ['μ = discharge coefficient (dimensionless)', calc ? calc.dischargeCoeff.toFixed(2) : leak.dischargeCoeff || '0.60', '—'],
              ['A = area of leak opening', calc ? calc.areaM2.toFixed(4) : '—', 'm²'],
              ['t = total water-flow duration', calc ? `${calc.durationMinutes} min (${calc.durationHours.toFixed(2)} hr)${timeWindow}` : '—', 'min / hrs'],
              ['ΔP = pressure difference across opening', calc ? calc.deltaPa.toFixed(2) : '—', 'Pa'],
              ['h = average operating / residual pressure', calc ? String(calc.pressurePsi) : leak.pressurePsi || '—', 'psi'],
              ['ρ = density of water (at ambient temp.)', String(WATER_DENSITY_KG_M3), 'kg/m³'],
              leak.openingShape === 'slit'
                ? [
                    'L × W = slit / crack dimensions',
                    calc ? `${calc.slitLengthMm} × ${calc.slitWidthMm}` : `${leak.slitLengthMm || '—'} × ${leak.slitWidthMm || '—'}`,
                    'mm',
                  ]
                : [
                    'd = diameter of damage opening',
                    calc?.diameterMm != null ? String(calc.diameterMm) : leak.diameterMm || '—',
                    'mm',
                  ],
            ].map(([label, value, unit], i) => (
              <tr key={i}>
                <td style={{ borderBottom: B, borderRight: B, padding: '4px 8px' }}>{label}</td>
                <td style={{ borderBottom: B, borderRight: B, padding: '4px 8px', textAlign: 'right', fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>
                  {value}
                </td>
                <td style={{ borderBottom: B, padding: '4px 8px' }}>{unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Section II: Items Summary (Quantity & Unit Only; Cost left blank for Billing area tariff) */}
      <table style={{ ...REPORT_TABLE_STYLE, border: REPORT_BORDER_HEAVY }}>
        <thead>
          <tr style={{ background: '#e2e8f0' }}>
            <th style={{ border: B, padding: '5px 8px', textAlign: 'left', width: '48%' }}>Items</th>
            <th style={{ border: B, padding: '5px 8px', textAlign: 'right', width: '16%' }}>Quantity</th>
            <th style={{ border: B, padding: '5px 8px', textAlign: 'center', width: '14%' }}>Unit</th>
            <th style={{ border: B, padding: '5px 8px', textAlign: 'right', width: '22%' }}>Cost (For Billing)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ border: B, padding: '5px 8px', fontWeight: 700 }}>Water Loss</td>
            <td style={{ border: B, padding: '5px 8px', textAlign: 'right', fontWeight: 700 }}>
              {calc ? calc.totalVolumeM3.toFixed(2) : '—'}
            </td>
            <td style={{ border: B, padding: '5px 8px', textAlign: 'center' }}>m³</td>
            <td style={{ border: B, padding: '5px 8px', textAlign: 'right', color: '#94a3b8' }}></td>
          </tr>
          <tr>
            <td style={{ border: B, padding: '5px 8px', fontWeight: 700 }}>Labor</td>
            <td style={{ border: B, padding: '5px 8px', textAlign: 'right' }}>1</td>
            <td style={{ border: B, padding: '5px 8px', textAlign: 'center' }}>lot</td>
            <td style={{ border: B, padding: '5px 8px', textAlign: 'right', color: '#94a3b8' }}></td>
          </tr>
          <tr style={{ background: '#f8fafc' }}>
            <td colSpan={4} style={{ border: B, padding: '4px 8px', fontWeight: 700 }}>Materials Used</td>
          </tr>
          {materials.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ border: B, padding: '5px 12px', color: '#64748b', fontStyle: 'italic' }}>
                No materials recorded
              </td>
            </tr>
          ) : (
            materials.map((m, idx) => (
              <tr key={idx}>
                <td style={{ border: B, padding: '4px 8px 4px 16px' }}>{m.item}</td>
                <td style={{ border: B, padding: '4px 8px', textAlign: 'right' }}>{m.qty}</td>
                <td style={{ border: B, padding: '4px 8px', textAlign: 'center' }}>{m.unit}</td>
                <td style={{ border: B, padding: '4px 8px' }}></td>
              </tr>
            ))
          )}
          <tr style={{ background: '#f1f5f9', fontWeight: 800 }}>
            <td colSpan={3} style={{ border: B, padding: '6px 8px', textAlign: 'right' }}>
              TOTAL CHARGEABLE AMOUNT (Php — per Area Rate):
            </td>
            <td style={{ border: B, padding: '6px 8px' }}></td>
          </tr>
        </tbody>
      </table>

      <div style={{ fontSize: 10, color: '#475569' }}>
        Note: Water tariff rate per m³, labor valuation, and material unit prices vary per area and are priced manually by Billing / Accounting.
      </div>

      {/* Signatures */}
      <ReportSignatureGrid entries={sigEntries} gap={24} />
    </div>
  );
}
