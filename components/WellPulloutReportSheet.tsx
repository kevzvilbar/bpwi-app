'use client';

import type { DailyActivityRow } from '@/lib/activity-types';
import { hydrateWellPulloutDetails } from '@/lib/well-pullout-types';

interface WellPulloutReportSheetProps {
  activity: DailyActivityRow;
  orgName: string;
  areaLabel: string;
  leadOpName: string;
}

const BORDER = '1px solid #1e293b';
const THICK_BORDER = '1.5px solid #0f172a';

const SECTION_HDR: React.CSSProperties = {
  background: '#e2e8f0',
  color: '#0f172a',
  fontWeight: 800,
  fontSize: 9.5,
  padding: '3px 6px',
  borderTop: THICK_BORDER,
  borderBottom: BORDER,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
};

const CELL: React.CSSProperties = {
  borderBottom: BORDER,
  borderRight: BORDER,
  padding: '2px 5px',
  fontSize: 9.5,
  lineHeight: 1.25,
  color: '#0f172a',
};

const LBL: React.CSSProperties = {
  color: '#334155',
  fontWeight: 600,
  marginRight: 4,
};

const VAL: React.CSSProperties = {
  fontWeight: 700,
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
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(yearNum, monthIdx, 1)),
  );
  return { month: monthName, year: String(yearNum) };
}

function StatusBox({ checked, label }: { checked: boolean; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginRight: 8, fontSize: 9 }}>
      <span
        style={{
          display: 'inline-block',
          width: 10,
          height: 10,
          border: '1px solid #0f172a',
          textAlign: 'center',
          lineHeight: '9px',
          fontWeight: 800,
          fontSize: 8.5,
        }}
      >
        {checked ? '✓' : ''}
      </span>
      {label}
    </span>
  );
}

function FieldPair({ label, value }: { label: string; value: string }) {
  return (
    <div style={CELL}>
      <span style={LBL}>{label}:</span>
      <span style={VAL}>{value || '—'}</span>
    </div>
  );
}

function PhaseTriplet({
  label,
  tags,
  vals,
}: {
  label: string;
  tags: readonly [string, string, string];
  vals: readonly [string, string, string];
}) {
  return (
    <div style={{ ...CELL, display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: 4 }}>
      <span style={LBL}>{label}</span>
      {tags.map((t, i) => (
        <span key={t}>
          <span style={{ color: '#475569', fontSize: 8.5 }}>{t}: </span>
          <span style={VAL}>{vals[i] || '—'}</span>
        </span>
      ))}
    </div>
  );
}

export default function WellPulloutReportSheet({
  activity,
  orgName,
  areaLabel,
  leadOpName,
}: WellPulloutReportSheetProps) {
  const w = hydrateWellPulloutDetails(activity.details ?? {});
  const derivedMY = deriveMonthYear(activity.activity_date);
  const station = w.projectPumpStation || activity.site_or_well || areaLabel || 'N/A';
  const month = w.reportMonth || derivedMY.month;
  const year = w.reportYear || derivedMY.year;
  const signatureDataUrl =
    typeof activity.details?.signatureDataUrl === 'string' ? activity.details.signatureDataUrl : '';

  const irRows = Array.from({ length: 34 }, (_, idx) => idx + 1);

  return (
    <div style={{ display: 'grid', gap: 6, color: '#0f172a', fontFamily: 'Arial, sans-serif' }}>
      {/* Dual Branding Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          paddingBottom: 4,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: '2px solid #0284c7',
              display: 'grid',
              placeItems: 'center',
              fontSize: 10,
              fontWeight: 900,
              color: '#0369a1',
            }}
          >
            GW
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#0f172a', letterSpacing: '0.02em' }}>
              Goodhands Water Specialists
            </div>
            <div style={{ fontSize: 8.5, color: '#475569' }}>Electromechanical &amp; Deepwell Services</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, textAlign: 'right' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#0f172a' }}>
              {orgName || 'BP Waterworks Inc.'}
            </div>
            <div style={{ fontSize: 8.5, color: '#475569' }}>
              Ref: ACT-{activity.id.slice(0, 8).toUpperCase()}
            </div>
          </div>
          <img
            src="/bpwi-logo.png"
            alt="BP Waterworks Inc."
            style={{ width: 42, height: 32, objectFit: 'contain' }}
          />
        </div>
      </div>

      {/* Main Boxed Form Grid + Right-hand IR 1-34 Column */}
      <div style={{ border: THICK_BORDER }}>
        <div
          style={{
            background: '#0f172a',
            color: '#ffffff',
            textAlign: 'center',
            fontWeight: 800,
            fontSize: 11.5,
            letterSpacing: '0.04em',
            padding: '4px 8px',
          }}
        >
          PULL OUT AND INSTALLATION ACCOMPLISHMENT REPORT FORM FOR DEEPWELL
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 108px' }}>
          {/* Left Main Column */}
          <div>
            {/* Project Row */}
            <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1fr 0.8fr' }}>
              <FieldPair label="Project - Pump Station" value={station} />
              <FieldPair label="Month" value={month} />
              <FieldPair label="Year" value={year} />
            </div>

            {/* Section 1 */}
            <div style={SECTION_HDR}>
              <span>1. TO BE FILLED UP BY CONTRACTOR / SITE COORDINATOR</span>
              <span style={{ fontWeight: 600 }}>{w.contractorCoordinator}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              <FieldPair label="Time Reported to Electromech. Eng." value={w.timeReportedToEngineer} />
              <FieldPair label="Arrival Time at Site" value={w.arrivalTimeAtSite} />
              <FieldPair label="Time of Set-up" value={w.timeOfSetUp} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              <FieldPair
                label="Date and Time Started"
                value={[w.dateStarted, w.timeStarted].filter(Boolean).join(' @ ')}
              />
              <FieldPair
                label="Date and Time Finished"
                value={[w.dateFinished, w.timeFinished].filter(Boolean).join(' @ ')}
              />
            </div>

            {/* Section 2 */}
            <div style={SECTION_HDR}>
              <span>2. BEFORE PULL OUT OF PUMP AND MOTOR</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1fr' }}>
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                  <FieldPair label="Flowrate (lps)" value={w.beforePulloutFlowrateLps} />
                  <FieldPair label="Discharge Line Pressure (psi)" value={w.beforePulloutPressurePsi} />
                </div>
                <PhaseTriplet
                  label="Insulation Resistance (mΩ)"
                  tags={['L1-L2', 'L1-L3', 'L2-L3']}
                  vals={[w.beforePulloutIrL1, w.beforePulloutIrL2, w.beforePulloutIrL3]}
                />
                <PhaseTriplet
                  label="Current Reading (A)"
                  tags={['L1', 'L2', 'L3']}
                  vals={[w.beforePulloutCurrentL1, w.beforePulloutCurrentL2, w.beforePulloutCurrentL3]}
                />
                <PhaseTriplet
                  label="Voltage Reading (V)"
                  tags={['L1-L2', 'L1-L3', 'L2-L3']}
                  vals={[w.beforePulloutVoltageL1, w.beforePulloutVoltageL2, w.beforePulloutVoltageL3]}
                />
              </div>
              <div style={{ ...CELL, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={LBL}>Remarks:</div>
                  <div style={{ ...VAL, marginTop: 2 }}>{w.beforePulloutRemarks || '—'}</div>
                </div>
              </div>
            </div>

            {/* Section 3 */}
            <div style={SECTION_HDR}>
              <span>3. AFTER PULL OUT OF PUMP AND MOTOR</span>
              <span>Time: {w.afterPulloutTime || '—'}</span>
            </div>
            <FieldPair label="Remarks" value={w.afterPulloutRemarks} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <div style={{ ...CELL, background: '#f8fafc', fontWeight: 800, fontSize: 9 }}>PUMP DETAILS</div>
              <div style={{ ...CELL, background: '#f8fafc', fontWeight: 800, fontSize: 9 }}>MOTOR DETAILS</div>
              <FieldPair label="Brand" value={w.pulledPumpBrand} />
              <FieldPair label="Brand" value={w.pulledMotorBrand} />
              <FieldPair label="Model" value={w.pulledPumpModel} />
              <FieldPair label="HP / Volt / Phase" value={w.pulledMotorHpVoltPhase} />
              <FieldPair label="Stock No." value={w.pulledPumpStockNo} />
              <FieldPair label="Serial No." value={w.pulledMotorSerialNo} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <div style={{ ...CELL, background: '#f8fafc', fontWeight: 800, fontSize: 9 }}>DEEPWELL DETAILS</div>
              <div style={{ ...CELL, background: '#f8fafc', fontWeight: 800, fontSize: 9 }}>MOTOR CONTROL DETAILS</div>
              <FieldPair
                label="Riser Pipe Size / Material"
                value={[
                  w.pulledRiserPipeSizeMm ? `${w.pulledRiserPipeSizeMm}mm` : '',
                  w.pulledRiserPipeMaterial,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
              <FieldPair
                label="Submersible Cable Size / Length"
                value={[
                  w.pulledCableSizeMm2 ? `${w.pulledCableSizeMm2} mm²` : '',
                  w.pulledCableLengthM ? `${w.pulledCableLengthM} m` : '',
                ]
                  .filter(Boolean)
                  .join(' / ')}
              />
              <FieldPair
                label="No. of Riser Pipes / Casing Dia."
                value={[
                  w.pulledRiserPipeCount ? `${w.pulledRiserPipeCount} pcs` : '',
                  w.wellCasingDiameterMm ? `${w.wellCasingDiameterMm}mm casing` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
              <FieldPair label="# of Splicing" value={w.pulledCableSplicingCount} />
              <FieldPair
                label="Well Depth / Pump Setting"
                value={[
                  w.wellDepthM ? `Depth ${w.wellDepthM}m` : '',
                  w.pumpSettingM ? `Setting ${w.pumpSettingM}m` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
              <FieldPair
                label="Overload Relay Range / Setting"
                value={[w.pulledOverloadRelayRangeA, w.pulledOverloadRelaySettingA]
                  .filter(Boolean)
                  .map((v) => `${v}A`)
                  .join(' / ')}
              />
              <FieldPair
                label="SWL / PWL / Control"
                value={[
                  w.swlMeters ? `SWL ${w.swlMeters}m` : '',
                  w.pwlMeters ? `PWL ${w.pwlMeters}m` : '',
                  w.motorControlType,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
              <FieldPair
                label="Magnetic Contactor Rating"
                value={w.pulledMagneticContactorRatingA ? `${w.pulledMagneticContactorRatingA} A` : ''}
              />
            </div>

            {/* Section 4 */}
            <div style={SECTION_HDR}>
              <span>4. BEFORE INSTALLATION PUMP AND MOTOR</span>
              <span>Time: {w.beforeInstallTime || '—'}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2.5fr 1fr' }}>
              <div style={{ ...CELL, background: '#f8fafc', fontWeight: 700, fontSize: 9 }}>
                Acceptance Criteria
              </div>
              <div style={{ ...CELL, background: '#f8fafc', fontWeight: 700, fontSize: 9 }}>
                Remarks
              </div>
              <div style={CELL}>Ensure no loose thread of couplings and adapters</div>
              <div style={{ ...CELL, fontWeight: 700 }}>{w.checkNoLooseThread || 'NONE'}</div>
              <div style={CELL}>No visible physical damage or corrosion on the pipes</div>
              <div style={{ ...CELL, fontWeight: 700 }}>{w.checkNoVisibleCorrosion || 'NONE'}</div>
              <div style={CELL}>Ensure the electrode are not 0 meg (megger testing)</div>
              <div style={{ ...CELL, fontWeight: 700 }}>{w.checkElectrodeNotZeroMeg || 'YES'}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <div style={{ ...CELL, background: '#f8fafc', fontWeight: 800, fontSize: 9 }}>PUMP DETAILS</div>
              <div style={{ ...CELL, background: '#f8fafc', fontWeight: 800, fontSize: 9 }}>MOTOR DETAILS</div>
              <FieldPair label="Brand" value={w.installPumpBrand} />
              <FieldPair label="Brand" value={w.installMotorBrand} />
              <FieldPair label="Model" value={w.installPumpModel} />
              <FieldPair label="HP / Volt / Phase" value={w.installMotorHpVoltPhase} />
              <FieldPair label="Control No." value={w.installPumpControlNo} />
              <FieldPair label="Serial No." value={w.installMotorSerialNo} />
              <div style={CELL}>
                <StatusBox checked={w.installPumpStatus === 'Brand New'} label="Brand New" />
                <StatusBox checked={w.installPumpStatus === 'Repaired'} label="Repaired" />
              </div>
              <div style={CELL}>
                <StatusBox checked={w.installMotorStatus === 'Brand New'} label="Brand New" />
                <StatusBox checked={w.installMotorStatus === 'Repaired'} label="Repaired" />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1fr' }}>
              <PhaseTriplet
                label="IR of Motor (before splicing) ≥ 100 MΩ"
                tags={['L1-L2', 'L1-L3', 'L2-L3']}
                vals={[w.motorIrBeforeSpliceL1, w.motorIrBeforeSpliceL2, w.motorIrBeforeSpliceL3]}
              />
              <FieldPair label="Remarks" value={w.beforeSpliceRemarks} />
              <PhaseTriplet
                label="IR (Cable & Motor Spliced) ≥ 2 MΩ"
                tags={['L1-L2', 'L1-L3', 'L2-L3']}
                vals={[w.splicedIrL1, w.splicedIrL2, w.splicedIrL3]}
              />
              <FieldPair label="Remarks" value={w.afterSpliceRemarks} />
            </div>
            <PhaseTriplet
              label="No Load Current Reading (A)"
              tags={['L1', 'L2', 'L3']}
              vals={[w.noLoadCurrentL1, w.noLoadCurrentL2, w.noLoadCurrentL3]}
            />

            {/* Section 5 */}
            <div style={SECTION_HDR}>
              <span>5. AFTER INSTALLATION</span>
              <span>Time: {w.afterInstallTime || '—'}</span>
            </div>
            <FieldPair label="Remarks" value={w.afterInstallRemarks} />
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr' }}>
              <div>
                <div style={{ ...CELL, background: '#f8fafc', fontWeight: 800, fontSize: 9 }}>
                  DEEPWELL &amp; MOTOR CONTROL DETAILS
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                  <FieldPair
                    label="Riser Pipe Size / Pcs"
                    value={[
                      w.installRiserPipeSizeMm ? `${w.installRiserPipeSizeMm}mm` : '',
                      w.installRiserPipeCount ? `${w.installRiserPipeCount} pcs` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                  <FieldPair
                    label="Sounding Pipe Length"
                    value={w.soundingPipeLengthM ? `${w.soundingPipeLengthM} m` : ''}
                  />
                  <FieldPair label="Flowrate (lps)" value={w.afterInstallFlowrateLps} />
                  <FieldPair label="Discharge Pressure (psi)" value={w.afterInstallPressurePsi} />
                </div>
                <PhaseTriplet
                  label="Insulation Resistance (MΩ)"
                  tags={['L1-L2', 'L1-L3', 'L2-L3']}
                  vals={[w.afterInstallIrL1, w.afterInstallIrL2, w.afterInstallIrL3]}
                />
                <PhaseTriplet
                  label="Current Reading (A)"
                  tags={['L1', 'L2', 'L3']}
                  vals={[w.afterInstallCurrentL1, w.afterInstallCurrentL2, w.afterInstallCurrentL3]}
                />
                <PhaseTriplet
                  label="Voltage Reading (V)"
                  tags={['L1-L2', 'L1-L3', 'L2-L3']}
                  vals={[w.afterInstallVoltageL1, w.afterInstallVoltageL2, w.afterInstallVoltageL3]}
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                  <FieldPair
                    label="Cable Size / Length"
                    value={[
                      w.installCableSizeMm2 ? `${w.installCableSizeMm2} mm²` : '',
                      w.installCableLengthM ? `${w.installCableLengthM} m` : '',
                    ]
                      .filter(Boolean)
                      .join(' / ')}
                  />
                  <FieldPair label="# of Splicing" value={w.installCableSplicingCount} />
                  <FieldPair
                    label="Overload Relay Range / Setting"
                    value={[w.installOverloadRelayRangeA, w.installOverloadRelaySettingA]
                      .filter(Boolean)
                      .map((v) => `${v}A`)
                      .join(' / ')}
                  />
                  <FieldPair
                    label="Magnetic Contactor Rating"
                    value={w.installMagneticContactorRatingA ? `${w.installMagneticContactorRatingA} A` : ''}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ ...CELL, background: '#f8fafc', fontWeight: 800, fontSize: 9 }}>
                  Acceptance Criteria &amp; Remarks
                </div>
                <div style={{ ...CELL, flex: 1, display: 'grid', alignContent: 'start', gap: 4 }}>
                  <div>
                    <span>Ensure that the Insulation resistance is above 2 MΩ: </span>
                    <strong>{w.acceptIrAbove2Meg || 'YES'}</strong>
                  </div>
                  <div>
                    <span>Current unbalance must not exceed 14% of the rated FLA: </span>
                    <strong>{w.acceptCurrentWithin14Pct || 'YES'}</strong>
                  </div>
                  <div>
                    <span>Voltage variation must be within ±10% of the rated voltage: </span>
                    <strong>{w.acceptVoltageWithin10Pct || 'YES'}</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Section 6 & 7 */}
            <div style={SECTION_HDR}>
              <span>6. RESULTS OF OPERATION</span>
              <span>Duration: {w.operationDuration || '—'}</span>
            </div>
            <FieldPair label="Reason of pull-out" value={w.reasonOfPullout} />
            <div style={SECTION_HDR}>
              <span>7. OVER ALL REMARKS</span>
            </div>
            <div style={{ ...CELL, minHeight: 22, fontWeight: 700 }}>{w.overallRemarks || '—'}</div>
          </div>

          {/* Right Side Column: INSULATION RESISTANCE READING (meg Ω) rows 1-34 */}
          <div style={{ borderLeft: THICK_BORDER, display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                background: '#e2e8f0',
                fontWeight: 800,
                fontSize: 8.5,
                textAlign: 'center',
                padding: '4px 3px',
                borderBottom: BORDER,
                lineHeight: 1.2,
              }}
            >
              INSULATION RESISTANCE READING (meg Ω)
            </div>
            <div style={{ flex: 1, display: 'grid', gridTemplateRows: 'repeat(34, minmax(0, 1fr))' }}>
              {irRows.map((num) => (
                <div
                  key={num}
                  style={{
                    borderBottom: num === 34 ? 'none' : BORDER,
                    display: 'grid',
                    gridTemplateColumns: '22px 1fr',
                    alignItems: 'center',
                    fontSize: 8,
                  }}
                >
                  <span
                    style={{
                      borderRight: BORDER,
                      textAlign: 'center',
                      fontWeight: 700,
                      color: '#475569',
                      padding: '0 2px',
                    }}
                  >
                    {num}
                  </span>
                  <span />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Certification & Signatories */}
      <div style={{ border: BORDER, padding: '4px 8px', fontSize: 9, background: '#f8fafc', textAlign: 'center' }}>
        We certify that the works involved as checked and listed above were completed in accordance with the
        specifications and established standard procedures.
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 18,
          marginTop: 4,
          textAlign: 'center',
          fontSize: 9.5,
        }}
      >
        <div>
          <div style={{ fontSize: 9, textAlign: 'left', color: '#475569' }}>Performed by:</div>
          <div
            style={{
              height: 34,
              borderBottom: '1px solid #0f172a',
              display: 'grid',
              placeItems: 'end center',
              fontWeight: 700,
              overflow: 'hidden',
            }}
          >
            {signatureDataUrl ? (
              <img
                src={signatureDataUrl}
                alt="Contractor signature"
                style={{ maxHeight: 30, maxWidth: '100%', objectFit: 'contain' }}
              />
            ) : (
              w.performedByContractor || leadOpName || ''
            )}
          </div>
          <div style={{ fontWeight: 700, fontSize: 9, marginTop: 2 }}>Contractor</div>
        </div>
        <div>
          <div style={{ fontSize: 9, textAlign: 'left', color: '#475569' }}>Checked by:</div>
          <div
            style={{
              height: 34,
              borderBottom: '1px solid #0f172a',
              display: 'grid',
              placeItems: 'end center',
              fontWeight: 700,
            }}
          >
            {w.checkedByCoordinator}
          </div>
          <div style={{ fontWeight: 700, fontSize: 9, marginTop: 2 }}>Site Coordinator / Electrician</div>
        </div>
        <div>
          <div style={{ fontSize: 9, textAlign: 'left', color: '#475569' }}>Noted by:</div>
          <div
            style={{
              height: 34,
              borderBottom: '1px solid #0f172a',
              display: 'grid',
              placeItems: 'end center',
              fontWeight: 700,
            }}
          >
            {w.notedByEngineer}
          </div>
          <div style={{ fontWeight: 700, fontSize: 9, marginTop: 2 }}>
            Electromechanical Engineer / Technical Head
          </div>
        </div>
      </div>
    </div>
  );
}
