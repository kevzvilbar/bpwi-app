'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { ACTIVITY_BY_ID, type DailyActivityRow, type JobOrderRow } from '@/lib/activity-types';
import { formatTaggedGpsPosition, GPS_INTERNAL_DETAIL_KEYS } from '@/lib/gps-accuracy';
import {
  LEAK_INTERNAL_DETAIL_KEYS,
  computeLeakVolumeLoss,
  hydrateLeakLossDetails,
} from '@/lib/leak-volume-loss';
import {
  FLUSHING_INTERNAL_DETAIL_KEYS,
  formatFlushingMeterStatusLabel,
  hydrateFlushingSummaryFromDetails,
} from '@/lib/flushing-volume';
import {
  GENSET_INTERNAL_DETAIL_KEYS,
  evaluateGensetDurationGuidance,
  evaluateGensetHealth,
  formatGensetRunModeLabel,
  hasGensetChecklistDetails,
  hydrateGensetMonitoringDetails,
} from '@/lib/genset-monitoring';
import { describeChlorineRefill } from '@/lib/chlorine-refill';
import { computeJobOrderSlaStatus, formatSlaDurationLabel } from '@/lib/job-order-sla';
import WellPulloutReportSheet from '@/components/WellPulloutReportSheet';
import TankCleaningReportSheet from '@/components/TankCleaningReportSheet';
import LeakVolumeLossReportSheet from '@/components/LeakVolumeLossReportSheet';
import FlushingVolumeReportSheet from '@/components/FlushingVolumeReportSheet';
import {
  REPORT_TABLE_STYLE,
  ReportLetterhead,
  ReportSignatureGrid,
  formatReportPrintedTs,
} from '@/components/ReportSheetPrimitives';
import { SamplePrintWatermark } from '@/components/SampleBadge';

type LookupOp = { id: string; full_name: string; position: string | null };
type LookupArea = { id: string; code: string; name: string | null };
type LookupShift = { id: string; code: string; description?: string | null };

const fmtTs = formatReportPrintedTs;

function calcTatHours(startIso?: string | null, endIso?: string | null) {
  if (!startIso || !endIso) return null;
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  return ((e - s) / (1000 * 60 * 60)).toFixed(1) + ' hrs';
}

/**
 * The official forms are fixed-layout A4 documents. On a phone they used to collapse into
 * overlapping text, so on small screens they keep their designed width inside a sideways-scrolling
 * frame. Printing is unaffected (see .report-scroll in globals.css).
 */
function ReportViewport({ children }: { children: React.ReactNode }) {
  return (
    <>
      <p className="report-scroll-hint no-print">Swipe sideways to see the whole form. Print / Save PDF gives the full page.</p>
      <div className="report-scroll">
        <div className="report-sheet">{children}</div>
      </div>
    </>
  );
}

export default function PrintableActivityReport(p: {
  mode: 'activity' | 'meter_test' | 'well_pull_out' | 'tank_cleaning' | 'leak_volume_loss' | 'flushing_volume';
  orgName: string;
  activity?: DailyActivityRow | null;
  jobOrder?: JobOrderRow | null;
  operators: LookupOp[];
  areas: LookupArea[];
  shifts: LookupShift[];
  onClose: () => void;
}) {
  const [sheetView, setSheetView] = useState<'form' | 'standard'>('form');
  const [fetchedSig, setFetchedSig] = useState<{ id: string; data: string | null } | null>(null);
  const actId = p.activity?.id ?? '';
  const actType = p.activity?.activity_type;
  const actSignatureProp = p.activity?.signature_data;

  useEffect(() => {
    const preferForm =
      p.mode === 'leak_volume_loss' ||
      p.mode === 'flushing_volume' ||
      p.mode === 'well_pull_out' ||
      p.mode === 'tank_cleaning' ||
      actType === 'well_pull_out' ||
      actType === 'tank_cleaning';
    setSheetView(preferForm ? 'form' : 'standard');
  }, [p.mode, actId, actType]);

  useEffect(() => {
    if (!actId || (p.mode !== 'meter_test' && actType !== 'meter_test') || actSignatureProp !== undefined) {
      return;
    }
    let active = true;
    void supabaseBrowser()
      .from('daily_activities')
      .select('signature_data')
      .eq('id', actId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setFetchedSig({ id: actId, data: (data?.signature_data as string | null | undefined) ?? null });
      });
    return () => {
      active = false;
    };
  }, [actId, p.mode, actType, actSignatureProp]);

  if (!p.activity && !p.jobOrder) return null;

  const opBy = new Map(p.operators.map((o) => [o.id, o]));
  const areaBy = new Map(p.areas.map((a) => [a.id, a]));
  const shiftBy = new Map(p.shifts.map((s) => [s.id, s]));

  const act = p.activity ?? null;
  const jo = p.jobOrder ?? null;
  const det: Record<string, unknown> = act?.details ?? {};
  const detPrim = (k: string): string | number | null => {
    const v = det[k];
    return typeof v === 'string' || typeof v === 'number' ? v : null;
  };
  const detStr = (k: string, fallback = ''): string => {
    const v = det[k];
    return typeof v === 'string' && v ? v : fallback;
  };

  const areaObj = (act?.area_code_id ? areaBy.get(act.area_code_id) : undefined) ??
    (jo?.area_code_id ? areaBy.get(jo.area_code_id) : undefined);
  const shiftObj = act?.shift_type_id ? shiftBy.get(act.shift_type_id) : undefined;
  const leadOp = act?.lead_operator_id ? opBy.get(act.lead_operator_id) : undefined;
  const crewOpObjects = (act?.crew_operator_ids ?? jo?.assigned_operator_ids ?? [])
    .map((id) => opBy.get(id))
    .filter((o): o is LookupOp => Boolean(o));
  const crewOps = crewOpObjects.map((o) => o.full_name);

  const actDef = act ? ACTIVITY_BY_ID[act.activity_type] : jo?.activity_type ? ACTIVITY_BY_ID[jo.activity_type] : undefined;
  const refCode = jo?.jo_number ?? (act ? `ACT-${act.id.slice(0, 8).toUpperCase()}` : 'REPORT');
  const isPulloutEligible = act?.activity_type === 'well_pull_out';
  const isTankCleaningEligible = act?.activity_type === 'tank_cleaning';
  const isLeakRepairEligible = act?.activity_type === 'leak_repair';
  const isFlushingEligible = act?.activity_type === 'flushing';
  const showPulloutSheet = Boolean(
    act && (p.mode === 'well_pull_out' || isPulloutEligible) && sheetView === 'form',
  );
  const showTankCleaningSheet = Boolean(
    act && (p.mode === 'tank_cleaning' || isTankCleaningEligible) && sheetView === 'form',
  );
  const showLeakVolumeSheet = Boolean(
    act && (p.mode === 'leak_volume_loss' || (isLeakRepairEligible && sheetView === 'form')),
  );
  const showFlushingVolumeSheet = Boolean(
    act && (p.mode === 'flushing_volume' || (isFlushingEligible && sheetView === 'form')),
  );
  const hideGenericHeader =
    showPulloutSheet || showTankCleaningSheet || showLeakVolumeSheet || showFlushingVolumeSheet;
  const areaLabel = areaObj ? `${areaObj.code}${areaObj.name ? ` · ${areaObj.name}` : ''}` : '';
  const gpsInfo = act ? formatTaggedGpsPosition(act.gps_lat, act.gps_lng, det) : null;
  const leakLossState = isLeakRepairEligible && act ? hydrateLeakLossDetails(det) : null;
  const leakLossCalc = leakLossState ? computeLeakVolumeLoss(leakLossState) : null;
  const flushingSummary = isFlushingEligible && act ? hydrateFlushingSummaryFromDetails(det) : null;
  const isGensetMonitoringEligible = act?.activity_type === 'genset_monitoring';
  const gensetChecklist =
    isGensetMonitoringEligible && act && hasGensetChecklistDetails(det)
      ? hydrateGensetMonitoringDetails(det)
      : null;
  const gensetHealth = gensetChecklist ? evaluateGensetHealth(gensetChecklist) : null;
  const gensetGuidance = gensetChecklist
    ? evaluateGensetDurationGuidance(gensetChecklist.runMode, gensetChecklist.runDurationMin, gensetChecklist.unitFuelType)
    : null;
  const isChlorineRefill = act?.activity_type === 'chlorine_refill';
  const telemetryEntries = isChlorineRefill
    ? describeChlorineRefill(det).map((row) => ({ key: row.label, formattedVal: row.value }))
    : act
    ? Object.entries(det)
        .filter(
          ([key]) =>
            !GPS_INTERNAL_DETAIL_KEYS.has(key) &&
            !LEAK_INTERNAL_DETAIL_KEYS.has(key) &&
            !FLUSHING_INTERNAL_DETAIL_KEYS.has(key) &&
            !(gensetChecklist && GENSET_INTERNAL_DETAIL_KEYS.has(key)),
        )
        .map(([key, val]) => {
          if (val === null || val === undefined || val === '') return null;
          const formattedVal = Array.isArray(val)
            ? val
                .map((item) => {
                  if (key === 'usedMaterials' && typeof item === 'object' && item !== null) {
                    const m = item as { item?: unknown; qty?: unknown; unit?: unknown };
                    const u = typeof m.unit === 'string' && m.unit.trim() ? ` ${m.unit.trim()}` : '';
                    return `${String(m.item ?? '')} (${String(m.qty ?? '1')}${u})`;
                  }
                  if (key === 'blowOffs' && typeof item === 'object' && item !== null) {
                    const b = item as { name?: unknown; initialRead?: unknown; finalRead?: unknown; diameterMm?: unknown; pressurePsi?: unknown; durationMinutes?: unknown; volumeM3?: unknown };
                    if (b.volumeM3 != null && b.diameterMm != null) {
                      return `${String(b.name ?? 'Blow-off')} (${String(b.diameterMm)}mm @ ${String(b.pressurePsi ?? '—')} PSI, ${String(b.durationMinutes ?? '—')} min = ${Number(b.volumeM3).toFixed(2)} m³)`;
                    }
                    if (b.initialRead != null || b.finalRead != null) {
                      return `${String(b.name ?? 'Blow-off')} (${String(b.initialRead ?? '—')} → ${String(b.finalRead ?? '—')} m³)`;
                    }
                    return String(b.name ?? 'Blow-off');
                  }
                  if (key === 'fuelDistributions' && typeof item === 'object' && item !== null) {
                    const s = item as { destinationSite?: unknown; liters?: unknown; containerNote?: unknown };
                    const note = typeof s.containerNote === 'string' && s.containerNote.trim() ? ` (${s.containerNote.trim()})` : '';
                    return `${String(s.destinationSite ?? 'Site')}: ${String(s.liters ?? '—')} L${note}`;
                  }
                  return typeof item === 'object' && item !== null ? Object.values(item).filter(Boolean).join(' · ') : String(item);
                })
                .join('; ')
            : typeof val === 'object'
              ? JSON.stringify(val)
              : String(val);
          return formattedVal ? { key, formattedVal } : null;
        })
        .filter((entry): entry is { key: string; formattedVal: string } => Boolean(entry))
    : [];

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Printable Field Operations Report"
      onClick={p.onClose}
      style={{ zIndex: 90 }}
    >
      <div
        className="modal-sheet bpwi-printable-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: showPulloutSheet ? 900 : 820,
          width: '100%',
          background: '#ffffff',
          color: '#0f172a',
          padding: showPulloutSheet ? 20 : 28,
          borderRadius: 12,
        }}
      >
        {(act?.is_sample || jo?.is_sample) && <SamplePrintWatermark />}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              @media print {
                body * { visibility: hidden !important; }
                .bpwi-printable-sheet, .bpwi-printable-sheet * { visibility: visible !important; }
                .bpwi-printable-sheet {
                  position: fixed !important;
                  left: 0 !important;
                  top: 0 !important;
                  width: 100% !important;
                  max-width: none !important;
                  max-height: none !important;
                  overflow: visible !important;
                  background: #ffffff !important;
                  color: #000000 !important;
                  box-shadow: none !important;
                  border: none !important;
                  padding: ${showPulloutSheet ? '3mm' : '6mm'} !important;
                  margin: 0 !important;
                  z-index: 9999 !important;
                }
                @page { size: ${showPulloutSheet ? 'legal portrait' : showTankCleaningSheet ? 'letter portrait' : 'portrait'}; margin: ${showPulloutSheet ? '6mm' : '10mm'}; }
              }
            `,
          }}
        />

        {/* Action Toolbar (hidden when printed) */}
        <div
          className="no-print"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            marginBottom: 14,
            paddingBottom: 10,
            borderBottom: '1px solid #cbd5e1',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 13.5, color: '#334155' }}>
              {p.mode === 'meter_test'
                ? 'Meter Volumetric Test Certificate Preview'
                : showPulloutSheet
                  ? 'Deepwell Pull-Out & Installation Accomplishment Report'
                  : showTankCleaningSheet
                    ? 'Tank Cleaning & Sanitation Accomplishment Report'
                    : showLeakVolumeSheet
                      ? 'Computation of Volume Loss & Materials Preview'
                      : showFlushingVolumeSheet
                        ? 'Computation of Flushing Volume Preview'
                        : 'Field Operations / Job Order Report Preview'}
            </strong>
            {(isPulloutEligible || isTankCleaningEligible || isLeakRepairEligible || isFlushingEligible) && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={sheetView === 'form' ? 'btn btn-primary' : 'btn'}
                  style={{ fontSize: 11.5, padding: '4px 9px' }}
                  onClick={() => setSheetView('form')}
                >
                  {isTankCleaningEligible
                    ? '📄 Official Tank Cleaning Report'
                    : isLeakRepairEligible
                      ? '💧 Computation of Volume Loss'
                      : isFlushingEligible
                        ? '💧 Computation of Flushing Volume'
                        : '📄 Official Deepwell Pull-Out Form'}
                </button>
                <button
                  type="button"
                  className={sheetView === 'standard' ? 'btn btn-primary' : 'btn'}
                  style={{ fontSize: 11.5, padding: '4px 9px' }}
                  onClick={() => setSheetView('standard')}
                >
                  📋 Standard Activity Sheet
                </button>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary" onClick={() => window.print()}>
              Print / Save PDF
            </button>
            <button type="button" className="btn" onClick={p.onClose}>
              Close
            </button>
          </div>
        </div>

        {/* Official Document Header (standard reports / meter certificate) */}
        {!hideGenericHeader && (
          <ReportLetterhead
            orgName={p.orgName}
            eyebrow={p.orgName || 'BP Waterworks, Inc.'}
            title={p.mode === 'meter_test' ? 'Water Meter Volumetric Test Certificate' : 'Field Activity & Job Order Report'}
            refCode={refCode}
            dateLabel={`Date: ${act?.activity_date ?? (jo?.created_at ? jo.created_at.slice(0, 10) : 'N/A')}`}
            printedTs={fmtTs(new Date().toISOString())}
          />
        )}

        {showPulloutSheet && act ? (
          <ReportViewport>
            <WellPulloutReportSheet
              activity={act}
              orgName={p.orgName}
              areaLabel={areaLabel}
              leadOpName={leadOp?.full_name ?? ''}
              crewNames={crewOps}
            />
          </ReportViewport>
        ) : showTankCleaningSheet && act ? (
          <ReportViewport>
            <TankCleaningReportSheet
              activity={act}
              orgName={p.orgName}
              areaLabel={areaLabel}
              leadOp={leadOp ?? null}
              crewOps={crewOpObjects}
            />
          </ReportViewport>
        ) : showLeakVolumeSheet && act ? (
          <ReportViewport>
            <LeakVolumeLossReportSheet
              activity={act}
              orgName={p.orgName}
              areaLabel={areaLabel}
              leadOpName={leadOp?.full_name ?? ''}
              crewNames={crewOps}
            />
          </ReportViewport>
        ) : showFlushingVolumeSheet && act ? (
          <ReportViewport>
            <FlushingVolumeReportSheet
              activity={act}
              orgName={p.orgName}
              areaLabel={areaLabel}
              leadOpName={leadOp?.full_name ?? ''}
              crewNames={crewOps}
            />
          </ReportViewport>
        ) : p.mode === 'meter_test' ? (
          /* Official Water Meter Volumetric Test Certificate Layout */
          <div style={{ display: 'grid', gap: 16, fontSize: 12.5 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, border: '1px solid #334155', padding: 12 }}>
              <div><b>Customer Account #:</b> {detPrim('accountNumber') ?? jo?.account_number ?? 'N/A'}</div>
              <div><b>Account Name:</b> {detPrim('accountName') ?? jo?.account_name ?? 'N/A'}</div>
              <div><b>Area / Station:</b> {areaObj ? `${areaObj.code}${areaObj.name ? ` (${areaObj.name})` : ''}` : 'N/A'}</div>
              <div><b>Block &amp; Lot / Site:</b> {act?.block_lot ?? jo?.block_lot ?? act?.site_or_well ?? 'N/A'}</div>
              <div><b>Meter Brand:</b> {detPrim('meterBrand') ?? 'N/A'}</div>
              <div><b>Meter Serial #:</b> {detPrim('meterSerialNumber') ?? 'N/A'}</div>
              <div><b>Meter Size:</b> {detPrim('meterSize') ?? '1/2"'} ({detPrim('meterNature') ?? 'Old'})</div>
              <div><b>Test Type:</b> {detPrim('testNature') ?? 'Re-testing'} (Ref: {detPrim('refVolumeM3') ?? 0.01} m³)</div>
              {gpsInfo && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <b>GPS Position:</b>{' '}
                  <a href={gpsInfo.mapUrl} target="_blank" rel="noreferrer" style={{ color: '#0f172a', textDecoration: 'underline' }}>
                    {gpsInfo.coords}
                  </a>{' '}
                  ({gpsInfo.sourceLabel})
                </div>
              )}
            </div>

            <table style={{ ...REPORT_TABLE_STYLE, fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f1f5f9' }}>
                  <th style={{ border: '1px solid #334155', padding: '7px 8px', textAlign: 'left' }}>Test Stage</th>
                  <th style={{ border: '1px solid #334155', padding: '7px 8px', textAlign: 'right' }}>Reading (m³)</th>
                  <th style={{ border: '1px solid #334155', padding: '7px 8px', textAlign: 'right' }}>% Error (Allowed: ±5.00%)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ border: '1px solid #334155', padding: '6px 8px' }}>Initial Reading</td>
                  <td style={{ border: '1px solid #334155', padding: '6px 8px', textAlign: 'right' }}>{detPrim('initialReading') ?? '—'}</td>
                  <td style={{ border: '1px solid #334155', padding: '6px 8px', textAlign: 'right' }}>—</td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #334155', padding: '6px 8px' }}>Trial 1 ({detPrim('refVolumeM3') ?? 0.01} m³)</td>
                  <td style={{ border: '1px solid #334155', padding: '6px 8px', textAlign: 'right' }}>{detPrim('reading1') ?? '—'}</td>
                  <td style={{ border: '1px solid #334155', padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>{detPrim('err1') !== null ? `${detPrim('err1')}%` : '—'}</td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #334155', padding: '6px 8px' }}>Trial 2 ({detPrim('refVolumeM3') ?? 0.01} m³)</td>
                  <td style={{ border: '1px solid #334155', padding: '6px 8px', textAlign: 'right' }}>{detPrim('reading2') ?? '—'}</td>
                  <td style={{ border: '1px solid #334155', padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>{detPrim('err2') !== null ? `${detPrim('err2')}%` : '—'}</td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #334155', padding: '6px 8px' }}>Trial 3 ({detPrim('refVolumeM3') ?? 0.01} m³)</td>
                  <td style={{ border: '1px solid #334155', padding: '6px 8px', textAlign: 'right' }}>{detPrim('reading3') ?? '—'}</td>
                  <td style={{ border: '1px solid #334155', padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>{detPrim('err3') !== null ? `${detPrim('err3')}%` : '—'}</td>
                </tr>
                <tr style={{ background: '#f8fafc', fontWeight: 800 }}>
                  <td colSpan={2} style={{ border: '1px solid #334155', padding: '8px' }}>Average Volumetric Error &amp; Verdict</td>
                  <td style={{ border: '1px solid #334155', padding: '8px', textAlign: 'right' }}>
                    {detPrim('avgErr') !== null ? `${detPrim('avgErr')}% — ${detStr('verdict').toUpperCase()} (${detStr('recommendation').toUpperCase()})` : 'Incomplete'}
                  </td>
                </tr>
              </tbody>
            </table>

            {act?.notes && (
              <div style={{ border: '1px solid #cbd5e1', padding: 10, fontSize: 12 }}>
                <b>Remarks:</b> {act.notes}
              </div>
            )}

            <ReportSignatureGrid
              entries={[
                {
                  printedName: leadOp?.full_name ?? '',
                  roleTitle: 'Tested By',
                  subtitle: 'Field Technician / Operator',
                },
                {
                  signatureUrl:
                    act?.signature_data !== undefined
                      ? act.signature_data
                      : fetchedSig && act && fetchedSig.id === act.id
                        ? fetchedSig.data
                        : null,
                  signatureAlt: 'Witness signature',
                  emptySignatureText: 'No signature captured',
                  roleTitle: `Witnessed By: ${detStr('witnessedBy', 'Customer Representative')}`,
                  subtitle: 'Signature over Printed Name',
                },
                {
                  roleTitle: 'Verified / Noted By',
                  subtitle: 'Supervisor / Operations Head',
                },
              ]}
              lineHeight={52}
              gap={18}
              marginTop={28}
              fontSize={12}
            />
          </div>
        ) : (
          /* Standard Field Activity / Job Order Report Layout */
          <div style={{ display: 'grid', gap: 16, fontSize: 12.5 }}>
            <div style={{ border: '1px solid #334155', padding: 12, background: '#f8fafc', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div><b>Activity / Job:</b> {actDef?.label ?? jo?.title ?? act?.activity_type}</div>
              <div><b>Status:</b> {(act?.status ?? jo?.status ?? 'submitted').toUpperCase()}</div>
              <div><b>Area / Station:</b> {areaObj ? `${areaObj.code}${areaObj.name ? ` · ${areaObj.name}` : ''}` : 'N/A'}</div>
              <div><b>Site / Well / Location:</b> {[act?.site_or_well ?? jo?.site_or_well, act?.block_lot ?? jo?.block_lot].filter(Boolean).join(' · ') || 'N/A'}</div>
              <div><b>Lead Operator:</b> {leadOp?.full_name ?? 'Unspecified'}</div>
              <div><b>Crew Tagged:</b> {crewOps.length > 0 ? crewOps.join(', ') : 'None'}</div>
              <div><b>Shift:</b> {shiftObj ? `${shiftObj.code}${shiftObj.description ? ` (${shiftObj.description})` : ''}` : 'N/A'}</div>
              <div><b>Turnaround Time:</b> {calcTatHours(jo?.created_at ?? act?.started_at, jo?.completed_at ?? act?.completed_at) ?? 'N/A'}</div>
              <div><b>Started / Created:</b> {fmtTs(jo?.created_at ?? act?.started_at ?? act?.created_at)}</div>
              <div><b>Completed:</b> {fmtTs(jo?.completed_at ?? act?.completed_at)}</div>
              {act && (
                <>
                  <div>
                    <b>GPS Position:</b>{' '}
                    {gpsInfo ? (
                      <a href={gpsInfo.mapUrl} target="_blank" rel="noreferrer" style={{ color: '#0f172a', textDecoration: 'underline' }}>
                        {gpsInfo.coords}
                      </a>
                    ) : (
                      'Not tagged'
                    )}
                  </div>
                  <div><b>GPS Tag Method:</b> {gpsInfo ? gpsInfo.sourceLabel : 'N/A'}</div>
                </>
              )}
              {jo && (
                <>
                  <div><b>SLA Target:</b> {formatSlaDurationLabel(jo.estimated_hours)}</div>
                  <div><b>Deadline / Status:</b> {jo.deadline ? `${fmtTs(jo.deadline)} (${computeJobOrderSlaStatus(jo).badgeLabel})` : 'None'}</div>
                </>
              )}
            </div>

            {(jo?.description || jo?.tat_justification || act?.notes) && (
              <div style={{ border: '1px solid #334155', padding: 12 }}>
                <div style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 11, marginBottom: 4, color: '#334155' }}>
                  Work Description &amp; Field Observations
                </div>
                {jo?.description && <div style={{ marginBottom: 6 }}>{jo.description}</div>}
                {jo?.tat_justification && (
                  <div style={{ marginBottom: 6 }}>
                    <b>TAT / SLA Justification:</b> {jo.tat_justification}
                  </div>
                )}
                {act?.notes && <div><i>&ldquo;{act.notes}&rdquo;</i></div>}
              </div>
            )}

            {act && isLeakRepairEligible && (leakLossCalc || leakLossState?.faultAttribution === 'third_party') && (
              <div style={{ border: '1px solid #334155', padding: 12, background: '#f8fafc', display: 'grid', gap: 4 }}>
                <div style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 11, color: '#334155' }}>
                  Theoretical Water Wastage &amp; Fault Attribution
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div>
                    <b>Fault Attribution:</b>{' '}
                    {leakLossState?.faultAttribution === 'third_party'
                      ? 'Customer / 3rd-Party Fault (Chargeable)'
                      : 'Natural / Wear & Tear (Company NRW)'}
                  </div>
                  <div>
                    <b>Est. Water Loss:</b>{' '}
                    {leakLossCalc
                      ? `${leakLossCalc.totalVolumeM3.toFixed(2)} m³ (${leakLossCalc.durationMinutes} min @ ${leakLossCalc.pressurePsi} PSI, Q=${leakLossCalc.flowM3PerSec.toFixed(4)} m³/s)`
                      : 'Not computed'}
                  </div>
                  {leakLossState?.faultAttribution === 'third_party' && (
                    <>
                      <div><b>Responsible Party:</b> {leakLossState.responsibleParty || '—'}</div>
                      <div><b>Account / Plate / Ref:</b> {leakLossState.responsibleAccountNo || '—'}</div>
                    </>
                  )}
                </div>
              </div>
            )}

            {act && isFlushingEligible && flushingSummary && (flushingSummary.meterStatus !== 'metered' || flushingSummary.totalVolumeM3 !== null) && (
              <div style={{ border: '1px solid #334155', padding: 12, background: '#f8fafc', display: 'grid', gap: 4 }}>
                <div style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 11, color: '#334155' }}>
                  Flushing Volume Summary
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div><b>Mother Meter Status:</b> {formatFlushingMeterStatusLabel(flushingSummary.meterStatus)}</div>
                  <div>
                    <b>{flushingSummary.meterStatus === 'metered' ? 'Total Flushed Volume:' : 'Est. Theoretical Volume:'}</b>{' '}
                    {flushingSummary.totalVolumeM3 !== null ? `${flushingSummary.totalVolumeM3.toFixed(2)} m³` : 'Not computed'}
                  </div>
                </div>
              </div>
            )}

            {act && gensetChecklist && gensetHealth && (
              <div style={{ border: '1px solid #334155', padding: 12, background: '#f8fafc', display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 11, color: '#334155' }}>
                    Genset Weekly PMS Inspection Checklist
                  </span>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background:
                        gensetHealth.verdict === 'READY'
                          ? '#dcfce7'
                          : gensetHealth.verdict === 'NEEDS_ATTENTION'
                            ? '#fef3c7'
                            : '#fee2e2',
                      color:
                        gensetHealth.verdict === 'READY'
                          ? '#166534'
                          : gensetHealth.verdict === 'NEEDS_ATTENTION'
                            ? '#92400e'
                            : '#991b1b',
                      border: '1px solid #cbd5e1',
                    }}
                  >
                    {gensetHealth.verdictLabel}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div><b>Unit Type:</b> {gensetChecklist.unitFuelType}</div>
                  <div><b>Run Mode:</b> {formatGensetRunModeLabel(gensetChecklist.runMode)}</div>
                  <div>
                    <b>Run Duration:</b>{' '}
                    {gensetChecklist.runMode === 'skipped_ran_outage'
                      ? 'Skipped (Already Ran on Outage)'
                      : gensetChecklist.runDurationMin
                        ? `${gensetChecklist.runDurationMin} mins`
                        : '—'}
                  </div>
                  <div>
                    <b>Hour Meter:</b>{' '}
                    {det.runningHours != null && String(det.runningHours).trim() !== '' ? `${String(det.runningHours)} hrs` : '—'}
                  </div>
                  <div>
                    <b>Fuel Level (Init → Final):</b>{' '}
                    {det.gensetInitialFuel != null && String(det.gensetInitialFuel).trim() !== '' ? String(det.gensetInitialFuel) : '—'} →{' '}
                    {det.gensetFinalFuel != null && String(det.gensetFinalFuel).trim() !== '' ? String(det.gensetFinalFuel) : '—'}
                  </div>
                  <div><b>Engine Oil Level:</b> {gensetChecklist.oilLevel}</div>
                  <div><b>Coolant Level:</b> {gensetChecklist.coolantLevel}</div>
                  <div>
                    <b>Battery &amp; Cranking:</b> {gensetChecklist.batteryStatus}
                    {gensetChecklist.batteryVoltageV ? ` (${gensetChecklist.batteryVoltageV} V)` : ''}
                  </div>
                  <div><b>Leaks Observed:</b> {gensetChecklist.leaksObserved}</div>
                  <div><b>Noise / Vibration:</b> {gensetChecklist.noiseVibration}</div>
                  <div><b>Exhaust Smoke:</b> {gensetChecklist.exhaustSmoke}</div>
                  <div>
                    <b>Output Voltage / Freq:</b>{' '}
                    {gensetChecklist.outputVoltageV || gensetChecklist.frequencyHz
                      ? `${gensetChecklist.outputVoltageV || '—'} V / ${gensetChecklist.frequencyHz || '—'} Hz`
                      : '—'}
                  </div>
                </div>
                {gensetGuidance && (
                  <div style={{ fontSize: 11, color: '#475569' }}>
                    <b>Exercise Standard Check:</b> {gensetGuidance.message}
                  </div>
                )}
                {gensetHealth.findings.length > 0 && (
                  <div style={{ fontSize: 11, color: gensetHealth.verdict === 'CRITICAL' ? '#991b1b' : '#92400e' }}>
                    <b>Flagged Findings:</b> {gensetHealth.findings.join(' · ')}
                  </div>
                )}
                {gensetChecklist.standbyNote && (
                  <div style={{ fontSize: 11 }}>
                    <b>Standby Observation Notes:</b> {gensetChecklist.standbyNote}
                  </div>
                )}
              </div>
            )}

            {act && telemetryEntries.length > 0 && (
              <div>
                <div style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 11, marginBottom: 6, color: '#334155' }}>
                  Recorded Field Telemetry &amp; Parameters
                </div>
                <table style={{ ...REPORT_TABLE_STYLE, fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9' }}>
                      <th style={{ border: '1px solid #334155', padding: '6px 8px', textAlign: 'left', width: '35%' }}>Parameter</th>
                      <th style={{ border: '1px solid #334155', padding: '6px 8px', textAlign: 'left' }}>Recorded Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {telemetryEntries.map(({ key, formattedVal }) => (
                      <tr key={key}>
                        <td style={{ border: '1px solid #334155', padding: '5px 8px', fontWeight: 600, textTransform: isChlorineRefill ? 'none' : 'capitalize' }}>
                          {isChlorineRefill ? key : key.replace(/([A-Z])/g, ' $1')}
                        </td>
                        <td style={{ border: '1px solid #334155', padding: '5px 8px' }}>{formattedVal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <ReportSignatureGrid
              entries={[
                {
                  printedName: leadOp?.full_name ?? '',
                  roleTitle: 'Prepared By',
                  subtitle: 'Assigned Operator / Personnel',
                },
                {
                  roleTitle: 'Checked / Verified By',
                  subtitle: 'Signature over Printed Name',
                },
              ]}
              lineHeight={38}
              gap={36}
              marginTop={32}
              fontSize={12}
            />
          </div>
        )}
      </div>
    </div>
  );
}
