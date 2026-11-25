'use client';

import type { CSSProperties } from 'react';
import type { DailyActivityRow } from '@/lib/activity-types';
import {
  formatPulloutDateDisplay,
  formatPulloutTimeDisplay,
  hydrateWellPulloutDetails,
  resolveInstalledPulloutSpecs,
} from '@/lib/well-pullout-types';
import {
  REPORT_BORDER,
  REPORT_BORDER_HEAVY,
  REPORT_SECTION_BAR_STYLE,
  ReportLetterhead,
  ReportSignatureGrid,
} from '@/components/ReportSheetPrimitives';

interface WellPulloutReportSheetProps {
  activity: DailyActivityRow;
  orgName: string;
  areaLabel: string;
  leadOpName: string;
  crewNames?: string[];
}

type FieldRowSpec = {
  label: string;
  value: string;
  suffix?: string;
  uppercase?: boolean;
  indent?: boolean;
};

const B = REPORT_BORDER;
const TB = REPORT_BORDER_HEAVY;

const S = {
  root: { color: '#0f172a', fontFamily: 'Arial, sans-serif' },
  outerBox: { border: TB },
  titleBar: { marginTop: 0, padding: '3.5px 8px' },
  hdrBar: { ...REPORT_SECTION_BAR_STYLE, fontSize: 9, padding: '2.5px 6px', lineHeight: 1.25 },
  padCell: { padding: '2px 5px', fontSize: 8.8, lineHeight: 1.25, color: '#0f172a' },
  padCellCol: { padding: '2px 5px', fontSize: 8.8, lineHeight: 1.25, color: '#0f172a', display: 'flex', flexDirection: 'column' },
  padCellGrid2: { padding: '2px 5px', fontSize: 8.8, lineHeight: 1.25, color: '#0f172a', display: 'grid', gap: 2 },
  padCellGrid3: { padding: '3px 5px', fontSize: 8.8, lineHeight: 1.25, color: '#0f172a', display: 'grid', gap: 3 },
  halfBorderR: { padding: '2px 5px', fontSize: 8.8, lineHeight: 1.25, color: '#0f172a', borderRight: B, display: 'grid', gap: 2 },
  irSplit: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 64px' },
  irSplitTop: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 64px', borderBottom: TB },
  irHeader: { borderLeft: TB, background: '#f8fafc', display: 'grid', placeItems: 'center', padding: 4, fontSize: 7.8, fontWeight: 800, lineHeight: 1.25 },
  irStrip: { borderLeft: TB, display: 'grid', gridTemplateRows: 'repeat(34, minmax(0, 1fr))' },
  irNum: { borderRight: B, color: '#475569' },
  metaBand: { display: 'grid', gridTemplateColumns: '2.2fr 1fr 0.8fr', gap: 10, padding: '3px 6px', borderBottom: TB, fontSize: 9 },
  sec1Grid: { display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 12, padding: '3px 6px' },
  secSplit: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 196px', borderBottom: TB },
  sec5Split: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 196px' },
  secLeft: { borderRight: B },
  secSubHdr: { padding: '2px 5px', fontSize: 8, fontWeight: 700, color: '#334155', borderBottom: B, lineHeight: 1.25 },
  zeroGapBorderB: { gap: 0, borderBottom: B },
  zeroGap: { gap: 0 },
  subTitle: { fontWeight: 800, fontSize: 8.5, textDecoration: 'underline' },
  phaseRow: { display: 'grid', gridTemplateColumns: '116px repeat(3, minmax(0, 1fr))', gap: 6, alignItems: 'baseline', fontSize: 8.5 },
  phaseSlot: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 38px', alignItems: 'baseline', gap: 3 },
  phaseLabel: { fontWeight: 600, color: '#334155' },
  unitText: { fontSize: 7.8, color: '#334155' },
  underlineSpan: { borderBottom: '1px solid #475569', textAlign: 'center', fontWeight: 700, color: '#0f172a', minHeight: 12, padding: '0 3px' },
  remarksLbl: { fontWeight: 700, borderBottom: B, paddingBottom: 2, marginBottom: 3 },
  remarksLblPlain: { fontWeight: 700, marginBottom: 3 },
  upperVal: { textTransform: 'uppercase' },
  midCol: { display: 'flex', flexDirection: 'column', fontSize: 8.2 },
  reminderRow: { padding: '2px 5px', fontSize: 8.8, lineHeight: 1.25, color: '#0f172a', borderBottom: B, display: 'grid', gridTemplateColumns: '68px 1fr', gap: 6 },
  irCompareRow: { padding: '4px 6px', borderBottom: B },
  tbl: { marginTop: 0, fontSize: 8.1 },
  tdCompact: { padding: '2px 4px', borderColor: '#1e293b' },
  tdCompactWide: { padding: '2px 4px', borderColor: '#1e293b', width: '68%' },
  bottomBandTop: { borderTop: TB, display: 'grid', gridTemplateColumns: '1fr 1.25fr' },
  bottomBandCert: { borderTop: B, display: 'grid', gridTemplateColumns: '1fr 1.25fr' },
  bottomLeftHeavy: { borderRight: TB },
  overallBox: { padding: '2px 5px', fontSize: 8.8, lineHeight: 1.25, color: '#0f172a', textTransform: 'uppercase', minHeight: 28 },
  performedCol: { padding: '2px 5px', fontSize: 8.8, color: '#0f172a', borderRight: TB, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' },
  sigLine: { minHeight: 16, fontWeight: 800, fontSize: 8.8, borderBottom: '1px solid #0f172a', paddingBottom: 1 },
  sigImg: { maxHeight: 22, maxWidth: '100%', objectFit: 'contain' },
  sigSub: { fontSize: 7.8, marginTop: 1 },
  certBox: { padding: '2px 5px', fontSize: 8.2, lineHeight: 1.35, fontWeight: 600, color: '#0f172a' },
  notesWrap: { fontSize: 8, color: '#334155', lineHeight: 1.3 },
  notesBody: { paddingLeft: 18 },
} satisfies Record<string, CSSProperties>;

function deriveMonthYear(dateStr: string): { month: string; year: string } {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return { month: '', year: '' };
  const yearNum = Number(parts[0]);
  const monthIdx = Number(parts[1]) - 1;
  if (!Number.isFinite(yearNum) || !Number.isFinite(monthIdx) || monthIdx < 0 || monthIdx > 11) {
    return { month: '', year: '' };
  }
  const month = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(yearNum, monthIdx, 1)),
  );
  return { month, year: String(yearNum) };
}

function StatusCheck({ checked, label }: { checked: boolean; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginRight: 8, fontSize: 8.5 }}>
      <span
        className="text-center"
        style={{
          display: 'inline-block',
          width: 10,
          height: 10,
          border: '1px solid #0f172a',
          lineHeight: '9px',
          fontWeight: 800,
          fontSize: 8,
          background: checked ? '#0f172a' : '#ffffff',
          color: checked ? '#ffffff' : '#0f172a',
        }}
      >
        {checked ? '✓' : ''}
      </span>
      <span style={{ fontWeight: checked ? 800 : 500 }}>{label}</span>
    </span>
  );
}

function UnderlinedRow({
  label,
  value,
  suffix = '',
  uppercase = false,
  labelWidth = '118px',
  unitWidth = '24px',
  indent = false,
}: FieldRowSpec & { labelWidth?: string; unitWidth?: string }) {
  const showUnitCol = unitWidth !== '0px';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: showUnitCol ? `${labelWidth} minmax(0, 1fr) ${unitWidth}` : `${labelWidth} minmax(0, 1fr)`,
        alignItems: 'baseline',
        gap: 4,
        fontSize: 8.5,
        lineHeight: 1.35,
      }}
    >
      <span style={{ color: '#334155', fontWeight: 600, paddingLeft: indent ? 10 : 0 }}>{label}</span>
      <span style={{ ...S.underlineSpan, textTransform: uppercase ? 'uppercase' : 'none' }}>{value || ''}</span>
      {showUnitCol && <span style={{ fontSize: 8, color: '#334155' }}>{suffix}</span>}
    </div>
  );
}

function FieldRowsList({
  rows,
  labelWidth,
  unitWidth,
}: {
  rows: ReadonlyArray<FieldRowSpec>;
  labelWidth: string;
  unitWidth: string;
}) {
  return (
    <>
      {rows.map((r) => (
        <UnderlinedRow key={r.label} {...r} labelWidth={labelWidth} unitWidth={unitWidth} />
      ))}
    </>
  );
}

function PhaseLineRow({ label, slots }: { label: string; slots: ReadonlyArray<{ val: string; unit: string }> }) {
  return (
    <div style={S.phaseRow}>
      <span style={S.phaseLabel}>{label}</span>
      {slots.map((s) => (
        <div key={s.unit} style={S.phaseSlot}>
          <span style={S.underlineSpan}>{s.val || ''}</span>
          <span style={{ ...S.unitText, whiteSpace: 'nowrap' }}>{s.unit}</span>
        </div>
      ))}
    </div>
  );
}

function VerticalIrColumn({ title, vals }: { title: string; vals: readonly [string, string, string] }) {
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      <div style={{ fontSize: 8.2, fontWeight: 700, color: '#0f172a', lineHeight: 1.25 }}>{title}</div>
      <div style={{ display: 'grid', gap: 2, paddingTop: 2 }}>
        {(['L1', 'L2', 'L3'] as const).map((phase, idx) => (
          <div key={phase} style={{ display: 'grid', gridTemplateColumns: '108px 38px', alignItems: 'baseline', gap: 4, fontSize: 8.5 }}>
            <span style={S.underlineSpan}>{vals[idx] || ''}</span>
            <span style={{ fontSize: 8, color: '#334155', whiteSpace: 'nowrap' }}>({phase}) MΩ</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MotorControlDetailsBlock({
  title,
  cableSize,
  cableLength,
  splicingCount,
  relayRange,
  relaySetting,
  contactorRating,
}: {
  title: string;
  cableSize: string;
  cableLength: string;
  splicingCount: string;
  relayRange: string;
  relaySetting: string;
  contactorRating: string;
}) {
  const rows: FieldRowSpec[] = [
    { label: 'Cable Size', value: cableSize, suffix: 'mm²' },
    { label: 'Cable Length', value: cableLength, suffix: 'm' },
    { label: '# of Splicing (ex. pigtail)', value: splicingCount },
  ];
  const relayRows: FieldRowSpec[] = [
    { label: 'Range', value: relayRange, suffix: 'A', indent: true },
    { label: 'Setting', value: relaySetting, suffix: 'A', indent: true },
    { label: 'Magnetic Contactor Rating', value: contactorRating, suffix: 'A' },
  ];
  return (
    <div style={{ ...S.padCellGrid2, alignContent: 'start' }}>
      <div style={S.subTitle}>{title}</div>
      <FieldRowsList rows={rows} labelWidth="132px" unitWidth="24px" />
      <div className="font-bold" style={{ fontSize: 8.2, marginTop: 1 }}>Thermal Overload Relay</div>
      <FieldRowsList rows={relayRows} labelWidth="132px" unitWidth="24px" />
    </div>
  );
}

function MiddleTimeHeader({ value }: { value: string }) {
  return (
    <div className="row-between" style={S.hdrBar}>
      <span>Time:</span>
      <span>{formatPulloutTimeDisplay(value) || '—'}</span>
    </div>
  );
}

export default function WellPulloutReportSheet({
  activity,
  orgName,
  areaLabel,
  leadOpName,
  crewNames = [],
}: WellPulloutReportSheetProps) {
  const w = resolveInstalledPulloutSpecs(hydrateWellPulloutDetails(activity.details ?? {}), activity.activity_date);
  const derivedMY = deriveMonthYear(activity.activity_date || w.dateStarted);
  const station = activity.site_or_well || areaLabel || w.projectPumpStation || 'N/A';
  const month = derivedMY.month || w.reportMonth;
  const year = derivedMY.year || w.reportYear;
  const startDateDisplay = formatPulloutDateDisplay(w.dateStarted || activity.activity_date);
  const endDateDisplay = formatPulloutDateDisplay(w.dateFinished || w.dateStarted || activity.activity_date);
  const performedByDisplay =
    Array.from(new Set([leadOpName, ...crewNames].filter(Boolean))).join(', ') || w.performedByContractor || '';
  const signatureDataUrl = typeof activity.details?.signatureDataUrl === 'string' ? activity.details.signatureDataUrl : '';
  const irRows = Array.from({ length: 34 }, (_, idx) => idx + 1);

  const headerMetaFields = [
    { label: 'Project - Pump Station:', value: station, uppercase: true, center: false },
    { label: 'Month:', value: month, uppercase: false, center: true },
    { label: 'Year:', value: year, uppercase: false, center: true },
  ];

  const sec1Left: FieldRowSpec[] = [
    { label: 'Contractor / Site Coordinator:', value: w.contractorCoordinator },
    { label: 'Time Reported to Engineer:', value: formatPulloutTimeDisplay(w.timeReportedToEngineer) },
    { label: 'Arrival Time at Site:', value: formatPulloutTimeDisplay(w.arrivalTimeAtSite) },
    { label: 'Time of Set-up:', value: formatPulloutTimeDisplay(w.timeOfSetUp) },
  ];
  const sec1Right: FieldRowSpec[] = [
    { label: 'Date Started:', value: startDateDisplay },
    { label: 'Time Started:', value: formatPulloutTimeDisplay(w.timeStarted) },
    { label: 'Date Finished:', value: endDateDisplay },
    { label: 'Time Finished:', value: formatPulloutTimeDisplay(w.timeFinished) },
  ];

  const sec2PhaseRows = [
    { label: 'Insulation Resistance', slots: [{ val: w.beforePulloutIrL1, unit: '(L1) mΩ' }, { val: w.beforePulloutIrL2, unit: '(L2) mΩ' }, { val: w.beforePulloutIrL3, unit: '(L3) mΩ' }] },
    { label: 'Current Reading', slots: [{ val: w.beforePulloutCurrentL1, unit: '(L1) A' }, { val: w.beforePulloutCurrentL2, unit: '(L2) A' }, { val: w.beforePulloutCurrentL3, unit: '(L3) A' }] },
    { label: 'Voltage Reading', slots: [{ val: w.beforePulloutVoltageL1, unit: '(L1) V' }, { val: w.beforePulloutVoltageL2, unit: '(L2) V' }, { val: w.beforePulloutVoltageL3, unit: '(L3) V' }] },
  ];

  const sec3PumpRows: FieldRowSpec[] = [
    { label: 'Brand', value: w.pulledPumpBrand, uppercase: true },
    { label: 'Model', value: w.pulledPumpModel, uppercase: true },
    { label: 'Stock No.:', value: w.pulledPumpStockNo, uppercase: true },
  ];
  const sec3MotorRows: FieldRowSpec[] = [
    { label: 'Brand', value: w.pulledMotorBrand, uppercase: true },
    { label: 'HP / Voltage / Phase', value: w.pulledMotorHpVoltPhase, uppercase: true },
    { label: 'Serial No. / Stock No.:', value: w.pulledMotorSerialNo, uppercase: true },
  ];
  const sec3DeepwellRows: FieldRowSpec[] = [
    { label: 'Size of Riser Pipes', value: w.pulledRiserPipeSizeMm, suffix: 'mm' },
    { label: 'Type of Riser Material:', value: w.pulledRiserPipeMaterial },
    { label: 'No. of Riser Pipes', value: w.pulledRiserPipeCount, suffix: 'pcs' },
    { label: 'Well Casing Diameter', value: w.wellCasingDiameterMm, suffix: 'mm' },
    { label: 'Well Depth', value: w.wellDepthM, suffix: 'm' },
    { label: 'Pump Setting', value: w.pumpSettingM, suffix: 'm' },
    { label: 'Static Water Level', value: w.swlMeters, suffix: 'm' },
    { label: 'Pumping Water Level', value: w.pwlMeters, suffix: 'm' },
    { label: 'Motor Control Type:', value: w.motorControlType, uppercase: true },
  ];

  const sec4EquipGroups = [
    {
      title: 'PUMP DETAILS',
      labelWidth: '64px',
      borderRight: true,
      status: w.installPumpStatus,
      rows: [
        { label: 'Brand', value: w.installPumpBrand, uppercase: true },
        { label: 'Model', value: w.installPumpModel, uppercase: true },
        { label: 'Control No.', value: w.installPumpControlNo, uppercase: true },
      ],
    },
    {
      title: 'MOTOR DETAILS',
      labelWidth: '108px',
      borderRight: false,
      status: w.installMotorStatus,
      rows: [
        { label: 'Brand', value: w.installMotorBrand, uppercase: true },
        { label: 'HP / Voltage / Phase:', value: w.installMotorHpVoltPhase, uppercase: true },
        { label: 'Serial No.', value: w.installMotorSerialNo, uppercase: true },
      ],
    },
  ];
  const sec4AcceptanceRows = [
    ['No loose thread', w.checkNoLooseThread || 'NONE'],
    ['No visible corrosion', w.checkNoVisibleCorrosion || 'NONE'],
    ['Should not be 0 Meg', w.checkElectrodeNotZeroMeg || 'YES'],
  ] as const;
  const sec4SpliceRows = [
    ['Before splicing', 'should not be < 100 MΩ', w.beforeSpliceRemarks || ''],
    ['After splicing', 'should not be < 2 MΩ', w.afterSpliceRemarks || ''],
  ] as const;

  const sec5DeepwellRows: FieldRowSpec[] = [
    { label: 'Size of Riser Pipes', value: w.installRiserPipeSizeMm, suffix: 'mm' },
    { label: 'No. of Riser Pipes', value: w.installRiserPipeCount, suffix: 'pcs' },
    { label: 'No. of Sounding Pipes', value: w.soundingPipeLengthM, suffix: 'm' },
    { label: 'Flowrate:', value: w.afterInstallFlowrateLps, suffix: 'lps' },
    { label: 'Pressure at Source:', value: w.afterInstallPressurePsi, suffix: 'psi' },
  ];
  const sec5PhaseRows = [
    { label: 'Insulation Resistance:', slots: [{ val: w.afterInstallIrL1, unit: '(L1) MΩ' }, { val: w.afterInstallIrL2, unit: '(L2) MΩ' }, { val: w.afterInstallIrL3, unit: '(L3) MΩ' }] },
    { label: 'Current Reading:', slots: [{ val: w.afterInstallCurrentL1, unit: '(L1) A' }, { val: w.afterInstallCurrentL2, unit: '(L2) A' }, { val: w.afterInstallCurrentL3, unit: '(L3) A' }] },
    { label: 'Voltage Reading:', slots: [{ val: w.afterInstallVoltageL1, unit: '(L1) V' }, { val: w.afterInstallVoltageL2, unit: '(L2) V' }, { val: w.afterInstallVoltageL3, unit: '(L3) V' }] },
  ];
  const sec5AcceptanceRows = [
    ['should not be < 2 MΩ', w.acceptIrAbove2Meg || 'YES'],
    ['should not be + 14%', w.acceptCurrentWithin14Pct || 'YES'],
    ['should not be +/-10% of nominal 230V', w.acceptVoltageWithin10Pct || 'YES'],
  ] as const;

  return (
    <div className="stack-xs" style={S.root}>
      <ReportLetterhead
        variant="compact"
        orgName={orgName}
        subtitle="Deepwell Operations & Maintenance Accomplishment Report"
        refCode={`Ref: ACT-${activity.id.slice(0, 8).toUpperCase()}`}
        dateLabel={`Activity Date: ${formatPulloutDateDisplay(activity.activity_date) || 'N/A'}`}
      />

      <div style={S.outerBox}>
        <div style={S.irSplitTop}>
          <div>
            <div className="rpt-section-hdr text-center" style={S.titleBar}>
              PULL OUT AND INSTALLATION ACCOMPLISHMENT REPORT FORM FOR DEEPWELL
            </div>

            <div style={S.metaBand}>
              {headerMetaFields.map((f) => (
                <div key={f.label} className="row-xs">
                  <span className="font-bold">{f.label}</span>
                  <span
                    className={`flex-1 font-bold ${f.center ? 'text-center' : ''}`}
                    style={{ borderBottom: B, fontWeight: 800, textTransform: f.uppercase ? 'uppercase' : 'none' }}
                  >
                    {f.value}
                  </span>
                </div>
              ))}
            </div>

            <div style={S.hdrBar}>1. TO BE FILLED UP BY CONTRACTOR / SITE COORDINATOR</div>
            <div style={S.sec1Grid}>
              <div style={{ display: 'grid', gap: 2 }}>
                <FieldRowsList rows={sec1Left} labelWidth="130px" unitWidth="0px" />
              </div>
              <div style={{ display: 'grid', gap: 2 }}>
                <FieldRowsList rows={sec1Right} labelWidth="82px" unitWidth="0px" />
              </div>
            </div>
          </div>

          <div className="text-center" style={S.irHeader}>INSULATION RESISTANCE READING (meg Ω)</div>
        </div>

        <div style={S.irSplit}>
          <div>
            {/* SECTION 2 */}
            <div style={S.secSplit}>
              <div style={S.secLeft}>
                <div style={S.hdrBar}>2. BEFORE PULL OUT OF PUMP AND MOTOR</div>
                <div style={S.padCellGrid3}>
                  <div style={{ fontSize: 8, fontWeight: 700, color: '#334155' }}>Get the following before Pull Out</div>
                  <div style={S.phaseRow}>
                    <span style={S.phaseLabel}>Flowrate:</span>
                    <div style={S.phaseSlot}>
                      <span style={S.underlineSpan}>{w.beforePulloutFlowrateLps || ''}</span>
                      <span style={S.unitText}>lps</span>
                    </div>
                    <span className="text-right" style={{ ...S.phaseLabel, paddingRight: 4 }}>Pressure at Source:</span>
                    <div style={S.phaseSlot}>
                      <span style={S.underlineSpan}>{w.beforePulloutPressurePsi || ''}</span>
                      <span style={S.unitText}>psi</span>
                    </div>
                  </div>
                  {sec2PhaseRows.map((row) => (
                    <PhaseLineRow key={row.label} label={row.label} slots={row.slots} />
                  ))}
                </div>
              </div>
              <div style={S.padCellCol}>
                <div style={S.remarksLbl}>Remarks:</div>
                <div className="flex-1 font-bold" style={S.upperVal}>{w.beforePulloutRemarks || ''}</div>
              </div>
            </div>

            {/* SECTION 3 */}
            <div style={S.secSplit}>
              <div style={S.secLeft}>
                <div style={S.hdrBar}>3. AFTER PULL OUT OF PUMP AND MOTOR</div>
                <div style={S.secSubHdr}>Get the following data upon completion of Pull-out of Pump and Motor</div>
                <div className="grid-2" style={S.zeroGapBorderB}>
                  <div style={S.halfBorderR}>
                    <div style={S.subTitle}>PUMP DETAILS</div>
                    <FieldRowsList rows={sec3PumpRows} labelWidth="64px" unitWidth="0px" />
                  </div>
                  <div style={S.padCellGrid2}>
                    <div style={S.subTitle}>MOTOR DETAILS</div>
                    <FieldRowsList rows={sec3MotorRows} labelWidth="108px" unitWidth="0px" />
                  </div>
                </div>
                <div className="grid-2" style={S.zeroGap}>
                  <div style={S.halfBorderR}>
                    <div style={S.subTitle}>DEEPWELL DETAILS</div>
                    <FieldRowsList rows={sec3DeepwellRows} labelWidth="118px" unitWidth="24px" />
                  </div>
                  <MotorControlDetailsBlock
                    title="Motor Control Details"
                    cableSize={w.pulledCableSizeMm2}
                    cableLength={w.pulledCableLengthM}
                    splicingCount={w.pulledCableSplicingCount}
                    relayRange={w.pulledOverloadRelayRangeA}
                    relaySetting={w.pulledOverloadRelaySettingA}
                    contactorRating={w.pulledMagneticContactorRatingA}
                  />
                </div>
              </div>
              <div style={S.midCol}>
                <MiddleTimeHeader value={w.afterPulloutTime} />
                <div className="flex-1" style={S.padCell}>
                  <div style={S.remarksLblPlain}>Remarks:</div>
                  <div className="font-bold" style={S.upperVal}>{w.afterPulloutRemarks || ''}</div>
                </div>
              </div>
            </div>

            {/* SECTION 4 */}
            <div style={S.secSplit}>
              <div style={S.secLeft}>
                <div style={S.hdrBar}>4. BEFORE INSTALLATION PUMP AND MOTOR</div>
                <div style={S.reminderRow}>
                  <span className="font-bold">Reminder:</span>
                  <div className="font-bold" style={{ lineHeight: 1.3 }}>
                    <div>No corrosion at vertical pipes assembly</div>
                    <div>Electrode shall be cleaned before installation</div>
                    <div>Check condition of electrode wires</div>
                  </div>
                </div>
                <div className="grid-2" style={S.zeroGapBorderB}>
                  {sec4EquipGroups.map((g) => (
                    <div key={g.title} style={g.borderRight ? S.halfBorderR : S.padCellGrid2}>
                      <div style={S.subTitle}>{g.title}</div>
                      <FieldRowsList rows={g.rows} labelWidth={g.labelWidth} unitWidth="0px" />
                      <div style={{ display: 'grid', gridTemplateColumns: `${g.labelWidth} minmax(0, 1fr)`, alignItems: 'center', gap: 4, paddingTop: 2 }}>
                        <span style={S.phaseLabel}>Status:</span>
                        <div>
                          <StatusCheck checked={g.status === 'Brand New'} label="Brand New" />
                          <StatusCheck checked={g.status === 'Repaired'} label="Repaired" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="grid-2" style={S.irCompareRow}>
                  <VerticalIrColumn
                    title="Insulation Resistance of the MOTOR (before splicing) should not be less than 100 Mega Ohms"
                    vals={[w.motorIrBeforeSpliceL1, w.motorIrBeforeSpliceL2, w.motorIrBeforeSpliceL3]}
                  />
                  <VerticalIrColumn
                    title="Insulation Resistance (Submersible Cable & Motor was Spliced) should not be less than 2 Mega Ohms"
                    vals={[w.splicedIrL1, w.splicedIrL2, w.splicedIrL3]}
                  />
                </div>
                <div style={S.padCellGrid3}>
                  <PhaseLineRow
                    label="No Load Current Reading"
                    slots={[{ val: w.noLoadCurrentL1, unit: '(L1) A' }, { val: w.noLoadCurrentL2, unit: '(L2) A' }, { val: w.noLoadCurrentL3, unit: '(L3) A' }]}
                  />
                </div>
              </div>

              <div style={S.midCol}>
                <MiddleTimeHeader value={w.beforeInstallTime} />
                <table className="rpt-tbl" style={S.tbl}>
                  <thead>
                    <tr>
                      <th className="rpt-th rpt-lbl" style={S.tdCompact}>Acceptance Criteria</th>
                      <th className="rpt-th rpt-lbl" style={S.tdCompact}>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sec4AcceptanceRows.map(([criteria, remark]) => (
                      <tr key={criteria}>
                        <td className="rpt-td" style={S.tdCompact}>{criteria}</td>
                        <td className="rpt-td-c font-bold" style={S.tdCompact}>{remark}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <table className="rpt-tbl flex-1" style={S.tbl}>
                  <tbody>
                    {sec4SpliceRows.map(([title, rule, remark]) => (
                      <tr key={title}>
                        <td className="rpt-td" style={S.tdCompactWide}>
                          <div className="font-bold">{title}</div>
                          <div>{rule}</div>
                        </td>
                        <td className="rpt-td-c font-bold" style={S.tdCompact}>{remark}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* SECTION 5 */}
            <div style={S.sec5Split}>
              <div style={S.secLeft}>
                <div style={S.hdrBar}>5. AFTER INSTALLATION</div>
                <div style={{ ...S.padCell, borderBottom: B, fontSize: 8, lineHeight: 1.3 }}>
                  <div className="font-bold">* Check if there are leaks on the fittings on the deepwell upon the completion of the activity.</div>
                  <div className="font-bold">* The Contractor should not vacate the area until the leaks are fixed.</div>
                  <div style={{ color: '#334155', marginTop: 1 }}>Get the following data upon completion of Installation of Pump and Motor</div>
                </div>
                <div className="grid-2" style={S.zeroGapBorderB}>
                  <div style={S.halfBorderR}>
                    <div style={S.subTitle}>DEEPWELL DETAILS</div>
                    <FieldRowsList rows={sec5DeepwellRows} labelWidth="118px" unitWidth="24px" />
                  </div>
                  <MotorControlDetailsBlock
                    title="MOTOR CONTROL DETAILS"
                    cableSize={w.installCableSizeMm2}
                    cableLength={w.installCableLengthM}
                    splicingCount={w.installCableSplicingCount}
                    relayRange={w.installOverloadRelayRangeA}
                    relaySetting={w.installOverloadRelaySettingA}
                    contactorRating={w.installMagneticContactorRatingA}
                  />
                </div>
                <div style={S.padCellGrid3}>
                  {sec5PhaseRows.map((row) => (
                    <PhaseLineRow key={row.label} label={row.label} slots={row.slots} />
                  ))}
                </div>
              </div>

              <div style={S.midCol}>
                <MiddleTimeHeader value={w.afterInstallTime} />
                <div className="flex-1" style={{ ...S.padCell, borderBottom: B }}>
                  <div style={S.remarksLblPlain}>Remarks:</div>
                  <div className="font-bold" style={S.upperVal}>{w.afterInstallRemarks || ''}</div>
                </div>
                <table className="rpt-tbl" style={S.tbl}>
                  <tbody>
                    {sec5AcceptanceRows.map(([rule, remark]) => (
                      <tr key={rule}>
                        <td className="rpt-td" style={S.tdCompactWide}>{rule}</td>
                        <td className="rpt-td-c font-bold" style={S.tdCompact}>{remark}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right Strip: 1 to 34 */}
          <div style={S.irStrip}>
            {irRows.map((num) => (
              <div
                key={num}
                style={{
                  borderBottom: num === 34 ? 'none' : B,
                  display: 'grid',
                  gridTemplateColumns: '20px 1fr',
                  alignItems: 'center',
                  fontSize: 7.5,
                }}
              >
                <span className="text-center font-bold" style={S.irNum}>{num}</span>
                <span />
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Band */}
        <div style={S.bottomBandTop}>
          <div style={S.bottomLeftHeavy}>
            <div style={S.hdrBar}>6. Results of Operation</div>
            <div style={S.padCellGrid3}>
              <UnderlinedRow label="Duration of Pull Out & Installation" value={w.operationDuration} uppercase labelWidth="148px" unitWidth="0px" />
              <UnderlinedRow label="Reason of Pull Out & Installation" value={w.reasonOfPullout} uppercase labelWidth="148px" unitWidth="0px" />
            </div>
          </div>
          <div>
            <div style={S.hdrBar}>7. Over All Remarks</div>
            <div className="font-bold" style={S.overallBox}>{w.overallRemarks || activity.notes || '—'}</div>
          </div>
        </div>

        <div style={S.bottomBandCert}>
          <div style={S.performedCol}>
            <div className="font-bold" style={{ fontSize: 8.5 }}>Performed By:</div>
            <div className="text-center" style={{ paddingTop: 2 }}>
              <div style={S.sigLine}>
                {signatureDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={signatureDataUrl} alt="Contractor signature" style={S.sigImg} />
                ) : (
                  performedByDisplay
                )}
              </div>
              <div className="font-bold" style={S.sigSub}>Contractor&apos;s Name / Signature / Date</div>
            </div>
          </div>
          <div style={S.certBox}>
            <div>This is to certify that preventive maintenance/check up/and or repair of the water facilities was done.</div>
            <div>Water facilities or equipment that has been pulled out and repaired was restored in good condition.</div>
            <div>Water supply has been restored.</div>
          </div>
        </div>
      </div>

      <div style={S.notesWrap}>
        <div style={{ fontWeight: 800 }}>NOTES:</div>
        <div style={S.notesBody}>
          <strong>Pls Write: OK</strong> - if Voltage and Current Reading is within acceptable range ·{' '}
          <strong>Not Ok</strong> - if Reading is NOT within acceptable range
        </div>
      </div>
      <ReportSignatureGrid
        entries={[
          { topLabel: 'Checked By:', printedName: w.checkedByCoordinator, roleTitle: '', subtitle: 'Site Coordinator / Electrician' },
          { topLabel: 'Noted By:', printedName: w.notedByEngineer, roleTitle: '', subtitle: 'Electromechanical Engineer / Technical Head' },
        ]}
        lineHeight={18}
        gap={36}
        marginTop={2}
        fontSize={8.8}
      />
    </div>
  );
}
