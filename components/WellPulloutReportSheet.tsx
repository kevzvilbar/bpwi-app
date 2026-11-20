'use client';

import type { DailyActivityRow } from '@/lib/activity-types';
import {
  formatPulloutDateDisplay,
  formatPulloutTimeDisplay,
  hydrateWellPulloutDetails,
  resolveInstalledPulloutSpecs,
} from '@/lib/well-pullout-types';

interface WellPulloutReportSheetProps {
  activity: DailyActivityRow;
  orgName: string;
  areaLabel: string;
  leadOpName: string;
  crewNames?: string[];
}

const B = '1px solid #1e293b';
const TB = '1.5px solid #0f172a';
const MIDDLE_W = '196px';
const IR_COL_W = '64px';

const HDR_BAR: React.CSSProperties = {
  background: '#e2e8f0',
  color: '#0f172a',
  fontWeight: 800,
  fontSize: 9,
  padding: '2.5px 6px',
  borderBottom: B,
  lineHeight: 1.25,
};

const PAD_CELL: React.CSSProperties = {
  padding: '2px 5px',
  fontSize: 8.8,
  lineHeight: 1.25,
  color: '#0f172a',
};

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
        style={{
          display: 'inline-block',
          width: 10,
          height: 10,
          border: '1px solid #0f172a',
          textAlign: 'center',
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
  labelWidth = '42%',
}: {
  label: string;
  value: string;
  suffix?: string;
  uppercase?: boolean;
  labelWidth?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, fontSize: 8.5, lineHeight: 1.35 }}>
      <span style={{ minWidth: labelWidth, color: '#334155', fontWeight: 600, flexShrink: 0 }}>{label}</span>
      <span
        style={{
          flex: 1,
          borderBottom: '1px solid #475569',
          textAlign: 'center',
          fontWeight: 700,
          color: '#0f172a',
          minHeight: 12,
          padding: '0 3px',
          textTransform: uppercase ? 'uppercase' : 'none',
        }}
      >
        {value || ''}
      </span>
      {suffix && <span style={{ fontSize: 8, color: '#334155', width: 22, flexShrink: 0 }}>{suffix}</span>}
    </div>
  );
}

function PhaseLineRow({
  label,
  slots,
}: {
  label: string;
  slots: ReadonlyArray<{ val: string; unit: string }>;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '112px repeat(3, minmax(0, 1fr))', gap: 6, alignItems: 'baseline', fontSize: 8.5 }}>
      <span style={{ fontWeight: 600, color: '#334155' }}>{label}</span>
      {slots.map((s) => (
        <div key={s.unit} style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
          <span
            style={{
              flex: 1,
              borderBottom: '1px solid #475569',
              textAlign: 'center',
              fontWeight: 700,
              minHeight: 12,
            }}
          >
            {s.val || ''}
          </span>
          <span style={{ fontSize: 7.8, color: '#334155', whiteSpace: 'nowrap' }}>{s.unit}</span>
        </div>
      ))}
    </div>
  );
}

function VerticalIrColumn({
  title,
  vals,
  unit = 'MΩ',
}: {
  title: string;
  vals: readonly [string, string, string];
  unit?: string;
}) {
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      <div style={{ fontSize: 8.2, fontWeight: 700, color: '#0f172a', lineHeight: 1.25 }}>{title}</div>
      <div style={{ display: 'grid', gap: 2, paddingTop: 2 }}>
        {(['L1', 'L2', 'L3'] as const).map((phase, idx) => (
          <div key={phase} style={{ display: 'flex', alignItems: 'baseline', gap: 4, fontSize: 8.5 }}>
            <span
              style={{
                width: 96,
                borderBottom: '1px solid #475569',
                textAlign: 'center',
                fontWeight: 700,
                minHeight: 12,
              }}
            >
              {vals[idx] || ''}
            </span>
            <span style={{ fontSize: 8, color: '#334155' }}>
              ({phase}) {unit}
            </span>
          </div>
        ))}
      </div>
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
  const w = resolveInstalledPulloutSpecs(
    hydrateWellPulloutDetails(activity.details ?? {}),
    activity.activity_date,
  );
  const derivedMY = deriveMonthYear(activity.activity_date || w.dateStarted);
  const station = activity.site_or_well || areaLabel || w.projectPumpStation || 'N/A';
  const month = derivedMY.month || w.reportMonth;
  const year = derivedMY.year || w.reportYear;
  const startDateDisplay = formatPulloutDateDisplay(w.dateStarted || activity.activity_date);
  const startTimeDisplay = formatPulloutTimeDisplay(w.timeStarted);
  const endDateDisplay = formatPulloutDateDisplay(w.dateFinished || w.dateStarted || activity.activity_date);
  const endTimeDisplay = formatPulloutTimeDisplay(w.timeFinished);
  const performedByDisplay =
    Array.from(new Set([leadOpName, ...crewNames].filter(Boolean))).join(', ') ||
    w.performedByContractor ||
    '';
  const signatureDataUrl =
    typeof activity.details?.signatureDataUrl === 'string' ? activity.details.signatureDataUrl : '';

  const irRows = Array.from({ length: 34 }, (_, idx) => idx + 1);

  return (
    <div style={{ display: 'grid', gap: 5, color: '#0f172a', fontFamily: 'Arial, sans-serif' }}>
      {/* Company Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingBottom: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bpwi-logo.png" alt="BP Waterworks, Inc." style={{ width: 44, height: 33, objectFit: 'contain' }} />
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '0.02em' }}>
              {orgName || 'BP Waterworks, Inc.'}
            </div>
            <div style={{ fontSize: 8.2, color: '#475569' }}>
              Deepwell Operations &amp; Maintenance Accomplishment Report
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, fontWeight: 800 }}>Ref: ACT-{activity.id.slice(0, 8).toUpperCase()}</div>
          <div style={{ fontSize: 8.2, color: '#475569' }}>
            Activity Date: {formatPulloutDateDisplay(activity.activity_date) || 'N/A'}
          </div>
        </div>
      </div>

      {/* Main Bordered Form */}
      <div style={{ border: TB }}>
        {/* Upper Band: Title, Project/Month/Year, Section 1 + Right IR Header */}
        <div style={{ display: 'grid', gridTemplateColumns: `minmax(0, 1fr) ${IR_COL_W}`, borderBottom: TB }}>
          <div>
            <div
              style={{
                background: '#0f172a',
                color: '#ffffff',
                textAlign: 'center',
                fontWeight: 800,
                fontSize: 10.5,
                letterSpacing: '0.04em',
                padding: '3.5px 8px',
              }}
            >
              PULL OUT AND INSTALLATION ACCOMPLISHMENT REPORT FORM FOR DEEPWELL
            </div>

            {/* Project / Month / Year */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '2.2fr 1fr 0.8fr',
                gap: 10,
                padding: '3px 6px',
                borderBottom: TB,
                fontSize: 9,
              }}
            >
              <div style={{ display: 'flex', gap: 4 }}>
                <span style={{ fontWeight: 700 }}>Project - Pump Station:</span>
                <span style={{ flex: 1, borderBottom: B, fontWeight: 800, textTransform: 'uppercase' }}>{station}</span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <span style={{ fontWeight: 700 }}>Month:</span>
                <span style={{ flex: 1, borderBottom: B, fontWeight: 800, textAlign: 'center' }}>{month}</span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <span style={{ fontWeight: 700 }}>Year:</span>
                <span style={{ flex: 1, borderBottom: B, fontWeight: 800, textAlign: 'center' }}>{year}</span>
              </div>
            </div>

            {/* Section 1 */}
            <div style={HDR_BAR}>1. TO BE FILLED UP BY CONTRACTOR / SITE COORDINATOR</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 12, padding: '3px 6px' }}>
              <div style={{ display: 'grid', gap: 2 }}>
                <UnderlinedRow label="Contractor / Site Coordinator:" value={w.contractorCoordinator} labelWidth="46%" />
                <UnderlinedRow label="Time Reported to Engineer:" value={formatPulloutTimeDisplay(w.timeReportedToEngineer)} labelWidth="46%" />
                <UnderlinedRow label="Arrival Time at Site:" value={formatPulloutTimeDisplay(w.arrivalTimeAtSite)} labelWidth="46%" />
                <UnderlinedRow label="Time of Set-up:" value={formatPulloutTimeDisplay(w.timeOfSetUp)} labelWidth="46%" />
              </div>
              <div style={{ display: 'grid', gap: 2 }}>
                <UnderlinedRow label="Date Started:" value={startDateDisplay} labelWidth="38%" />
                <UnderlinedRow label="Time Started:" value={startTimeDisplay} labelWidth="38%" />
                <UnderlinedRow label="Date Finished:" value={endDateDisplay} labelWidth="38%" />
                <UnderlinedRow label="Time Finished:" value={endTimeDisplay} labelWidth="38%" />
              </div>
            </div>
          </div>

          {/* Right Header Cell: INSULATION RESISTANCE READING */}
          <div
            style={{
              borderLeft: TB,
              background: '#f8fafc',
              display: 'grid',
              placeItems: 'center',
              textAlign: 'center',
              padding: 4,
              fontSize: 7.8,
              fontWeight: 800,
              lineHeight: 1.25,
            }}
          >
            INSULATION RESISTANCE READING (meg Ω)
          </div>
        </div>

        {/* Middle Band: Sections 2-5 Left+Middle alongside numbered IR 1-34 Column */}
        <div style={{ display: 'grid', gridTemplateColumns: `minmax(0, 1fr) ${IR_COL_W}` }}>
          <div>
            {/* SECTION 2 */}
            <div style={{ display: 'grid', gridTemplateColumns: `minmax(0, 1fr) ${MIDDLE_W}`, borderBottom: TB }}>
              <div style={{ borderRight: B }}>
                <div style={HDR_BAR}>2. BEFORE PULL OUT OF PUMP AND MOTOR</div>
                <div style={{ ...PAD_CELL, display: 'grid', gap: 3 }}>
                  <div style={{ fontSize: 8, fontWeight: 700, color: '#334155' }}>Get the following before Pull Out</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <UnderlinedRow label="Flowrate:" value={w.beforePulloutFlowrateLps} suffix="lps" labelWidth="36%" />
                    <UnderlinedRow label="Pressure at Source:" value={w.beforePulloutPressurePsi} suffix="psi" labelWidth="48%" />
                  </div>
                  <PhaseLineRow
                    label="Insulation Resistance"
                    slots={[
                      { val: w.beforePulloutIrL1, unit: '(L1) mΩ' },
                      { val: w.beforePulloutIrL2, unit: '(L2) mΩ' },
                      { val: w.beforePulloutIrL3, unit: '(L3) mΩ' },
                    ]}
                  />
                  <PhaseLineRow
                    label="Current Reading"
                    slots={[
                      { val: w.beforePulloutCurrentL1, unit: '(L1) A' },
                      { val: w.beforePulloutCurrentL2, unit: '(L2) A' },
                      { val: w.beforePulloutCurrentL3, unit: '(L3) A' },
                    ]}
                  />
                  <PhaseLineRow
                    label="Voltage Reading"
                    slots={[
                      { val: w.beforePulloutVoltageL1, unit: '(L1) V' },
                      { val: w.beforePulloutVoltageL2, unit: '(L2) V' },
                      { val: w.beforePulloutVoltageL3, unit: '(L3) V' },
                    ]}
                  />
                </div>
              </div>
              <div style={{ ...PAD_CELL, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontWeight: 700, borderBottom: B, paddingBottom: 2, marginBottom: 3 }}>Remarks:</div>
                <div style={{ fontWeight: 700, textTransform: 'uppercase', flex: 1 }}>
                  {w.beforePulloutRemarks || ''}
                </div>
              </div>
            </div>

            {/* SECTION 3 */}
            <div style={{ display: 'grid', gridTemplateColumns: `minmax(0, 1fr) ${MIDDLE_W}`, borderBottom: TB }}>
              <div style={{ borderRight: B }}>
                <div style={HDR_BAR}>3. AFTER PULL OUT OF PUMP AND MOTOR</div>
                <div style={{ ...PAD_CELL, borderBottom: B, fontSize: 8, fontWeight: 700, color: '#334155' }}>
                  Get the following data upon completion of Pull-out of Pump and Motor
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: B }}>
                  <div style={{ ...PAD_CELL, borderRight: B, display: 'grid', gap: 2 }}>
                    <div style={{ fontWeight: 800, fontSize: 8.5, textDecoration: 'underline' }}>PUMP DETAILS</div>
                    <UnderlinedRow label="Brand" value={w.pulledPumpBrand} uppercase labelWidth="30%" />
                    <UnderlinedRow label="Model" value={w.pulledPumpModel} uppercase labelWidth="30%" />
                    <UnderlinedRow label="Stock No.:" value={w.pulledPumpStockNo} uppercase labelWidth="30%" />
                  </div>
                  <div style={{ ...PAD_CELL, display: 'grid', gap: 2 }}>
                    <div style={{ fontWeight: 800, fontSize: 8.5, textDecoration: 'underline' }}>MOTOR DETAILS</div>
                    <UnderlinedRow label="Brand" value={w.pulledMotorBrand} uppercase labelWidth="42%" />
                    <UnderlinedRow label="HP / Voltage / Phase" value={w.pulledMotorHpVoltPhase} uppercase labelWidth="42%" />
                    <UnderlinedRow label="Serial No. / Stock No.:" value={w.pulledMotorSerialNo} uppercase labelWidth="42%" />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                  <div style={{ ...PAD_CELL, borderRight: B, display: 'grid', gap: 2 }}>
                    <div style={{ fontWeight: 800, fontSize: 8.5, textDecoration: 'underline' }}>DEEPWELL DETAILS</div>
                    <UnderlinedRow label="Size of Riser Pipes" value={w.pulledRiserPipeSizeMm} suffix="mm" labelWidth="48%" />
                    <UnderlinedRow label="Type of Riser Material:" value={w.pulledRiserPipeMaterial} labelWidth="48%" />
                    <UnderlinedRow label="No. of Riser Pipes" value={w.pulledRiserPipeCount} suffix="pcs" labelWidth="48%" />
                    <UnderlinedRow label="Well Casing Diameter" value={w.wellCasingDiameterMm} suffix="mm" labelWidth="48%" />
                    <UnderlinedRow label="Well Depth" value={w.wellDepthM} suffix="m" labelWidth="48%" />
                    <UnderlinedRow label="Pump Setting" value={w.pumpSettingM} suffix="m" labelWidth="48%" />
                    <UnderlinedRow label="Static Water Level" value={w.swlMeters} suffix="m" labelWidth="48%" />
                    <UnderlinedRow label="Pumping Water Level" value={w.pwlMeters} suffix="m" labelWidth="48%" />
                    <UnderlinedRow label="Motor Control Type:" value={w.motorControlType} uppercase labelWidth="48%" />
                  </div>
                  <div style={{ ...PAD_CELL, display: 'grid', gap: 2, alignContent: 'start' }}>
                    <div style={{ fontWeight: 800, fontSize: 8.5, textDecoration: 'underline' }}>Motor Control Details</div>
                    <UnderlinedRow label="Cable Size" value={w.pulledCableSizeMm2} suffix="mm²" labelWidth="46%" />
                    <UnderlinedRow label="Cable Length" value={w.pulledCableLengthM} suffix="m" labelWidth="46%" />
                    <UnderlinedRow label="# of Splicing (ex. pigtail)" value={w.pulledCableSplicingCount} labelWidth="52%" />
                    <div style={{ fontWeight: 700, fontSize: 8.2, marginTop: 2 }}>Thermal Overload Relay</div>
                    <UnderlinedRow label="Range" value={w.pulledOverloadRelayRangeA} suffix="A" labelWidth="46%" />
                    <UnderlinedRow label="Setting" value={w.pulledOverloadRelaySettingA} suffix="A" labelWidth="46%" />
                    <UnderlinedRow label="Magnetic Contactor Rating" value={w.pulledMagneticContactorRatingA} suffix="A" labelWidth="54%" />
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ ...HDR_BAR, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Time:</span>
                  <span>{formatPulloutTimeDisplay(w.afterPulloutTime) || '—'}</span>
                </div>
                <div style={{ ...PAD_CELL, flex: 1 }}>
                  <div style={{ fontWeight: 700, marginBottom: 3 }}>Remarks:</div>
                  <div style={{ fontWeight: 700, textTransform: 'uppercase' }}>{w.afterPulloutRemarks || ''}</div>
                </div>
              </div>
            </div>

            {/* SECTION 4 — Reworked per screenshot */}
            <div style={{ display: 'grid', gridTemplateColumns: `minmax(0, 1fr) ${MIDDLE_W}`, borderBottom: TB }}>
              <div style={{ borderRight: B }}>
                <div style={HDR_BAR}>4. BEFORE INSTALLATION PUMP AND MOTOR</div>
                {/* Reminder block */}
                <div style={{ ...PAD_CELL, borderBottom: B, display: 'grid', gridTemplateColumns: '68px 1fr', gap: 6 }}>
                  <span style={{ fontWeight: 700 }}>Reminder:</span>
                  <div style={{ fontWeight: 700, lineHeight: 1.3 }}>
                    <div>No corrosion at vertical pipes assembly</div>
                    <div>Electrode shall be cleaned before installation</div>
                    <div>Check condition of electrode wires</div>
                  </div>
                </div>
                {/* PUMP / MOTOR DETAILS */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: B }}>
                  <div style={{ ...PAD_CELL, borderRight: B, display: 'grid', gap: 2 }}>
                    <div style={{ fontWeight: 800, fontSize: 8.5, textDecoration: 'underline' }}>PUMP DETAILS</div>
                    <UnderlinedRow label="Brand" value={w.installPumpBrand} uppercase labelWidth="30%" />
                    <UnderlinedRow label="Model" value={w.installPumpModel} uppercase labelWidth="30%" />
                    <UnderlinedRow label="Control No." value={w.installPumpControlNo} uppercase labelWidth="30%" />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 2 }}>
                      <span style={{ fontWeight: 600, color: '#334155', minWidth: '30%' }}>Status:</span>
                      <StatusCheck checked={w.installPumpStatus === 'Brand New'} label="Brand New" />
                      <StatusCheck checked={w.installPumpStatus === 'Repaired'} label="Repaired" />
                    </div>
                  </div>
                  <div style={{ ...PAD_CELL, display: 'grid', gap: 2 }}>
                    <div style={{ fontWeight: 800, fontSize: 8.5, textDecoration: 'underline' }}>MOTOR DETAILS</div>
                    <UnderlinedRow label="Brand" value={w.installMotorBrand} uppercase labelWidth="42%" />
                    <UnderlinedRow label="HP / Voltage / Phase:" value={w.installMotorHpVoltPhase} uppercase labelWidth="42%" />
                    <UnderlinedRow label="Serial No." value={w.installMotorSerialNo} uppercase labelWidth="42%" />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 2 }}>
                      <span style={{ fontWeight: 600, color: '#334155', minWidth: '28%' }}>Status:</span>
                      <StatusCheck checked={w.installMotorStatus === 'Brand New'} label="Brand New" />
                      <StatusCheck checked={w.installMotorStatus === 'Repaired'} label="Repaired" />
                    </div>
                  </div>
                </div>
                {/* Side-by-side IR Before Splicing & IR After Splicing */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '4px 6px', borderBottom: B }}>
                  <VerticalIrColumn
                    title="Insulation Resistance of the MOTOR (before splicing) should not be less than 100 Mega Ohms"
                    vals={[w.motorIrBeforeSpliceL1, w.motorIrBeforeSpliceL2, w.motorIrBeforeSpliceL3]}
                  />
                  <VerticalIrColumn
                    title="Insulation Resistance (Submersible Cable & Motor was Spliced) should not be less than 2 Mega Ohms"
                    vals={[w.splicedIrL1, w.splicedIrL2, w.splicedIrL3]}
                  />
                </div>
                {/* No Load Current Reading */}
                <div style={{ ...PAD_CELL, paddingTop: 3, paddingBottom: 3 }}>
                  <PhaseLineRow
                    label="No Load Current Reading"
                    slots={[
                      { val: w.noLoadCurrentL1, unit: '(L1) A' },
                      { val: w.noLoadCurrentL2, unit: '(L2) A' },
                      { val: w.noLoadCurrentL3, unit: '(L3) A' },
                    ]}
                  />
                </div>
              </div>

              {/* Section 4 Middle Column: Time + Acceptance Criteria + Splice Remarks */}
              <div style={{ display: 'flex', flexDirection: 'column', fontSize: 8.2 }}>
                <div style={{ ...HDR_BAR, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Time:</span>
                  <span>{formatPulloutTimeDisplay(w.beforeInstallTime) || '—'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.65fr', borderBottom: B }}>
                  <div style={{ ...PAD_CELL, borderRight: B, fontWeight: 700, background: '#f8fafc' }}>
                    Acceptance Criteria
                  </div>
                  <div style={{ ...PAD_CELL, fontWeight: 700, background: '#f8fafc' }}>Remarks</div>
                  <div style={{ ...PAD_CELL, borderTop: B, borderRight: B }}>No loose thread</div>
                  <div style={{ ...PAD_CELL, borderTop: B, fontWeight: 800, textAlign: 'center' }}>
                    {w.checkNoLooseThread || 'NONE'}
                  </div>
                  <div style={{ ...PAD_CELL, borderTop: B, borderRight: B }}>No visible corrosion</div>
                  <div style={{ ...PAD_CELL, borderTop: B, fontWeight: 800, textAlign: 'center' }}>
                    {w.checkNoVisibleCorrosion || 'NONE'}
                  </div>
                  <div style={{ ...PAD_CELL, borderTop: B, borderRight: B }}>Should not be 0 Meg</div>
                  <div style={{ ...PAD_CELL, borderTop: B, fontWeight: 800, textAlign: 'center' }}>
                    {w.checkElectrodeNotZeroMeg || 'YES'}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.65fr', flex: 1 }}>
                  <div style={{ ...PAD_CELL, borderRight: B, borderBottom: B }}>
                    <div style={{ fontWeight: 700 }}>Before splicing</div>
                    <div>should not be &lt; 100 MΩ</div>
                  </div>
                  <div style={{ ...PAD_CELL, borderBottom: B, fontWeight: 700, textAlign: 'center' }}>
                    {w.beforeSpliceRemarks || ''}
                  </div>
                  <div style={{ ...PAD_CELL, borderRight: B }}>
                    <div style={{ fontWeight: 700 }}>After splicing</div>
                    <div>should not be &lt; 2 MΩ</div>
                  </div>
                  <div style={{ ...PAD_CELL, fontWeight: 700, textAlign: 'center' }}>
                    {w.afterSpliceRemarks || ''}
                  </div>
                </div>
              </div>
            </div>

            {/* SECTION 5 */}
            <div style={{ display: 'grid', gridTemplateColumns: `minmax(0, 1fr) ${MIDDLE_W}` }}>
              <div style={{ borderRight: B }}>
                <div style={HDR_BAR}>5. AFTER INSTALLATION</div>
                <div style={{ ...PAD_CELL, borderBottom: B, fontSize: 8, lineHeight: 1.3 }}>
                  <div style={{ fontWeight: 700 }}>
                    * Check if there are leaks on the fittings on the deepwell upon the completion of the activity.
                  </div>
                  <div style={{ fontWeight: 700 }}>
                    * The Contractor should not vacate the area until the leaks are fixed.
                  </div>
                  <div style={{ color: '#334155', marginTop: 1 }}>
                    Get the following data upon completion of Installation of Pump and Motor
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: B }}>
                  <div style={{ ...PAD_CELL, borderRight: B, display: 'grid', gap: 2 }}>
                    <div style={{ fontWeight: 800, fontSize: 8.5, textDecoration: 'underline' }}>DEEPWELL DETAILS</div>
                    <UnderlinedRow label="Size of Riser Pipes" value={w.installRiserPipeSizeMm} suffix="mm" labelWidth="48%" />
                    <UnderlinedRow label="No. of Riser Pipes" value={w.installRiserPipeCount} suffix="pcs" labelWidth="48%" />
                    <UnderlinedRow label="No. of Sounding Pipes" value={w.soundingPipeLengthM} suffix="m" labelWidth="48%" />
                    <UnderlinedRow label="Flowrate:" value={w.afterInstallFlowrateLps} suffix="lps" labelWidth="48%" />
                    <UnderlinedRow label="Pressure at Source:" value={w.afterInstallPressurePsi} suffix="psi" labelWidth="48%" />
                  </div>
                  <div style={{ ...PAD_CELL, display: 'grid', gap: 2, alignContent: 'start' }}>
                    <div style={{ fontWeight: 800, fontSize: 8.5, textDecoration: 'underline' }}>MOTOR CONTROL DETAILS</div>
                    <UnderlinedRow label="Cable Size" value={w.installCableSizeMm2} suffix="mm²" labelWidth="46%" />
                    <UnderlinedRow label="Cable Length" value={w.installCableLengthM} suffix="m" labelWidth="46%" />
                    <UnderlinedRow label="# of Splicing (ex. pigtail)" value={w.installCableSplicingCount} labelWidth="52%" />
                    <div style={{ fontWeight: 700, fontSize: 8.2, marginTop: 1 }}>Thermal Overload Relay</div>
                    <UnderlinedRow label="Range" value={w.installOverloadRelayRangeA} suffix="A" labelWidth="46%" />
                    <UnderlinedRow label="Setting" value={w.installOverloadRelaySettingA} suffix="A" labelWidth="46%" />
                    <UnderlinedRow label="Magnetic Contactor Rating" value={w.installMagneticContactorRatingA} suffix="A" labelWidth="54%" />
                  </div>
                </div>
                <div style={{ ...PAD_CELL, display: 'grid', gap: 3, paddingTop: 3, paddingBottom: 3 }}>
                  <PhaseLineRow
                    label="Insulation Resistance:"
                    slots={[
                      { val: w.afterInstallIrL1, unit: '(L1) MΩ' },
                      { val: w.afterInstallIrL2, unit: '(L2) MΩ' },
                      { val: w.afterInstallIrL3, unit: '(L3) MΩ' },
                    ]}
                  />
                  <PhaseLineRow
                    label="Current Reading:"
                    slots={[
                      { val: w.afterInstallCurrentL1, unit: '(L1) A' },
                      { val: w.afterInstallCurrentL2, unit: '(L2) A' },
                      { val: w.afterInstallCurrentL3, unit: '(L3) A' },
                    ]}
                  />
                  <PhaseLineRow
                    label="Voltage Reading:"
                    slots={[
                      { val: w.afterInstallVoltageL1, unit: '(L1) V' },
                      { val: w.afterInstallVoltageL2, unit: '(L2) V' },
                      { val: w.afterInstallVoltageL3, unit: '(L3) V' },
                    ]}
                  />
                </div>
              </div>

              {/* Section 5 Middle Column */}
              <div style={{ display: 'flex', flexDirection: 'column', fontSize: 8.2 }}>
                <div style={{ ...HDR_BAR, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Time:</span>
                  <span>{formatPulloutTimeDisplay(w.afterInstallTime) || '—'}</span>
                </div>
                <div style={{ ...PAD_CELL, flex: 1, borderBottom: B }}>
                  <div style={{ fontWeight: 700, marginBottom: 3 }}>Remarks:</div>
                  <div style={{ fontWeight: 700, textTransform: 'uppercase' }}>{w.afterInstallRemarks || ''}</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.65fr' }}>
                  <div style={{ ...PAD_CELL, borderRight: B, borderBottom: B }}>should not be &lt; 2 MΩ</div>
                  <div style={{ ...PAD_CELL, borderBottom: B, fontWeight: 800, textAlign: 'center' }}>
                    {w.acceptIrAbove2Meg || 'YES'}
                  </div>
                  <div style={{ ...PAD_CELL, borderRight: B, borderBottom: B }}>should not be + 14%</div>
                  <div style={{ ...PAD_CELL, borderBottom: B, fontWeight: 800, textAlign: 'center' }}>
                    {w.acceptCurrentWithin14Pct || 'YES'}
                  </div>
                  <div style={{ ...PAD_CELL, borderRight: B }}>should not be +/-10% of nominal 230V</div>
                  <div style={{ ...PAD_CELL, fontWeight: 800, textAlign: 'center' }}>
                    {w.acceptVoltageWithin10Pct || 'YES'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Strip: 1 to 34 */}
          <div style={{ borderLeft: TB, display: 'grid', gridTemplateRows: 'repeat(34, minmax(0, 1fr))' }}>
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
                <span style={{ borderRight: B, textAlign: 'center', fontWeight: 700, color: '#475569' }}>{num}</span>
                <span />
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Band: Section 6 & Section 7 Side-by-Side + Performed By & Certification */}
        <div style={{ borderTop: TB, display: 'grid', gridTemplateColumns: '1fr 1.25fr' }}>
          <div style={{ borderRight: TB }}>
            <div style={HDR_BAR}>6. Results of Operation</div>
            <div style={{ ...PAD_CELL, display: 'grid', gap: 3 }}>
              <UnderlinedRow
                label="Duration of Pull Out & Installation"
                value={w.operationDuration}
                uppercase
                labelWidth="46%"
              />
              <UnderlinedRow
                label="Reason of Pull Out & Installation"
                value={w.reasonOfPullout}
                uppercase
                labelWidth="46%"
              />
            </div>
          </div>
          <div>
            <div style={HDR_BAR}>7. Over All Remarks</div>
            <div style={{ ...PAD_CELL, fontWeight: 700, textTransform: 'uppercase', minHeight: 28 }}>
              {w.overallRemarks || activity.notes || '—'}
            </div>
          </div>
        </div>

        <div style={{ borderTop: B, display: 'grid', gridTemplateColumns: '1fr 1.25fr' }}>
          <div style={{ ...PAD_CELL, borderRight: TB, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 8.5, fontWeight: 700 }}>Performed By:</div>
            <div style={{ textAlign: 'center', paddingTop: 2 }}>
              <div style={{ minHeight: 16, fontWeight: 800, fontSize: 8.8, borderBottom: '1px solid #0f172a', paddingBottom: 1 }}>
                {signatureDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={signatureDataUrl}
                    alt="Contractor signature"
                    style={{ maxHeight: 22, maxWidth: '100%', objectFit: 'contain' }}
                  />
                ) : (
                  performedByDisplay
                )}
              </div>
              <div style={{ fontSize: 7.8, fontWeight: 700, marginTop: 1 }}>
                Contractor&apos;s Name / Signature / Date
              </div>
            </div>
          </div>
          <div style={{ ...PAD_CELL, fontSize: 8.2, lineHeight: 1.35, fontWeight: 600 }}>
            <div>This is to certify that preventive maintenance/check up/and or repair of the water facilities was done.</div>
            <div>Water facilities or equipment that has been pulled out and repaired was restored in good condition.</div>
            <div>Water supply has been restored.</div>
          </div>
        </div>
      </div>

      {/* Footer Notes & Checked / Noted Signatories */}
      <div style={{ fontSize: 8, color: '#334155', lineHeight: 1.3 }}>
        <div style={{ fontWeight: 800 }}>NOTES:</div>
        <div style={{ paddingLeft: 18 }}>
          <strong>Pls Write: OK</strong> - if Voltage and Current Reading is within acceptable range ·{' '}
          <strong>Not Ok</strong> - if Reading is NOT within acceptable range
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 36,
          marginTop: 2,
          fontSize: 8.8,
          textAlign: 'center',
        }}
      >
        <div>
          <div style={{ textAlign: 'left', fontWeight: 700 }}>Checked By:</div>
          <div style={{ height: 18, borderBottom: '1px solid #0f172a', fontWeight: 800, display: 'grid', placeItems: 'end center' }}>
            {w.checkedByCoordinator}
          </div>
          <div style={{ fontSize: 8.2, fontWeight: 700, marginTop: 2 }}>Site Coordinator / Electrician</div>
        </div>
        <div>
          <div style={{ textAlign: 'left', fontWeight: 700 }}>Noted By:</div>
          <div style={{ height: 18, borderBottom: '1px solid #0f172a', fontWeight: 800, display: 'grid', placeItems: 'end center' }}>
            {w.notedByEngineer}
          </div>
          <div style={{ fontSize: 8.2, fontWeight: 700, marginTop: 2 }}>Electromechanical Engineer / Technical Head</div>
        </div>
      </div>
    </div>
  );
}
