'use client';

import type { WellPulloutEquipmentStatus, WellPulloutFormDetails } from '@/lib/well-pullout-types';

interface WellPulloutFieldsProps {
  value: WellPulloutFormDetails;
  onChange: (next: WellPulloutFormDetails) => void;
}

type StringFieldKey = Exclude<keyof WellPulloutFormDetails, 'installPumpStatus' | 'installMotorStatus'>;

interface FieldDef {
  key: StringFieldKey;
  label: string;
  placeholder?: string;
}

const SECTION_STYLE: React.CSSProperties = {
  padding: 10,
  display: 'grid',
  gap: 8,
  background: 'var(--bg-surface)',
  borderColor: 'var(--border-subtle)',
};

const SUBHEADER_STYLE: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  color: 'var(--text-secondary)',
  borderTop: '1px solid var(--border-subtle)',
  paddingTop: 6,
};

const LABEL_STYLE: React.CSSProperties = {
  display: 'grid',
  gap: 3,
  fontSize: 11.5,
  color: 'var(--text-secondary)',
};

const GRID_3_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 8,
};

export default function WellPulloutFields({ value, onChange }: WellPulloutFieldsProps) {
  const setField = <K extends keyof WellPulloutFormDetails>(
    key: K,
    nextVal: WellPulloutFormDetails[K],
  ) => onChange({ ...value, [key]: nextVal });

  const renderInputs = (defs: readonly FieldDef[]) =>
    defs.map(({ key, label, placeholder }) => (
      <label key={key} style={LABEL_STYLE}>
        {label}
        <input
          className="input"
          value={value[key]}
          placeholder={placeholder}
          onChange={(e) => setField(key, e.target.value)}
        />
      </label>
    ));

  const renderTriplet = (
    title: string,
    keys: readonly [StringFieldKey, StringFieldKey, StringFieldKey],
    labels: readonly [string, string, string],
    placeholders?: readonly [string, string, string],
  ) => (
    <div style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
        {keys.map((k, idx) => (
          <label key={k} style={LABEL_STYLE}>
            {labels[idx]}
            <input
              className="input"
              value={value[k]}
              placeholder={placeholders?.[idx]}
              onChange={(e) => setField(k, e.target.value)}
            />
          </label>
        ))}
      </div>
    </div>
  );

  const renderEquipStatus = (
    label: string,
    key: 'installPumpStatus' | 'installMotorStatus',
  ) => (
    <label style={LABEL_STYLE}>
      {label}
      <select
        className="input"
        value={value[key]}
        onChange={(e) => setField(key, e.target.value as WellPulloutEquipmentStatus)}
      >
        <option value="">-- Select Status --</option>
        <option value="Brand New">Brand New</option>
        <option value="Repaired">Repaired</option>
      </select>
    </label>
  );

  const copyPulledColumnSpecs = () => {
    onChange({
      ...value,
      installRiserPipeSizeMm: value.pulledRiserPipeSizeMm || value.installRiserPipeSizeMm,
      installRiserPipeCount: value.pulledRiserPipeCount || value.installRiserPipeCount,
      installCableSizeMm2: value.pulledCableSizeMm2 || value.installCableSizeMm2,
      installCableLengthM: value.pulledCableLengthM || value.installCableLengthM,
      installCableSplicingCount: value.pulledCableSplicingCount || value.installCableSplicingCount,
      installOverloadRelayRangeA: value.pulledOverloadRelayRangeA || value.installOverloadRelayRangeA,
      installOverloadRelaySettingA: value.pulledOverloadRelaySettingA || value.installOverloadRelaySettingA,
      installMagneticContactorRatingA:
        value.pulledMagneticContactorRatingA || value.installMagneticContactorRatingA,
    });
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {/* Header / Station Override */}
      <div className="card" style={{ ...SECTION_STYLE, borderColor: 'var(--accent)' }}>
        <strong style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>
          Deepwell Pull-Out &amp; Installation Accomplishment Report Form
        </strong>
        <div style={GRID_3_STYLE}>
          {renderInputs([
            { key: 'projectPumpStation', label: 'Project / Pump Station (optional override)', placeholder: 'e.g. STA. BARBARA WELL 2' },
            { key: 'reportMonth', label: 'Month', placeholder: 'e.g. July' },
            { key: 'reportYear', label: 'Year', placeholder: 'e.g. 2026' },
          ])}
        </div>
      </div>

      {/* Section 1 */}
      <div className="card" style={SECTION_STYLE}>
        <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>
          1. To Be Filled Up By Contractor / Site Coordinator
        </strong>
        <div style={GRID_3_STYLE}>
          {renderInputs([
            { key: 'contractorCoordinator', label: 'Contractor / Coordinator', placeholder: 'Operations/Technical Team' },
            { key: 'timeReportedToEngineer', label: 'Time Reported to Electromech. Eng.', placeholder: 'e.g. 0800H' },
            { key: 'arrivalTimeAtSite', label: 'Arrival Time at Site', placeholder: 'e.g. 0930H' },
            { key: 'timeOfSetUp', label: 'Time of Set-up', placeholder: 'e.g. 1030H' },
            { key: 'dateStarted', label: 'Date Started', placeholder: 'e.g. Jul 28, 2026' },
            { key: 'timeStarted', label: 'Time Started', placeholder: 'e.g. 1300H' },
            { key: 'dateFinished', label: 'Date Finished', placeholder: 'e.g. Jul 29, 2026' },
            { key: 'timeFinished', label: 'Time Finished', placeholder: 'e.g. 0100H' },
          ])}
        </div>
      </div>

      {/* Section 2 */}
      <div className="card" style={SECTION_STYLE}>
        <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>
          2. Before Pull Out of Pump and Motor
        </strong>
        <div style={GRID_3_STYLE}>
          {renderInputs([
            { key: 'beforePulloutFlowrateLps', label: 'Flowrate (lps)', placeholder: 'e.g. 6.5' },
            { key: 'beforePulloutPressurePsi', label: 'Discharge Line Pressure (psi)', placeholder: 'e.g. 28' },
          ])}
        </div>
        {renderTriplet(
          'Insulation Resistance (mΩ)',
          ['beforePulloutIrL1', 'beforePulloutIrL2', 'beforePulloutIrL3'],
          ['L1-L2', 'L1-L3', 'L2-L3'],
          ['0.036', '0.038', '0.037'],
        )}
        {renderTriplet(
          'Current Reading (A)',
          ['beforePulloutCurrentL1', 'beforePulloutCurrentL2', 'beforePulloutCurrentL3'],
          ['L1', 'L2', 'L3'],
          ['28', '28', '28'],
        )}
        {renderTriplet(
          'Voltage Reading (V)',
          ['beforePulloutVoltageL1', 'beforePulloutVoltageL2', 'beforePulloutVoltageL3'],
          ['L1-L2', 'L1-L3', 'L2-L3'],
          ['232', '233', '231'],
        )}
        {renderInputs([{ key: 'beforePulloutRemarks', label: 'Before Pull-Out Remarks', placeholder: 'Notes before pull-out' }])}
      </div>

      {/* Section 3 */}
      <div className="card" style={SECTION_STYLE}>
        <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>
          3. After Pull Out of Pump and Motor
        </strong>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
          {renderInputs([
            { key: 'afterPulloutTime', label: 'Time', placeholder: 'e.g. 0245H' },
            { key: 'afterPulloutRemarks', label: 'Remarks', placeholder: 'e.g. MOTOR IN GOOD CONDITION. PUMP FOR REPLACEMENT.' },
          ])}
        </div>
        <div style={SUBHEADER_STYLE}>Pulled Pump &amp; Motor Details</div>
        <div style={GRID_3_STYLE}>
          {renderInputs([
            { key: 'pulledPumpBrand', label: 'Pump Brand', placeholder: 'SHAKTI INDIA' },
            { key: 'pulledPumpModel', label: 'Pump Model', placeholder: 'DP 17-8' },
            { key: 'pulledPumpStockNo', label: 'Pump Stock No.', placeholder: 'Stock #' },
            { key: 'pulledMotorBrand', label: 'Motor Brand', placeholder: 'FRANKLIN MOTORS ELECTRIC' },
            { key: 'pulledMotorHpVoltPhase', label: 'HP / Voltage / Phase', placeholder: '10/230/3' },
            { key: 'pulledMotorSerialNo', label: 'Motor Serial No.', placeholder: 'Serial #' },
          ])}
        </div>
        <div style={SUBHEADER_STYLE}>Deepwell Details</div>
        <div style={GRID_3_STYLE}>
          {renderInputs([
            { key: 'pulledRiserPipeSizeMm', label: 'Riser Pipe Size (mm)', placeholder: '80' },
            { key: 'pulledRiserPipeMaterial', label: 'Riser Pipe Material', placeholder: 'Galvanized Iron' },
            { key: 'pulledRiserPipeCount', label: 'No. of Riser Pipes', placeholder: '12' },
            { key: 'wellCasingDiameterMm', label: 'Well Casing Dia. (mm)', placeholder: '254' },
            { key: 'wellDepthM', label: 'Well Depth (m)', placeholder: 'Depth (m)' },
            { key: 'pumpSettingM', label: 'Pump Setting (m)', placeholder: '73' },
            { key: 'swlMeters', label: 'Static Water Level (m)', placeholder: '35' },
            { key: 'pwlMeters', label: 'Pumping Water Level (m)', placeholder: '69' },
            { key: 'motorControlType', label: 'Motor Control Type', placeholder: 'VFD' },
          ])}
        </div>
        <div style={SUBHEADER_STYLE}>Motor Control Details (Pulled)</div>
        <div style={GRID_3_STYLE}>
          {renderInputs([
            { key: 'pulledCableSizeMm2', label: 'Submersible Cable Size (mm²)', placeholder: '5.26' },
            { key: 'pulledCableLengthM', label: 'Cable Length (m)', placeholder: '76' },
            { key: 'pulledCableSplicingCount', label: '# of Splicing', placeholder: 'e.g. 1' },
            { key: 'pulledOverloadRelayRangeA', label: 'Overload Relay Range (A)', placeholder: 'e.g. 24-36' },
            { key: 'pulledOverloadRelaySettingA', label: 'Overload Relay Setting (A)', placeholder: 'e.g. 30' },
            { key: 'pulledMagneticContactorRatingA', label: 'Magnetic Contactor Rating (A)', placeholder: 'e.g. 50' },
          ])}
        </div>
      </div>

      {/* Section 4 */}
      <div className="card" style={SECTION_STYLE}>
        <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>
          4. Before Installation Pump and Motor
        </strong>
        <div style={GRID_3_STYLE}>
          {renderInputs([
            { key: 'beforeInstallTime', label: 'Time', placeholder: 'e.g. 0445H' },
            { key: 'checkNoLooseThread', label: 'Loose Threads on Couplings/Adapters?', placeholder: 'NONE' },
            { key: 'checkNoVisibleCorrosion', label: 'Visible Damage / Corrosion on Pipes?', placeholder: 'NONE' },
            { key: 'checkElectrodeNotZeroMeg', label: 'Electrode Not 0 MΩ (Megger Test)?', placeholder: 'YES' },
          ])}
        </div>
        <div style={SUBHEADER_STYLE}>Installed Pump &amp; Motor Details</div>
        <div style={GRID_3_STYLE}>
          {renderInputs([
            { key: 'installPumpBrand', label: 'Pump Brand', placeholder: 'DYNAFLOW' },
            { key: 'installPumpModel', label: 'Pump Model', placeholder: 'DP17-8' },
            { key: 'installPumpControlNo', label: 'Pump Control No.', placeholder: 'Control #' },
          ])}
          {renderEquipStatus('Pump Status', 'installPumpStatus')}
          {renderInputs([
            { key: 'installMotorBrand', label: 'Motor Brand', placeholder: 'FRANKLIN MOTORS' },
            { key: 'installMotorHpVoltPhase', label: 'HP / Voltage / Phase', placeholder: '10/230/3' },
            { key: 'installMotorSerialNo', label: 'Motor Serial No.', placeholder: 'Serial #' },
          ])}
          {renderEquipStatus('Motor Status', 'installMotorStatus')}
        </div>
        {renderTriplet(
          'Insulation Resistance of Motor (Before Splicing, ≥ 100 MΩ)',
          ['motorIrBeforeSpliceL1', 'motorIrBeforeSpliceL2', 'motorIrBeforeSpliceL3'],
          ['L1-L2', 'L1-L3', 'L2-L3'],
        )}
        {renderInputs([{ key: 'beforeSpliceRemarks', label: 'Remarks (Before Splicing)', placeholder: 'Notes' }])}
        {renderTriplet(
          'Insulation Resistance (Submersible Cable & Motor Spliced, ≥ 2 MΩ)',
          ['splicedIrL1', 'splicedIrL2', 'splicedIrL3'],
          ['L1-L2', 'L1-L3', 'L2-L3'],
          ['30.63', '30.13', '31.66'],
        )}
        {renderInputs([{ key: 'afterSpliceRemarks', label: 'Remarks (After Splicing)', placeholder: 'Notes' }])}
        {renderTriplet(
          'No Load Current Reading (A)',
          ['noLoadCurrentL1', 'noLoadCurrentL2', 'noLoadCurrentL3'],
          ['L1', 'L2', 'L3'],
        )}
      </div>

      {/* Section 5 */}
      <div className="card" style={SECTION_STYLE}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>5. After Installation</strong>
          <button
            type="button"
            className="btn"
            style={{ fontSize: 11, padding: '4px 8px' }}
            onClick={copyPulledColumnSpecs}
          >
            Copy Pipe &amp; Cable Specs from Section 3 → Section 5
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
          {renderInputs([
            { key: 'afterInstallTime', label: 'Time', placeholder: 'e.g. 0830H' },
            { key: 'afterInstallRemarks', label: 'Remarks', placeholder: 'e.g. ALL GOOD. NO LEAKS AFTER ACTIVITY COMPLETION.' },
          ])}
        </div>
        <div style={SUBHEADER_STYLE}>Deepwell Details &amp; Readings</div>
        <div style={GRID_3_STYLE}>
          {renderInputs([
            { key: 'installRiserPipeSizeMm', label: 'Riser Pipe Size (mm)', placeholder: '80' },
            { key: 'installRiserPipeCount', label: 'No. of Riser Pipes', placeholder: '12' },
            { key: 'soundingPipeLengthM', label: 'Sounding Pipe Length (m)', placeholder: '72' },
            { key: 'afterInstallFlowrateLps', label: 'Flowrate (lps)', placeholder: 'e.g. 7.2' },
            { key: 'afterInstallPressurePsi', label: 'Discharge Line Pressure (psi)', placeholder: '28' },
          ])}
        </div>
        {renderTriplet(
          'Insulation Resistance (MΩ)',
          ['afterInstallIrL1', 'afterInstallIrL2', 'afterInstallIrL3'],
          ['L1-L2', 'L1-L3', 'L2-L3'],
          ['29.5', '30.1', '32.33'],
        )}
        {renderTriplet(
          'Current Reading (A)',
          ['afterInstallCurrentL1', 'afterInstallCurrentL2', 'afterInstallCurrentL3'],
          ['L1', 'L2', 'L3'],
          ['28', '27', '28'],
        )}
        {renderTriplet(
          'Voltage Reading (V)',
          ['afterInstallVoltageL1', 'afterInstallVoltageL2', 'afterInstallVoltageL3'],
          ['L1-L2', 'L1-L3', 'L2-L3'],
          ['231', '233', '235'],
        )}
        <div style={SUBHEADER_STYLE}>Motor Control Details &amp; Acceptance Criteria</div>
        <div style={GRID_3_STYLE}>
          {renderInputs([
            { key: 'installCableSizeMm2', label: 'Submersible Cable Size (mm²)', placeholder: '5.26' },
            { key: 'installCableLengthM', label: 'Cable Length (m)', placeholder: '75' },
            { key: 'installCableSplicingCount', label: '# of Splicing', placeholder: '1' },
            { key: 'installOverloadRelayRangeA', label: 'Overload Relay Range (A)', placeholder: '24-36' },
            { key: 'installOverloadRelaySettingA', label: 'Overload Relay Setting (A)', placeholder: '30' },
            { key: 'installMagneticContactorRatingA', label: 'Magnetic Contactor Rating (A)', placeholder: '50' },
            { key: 'acceptIrAbove2Meg', label: 'IR > 2 MΩ?', placeholder: 'YES' },
            { key: 'acceptCurrentWithin14Pct', label: 'Current Unbalance ≤ 14% FLA?', placeholder: 'YES' },
            { key: 'acceptVoltageWithin10Pct', label: 'Voltage Within ±10%?', placeholder: 'YES' },
          ])}
        </div>
      </div>

      {/* Section 6 & 7 */}
      <div className="card" style={SECTION_STYLE}>
        <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>
          6. Results of Operation &amp; 7. Over All Remarks / Signatories
        </strong>
        <div style={GRID_3_STYLE}>
          {renderInputs([
            { key: 'operationDuration', label: '6. Duration', placeholder: 'e.g. 9 HOURS' },
            { key: 'reasonOfPullout', label: '6. Reason of Pull-Out', placeholder: 'e.g. VIBRATION AND HIGH AMPERE' },
            { key: 'overallRemarks', label: '7. Over All Remarks', placeholder: 'e.g. PUMP REPLACED. ALL GOOD AFTER INSTALLATION' },
            { key: 'performedByContractor', label: 'Performed by (Contractor)', placeholder: 'Lead / Contractor Name' },
            { key: 'checkedByCoordinator', label: 'Checked by (Site Coordinator / Electrician)', placeholder: 'Site Coordinator / Electrician' },
            { key: 'notedByEngineer', label: 'Noted by (Electromechanical Eng. / Tech. Head)', placeholder: 'Electromechanical Engineer' },
          ])}
        </div>
      </div>
    </div>
  );
}
