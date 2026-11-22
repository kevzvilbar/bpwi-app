'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { ACTIVITY_BY_ID, type DailyActivityRow, type JobOrderRow } from '@/lib/activity-types';
import WellPulloutReportSheet from '@/components/WellPulloutReportSheet';
import TankCleaningReportSheet from '@/components/TankCleaningReportSheet';

type LookupOp = { id: string; full_name: string; position: string | null };
type LookupArea = { id: string; code: string; name: string | null };
type LookupShift = { id: string; code: string; description?: string | null };

function fmtTs(ts: string | null | undefined) {
  if (!ts) return 'N/A';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

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
  mode: 'activity' | 'meter_test' | 'well_pull_out' | 'tank_cleaning';
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
    setSheetView('form');
  }, [p.mode, actId]);

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
  const showPulloutSheet = Boolean(
    act && (p.mode === 'well_pull_out' || isPulloutEligible) && sheetView === 'form',
  );
  const showTankCleaningSheet = Boolean(
    act && (p.mode === 'tank_cleaning' || isTankCleaningEligible) && sheetView === 'form',
  );
  const hideGenericHeader = showPulloutSheet || showTankCleaningSheet;
  const areaLabel = areaObj ? `${areaObj.code}${areaObj.name ? ` · ${areaObj.name}` : ''}` : '';

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
                    : 'Field Operations / Job Order Report Preview'}
            </strong>
            {(isPulloutEligible || isTankCleaningEligible) && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={sheetView === 'form' ? 'btn btn-primary' : 'btn'}
                  style={{ fontSize: 11.5, padding: '4px 9px' }}
                  onClick={() => setSheetView('form')}
                >
                  {isTankCleaningEligible ? '📄 Official Tank Cleaning Report' : '📄 Official Deepwell Pull-Out Form'}
                </button>
                <button
                  type="button"
                  className={sheetView === 'standard' ? 'btn btn-primary' : 'btn'}
                  style={{ fontSize: 11.5, padding: '4px 9px' }}
                  onClick={() => setSheetView('standard')}
                >
                  📋 Standard Activity Sheet (with Photos)
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #0f172a', paddingBottom: 12, marginBottom: 18, gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <img src="/bpwi-logo.png" alt="BP Waterworks, Inc." style={{ width: 52, height: 39, objectFit: 'contain' }} />
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#334155' }}>
                  {p.orgName || 'BP Waterworks, Inc.'}
                </div>
                <h1 style={{ margin: 0, fontSize: 19, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  {p.mode === 'meter_test' ? 'Water Meter Volumetric Test Certificate' : 'Field Activity & Job Order Report'}
                </h1>
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{refCode}</div>
              <div style={{ color: '#475569' }}>Date: {act?.activity_date ?? (jo?.created_at ? jo.created_at.slice(0, 10) : 'N/A')}</div>
              <div style={{ color: '#475569', fontSize: 11 }}>Printed: {fmtTs(new Date().toISOString())}</div>
            </div>
          </div>
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
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
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

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18, marginTop: 28, textAlign: 'center', fontSize: 12 }}>
              <div>
                <div style={{ height: 52, display: 'grid', placeItems: 'end center', borderBottom: '1px solid #0f172a', marginBottom: 4, fontWeight: 600 }}>
                  {leadOp?.full_name ?? ''}
                </div>
                <b>Tested By</b>
                <div style={{ fontSize: 11, color: '#475569' }}>Field Technician / Operator</div>
              </div>
              <div>
                <div style={{ height: 52, display: 'grid', placeItems: 'center', borderBottom: '1px solid #0f172a', marginBottom: 4 }}>
                  {(() => {
                    const sigUrl =
                      act?.signature_data !== undefined
                        ? act.signature_data
                        : fetchedSig && act && fetchedSig.id === act.id
                          ? fetchedSig.data
                          : null;
                    return sigUrl ? (
                      <img src={sigUrl} alt="Witness signature" style={{ maxHeight: 46, maxWidth: '100%', objectFit: 'contain' }} />
                    ) : (
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>No signature captured</span>
                    );
                  })()}
                </div>
                <b>Witnessed By: {detStr('witnessedBy', 'Customer Representative')}</b>
                <div style={{ fontSize: 11, color: '#475569' }}>Signature over Printed Name</div>
              </div>
              <div>
                <div style={{ height: 52, borderBottom: '1px solid #0f172a', marginBottom: 4 }} />
                <b>Verified / Noted By</b>
                <div style={{ fontSize: 11, color: '#475569' }}>Supervisor / Operations Head</div>
              </div>
            </div>
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
            </div>

            {(jo?.description || act?.notes) && (
              <div style={{ border: '1px solid #334155', padding: 12 }}>
                <div style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 11, marginBottom: 4, color: '#334155' }}>
                  Work Description &amp; Field Observations
                </div>
                {jo?.description && <div style={{ marginBottom: 6 }}>{jo.description}</div>}
                {act?.notes && <div><i>&ldquo;{act.notes}&rdquo;</i></div>}
              </div>
            )}

            {act && Object.keys(det).length > 0 && (
              <div>
                <div style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 11, marginBottom: 6, color: '#334155' }}>
                  Recorded Field Telemetry &amp; Parameters
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9' }}>
                      <th style={{ border: '1px solid #334155', padding: '6px 8px', textAlign: 'left', width: '35%' }}>Parameter</th>
                      <th style={{ border: '1px solid #334155', padding: '6px 8px', textAlign: 'left' }}>Recorded Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(det).map(([key, val]) => {
                      if (val === null || val === undefined || val === '') return null;
                      const formattedVal = Array.isArray(val)
                        ? val.map((item) => (typeof item === 'object' && item !== null ? Object.values(item).filter(Boolean).join(' · ') : String(item))).join('; ')
                        : typeof val === 'object'
                          ? JSON.stringify(val)
                          : String(val);
                      if (!formattedVal) return null;
                      return (
                        <tr key={key}>
                          <td style={{ border: '1px solid #334155', padding: '5px 8px', fontWeight: 600, textTransform: 'capitalize' }}>
                            {key.replace(/([A-Z])/g, ' $1')}
                          </td>
                          <td style={{ border: '1px solid #334155', padding: '5px 8px' }}>{formattedVal}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 36, marginTop: 32, textAlign: 'center', fontSize: 12 }}>
              <div>
                <div style={{ borderBottom: '1px solid #0f172a', height: 38, marginBottom: 4, display: 'grid', placeItems: 'end center', fontWeight: 600 }}>
                  {leadOp?.full_name ?? ''}
                </div>
                <b>Prepared By</b>
                <div style={{ fontSize: 11, color: '#475569' }}>Assigned Operator / Personnel</div>
              </div>
              <div>
                <div style={{ borderBottom: '1px solid #0f172a', height: 38, marginBottom: 4 }} />
                <b>Checked / Verified By</b>
                <div style={{ fontSize: 11, color: '#475569' }}>Signature over Printed Name</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
