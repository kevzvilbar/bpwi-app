'use client';

import {
  computeTankDowntime,
  evaluateTankWaterQuality,
  type TankCapacityUnit,
  type TankCleaningCondition,
  type TankCleaningFormDetails,
  type TankCleaningType,
  type WaterQualityVerdict,
} from '@/lib/tank-cleaning-types';
import {
  normalizePulloutDateYMD,
  normalizePulloutTimeHHMM,
} from '@/lib/well-pullout-types';

interface TankCleaningFieldsProps {
  value: TankCleaningFormDetails;
  onChange: (next: TankCleaningFormDetails) => void;
  activityDate?: string;
  leadOpName?: string;
}

const SECTION_STYLE: React.CSSProperties = {
  padding: 10,
  display: 'grid',
  gap: 8,
  background: 'var(--bg-surface)',
  borderColor: 'var(--border-subtle)',
};

const LABEL_STYLE: React.CSSProperties = {
  display: 'grid',
  gap: 3,
  fontSize: 11.5,
  color: 'var(--text-secondary)',
};

const GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 8,
};

const CONDITIONS: readonly TankCleaningCondition[] = ['Good', 'Fair', 'Needs Repair', 'N/A'];
const TANK_TYPES: readonly Exclude<TankCleaningType, ''>[] = [
  'Ground Reservoir',
  'Overhead / Elevated Tank',
  'Cistern',
  'Clearwell / Filter Tank',
  'Pressure Tank',
  'Other',
];
const CAPACITY_UNITS: readonly TankCapacityUnit[] = ['m³', 'Gallons', 'Liters'];

function verdictBadgeStyle(v: WaterQualityVerdict): React.CSSProperties {
  if (v === 'PASS') {
    return {
      padding: '2px 7px',
      borderRadius: 999,
      fontSize: 10.5,
      fontWeight: 700,
      background: 'var(--ok-bg)',
      color: 'var(--ok-fg)',
      border: '1px solid var(--ok-border)',
    };
  }
  if (v === 'FAIL') {
    return {
      padding: '2px 7px',
      borderRadius: 999,
      fontSize: 10.5,
      fontWeight: 700,
      background: 'var(--danger-bg, rgba(220,38,38,0.12))',
      color: 'var(--danger)',
      border: '1px solid var(--danger)',
    };
  }
  return {
    padding: '2px 7px',
    borderRadius: 999,
    fontSize: 10.5,
    fontWeight: 600,
    background: 'var(--surface-muted)',
    color: 'var(--text-muted)',
    border: '1px solid var(--border-subtle)',
  };
}

export default function TankCleaningFields({
  value,
  onChange,
  activityDate = '',
  leadOpName = '',
}: TankCleaningFieldsProps) {
  const defaultStartYmd = normalizePulloutDateYMD(value.dateStarted, activityDate);
  const defaultEndYmd = normalizePulloutDateYMD(value.dateFinished, defaultStartYmd);
  const evalRes = evaluateTankWaterQuality(value);

  const patch = (updates: Partial<TankCleaningFormDetails>) => {
    const next: TankCleaningFormDetails = { ...value, ...updates };
    if (
      'dateStarted' in updates ||
      'timeStarted' in updates ||
      'dateFinished' in updates ||
      'timeFinished' in updates
    ) {
      const computed = computeTankDowntime(
        next.dateStarted,
        next.timeStarted,
        next.dateFinished,
        next.timeFinished,
        activityDate,
      );
      if (computed) next.totalDowntime = computed;
    }
    onChange(next);
  };

  const inspectionItems: ReadonlyArray<{
    title: string;
    condKey: 'condWallsFloor' | 'condRoofHatch' | 'condVentsScreen' | 'condValves' | 'condLadderGauge';
    remKey: 'remWallsFloor' | 'remRoofHatch' | 'remVentsScreen' | 'remValves' | 'remLadderGauge';
    placeholder: string;
  }> = [
    { title: 'Interior Walls & Floor', condKey: 'condWallsFloor', remKey: 'remWallsFloor', placeholder: 'e.g. Minor sediment removed; no structural cracks.' },
    { title: 'Roof, Ceiling & Manhole Hatch', condKey: 'condRoofHatch', remKey: 'remRoofHatch', placeholder: 'e.g. Gasket intact; cover lockable & watertight.' },
    { title: 'Air Vents & Overflow Screen', condKey: 'condVentsScreen', remKey: 'remVentsScreen', placeholder: 'e.g. Mesh screen intact & free of obstructions.' },
    { title: 'Inlet, Outlet & Drain Valves', condKey: 'condValves', remKey: 'remValves', placeholder: 'e.g. Valves operated smoothly; no leaks.' },
    { title: 'Access Ladder & Level Gauge', condKey: 'condLadderGauge', remKey: 'remLadderGauge', placeholder: 'e.g. Rungs secure; level indicator functional.' },
  ];

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {/* Header / Tank Metadata & Timeline */}
      <div className="card" style={{ ...SECTION_STYLE, borderColor: 'var(--accent)' }}>
        <strong style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>
          Tank Cleaning &amp; Sanitation Details
        </strong>
        <div style={GRID_STYLE}>
          <label style={LABEL_STYLE}>
            Tank ID / Name
            <input
              className="input"
              value={value.tankId}
              placeholder="e.g. Reservoir 1 / OHT-01"
              onChange={(e) => patch({ tankId: e.target.value })}
            />
          </label>
          <label style={LABEL_STYLE}>
            Tank Type
            <select
              className="input"
              value={value.tankType}
              onChange={(e) => patch({ tankType: e.target.value as TankCleaningType })}
            >
              <option value="">-- Select Tank Type --</option>
              {TANK_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <div style={LABEL_STYLE}>
            <span>Tank Capacity</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 86px', gap: 6 }}>
              <input
                className="input"
                value={value.tankCapacity}
                placeholder="e.g. 100"
                onChange={(e) => patch({ tankCapacity: e.target.value })}
              />
              <select
                className="input"
                value={value.tankCapacityUnit}
                onChange={(e) => patch({ tankCapacityUnit: e.target.value as TankCapacityUnit })}
              >
                {CAPACITY_UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>
          <label style={LABEL_STYLE}>
            Report No. (optional override)
            <input
              className="input"
              value={value.reportNo}
              placeholder="Auto: TCAR-YYYY-MM-XXXX"
              onChange={(e) => patch({ reportNo: e.target.value })}
            />
          </label>
          <label style={LABEL_STYLE}>
            Date Started
            <input
              className="input"
              type="date"
              value={defaultStartYmd}
              onChange={(e) => patch({ dateStarted: e.target.value })}
            />
          </label>
          <label style={LABEL_STYLE}>
            Time Started
            <input
              className="input"
              type="time"
              value={normalizePulloutTimeHHMM(value.timeStarted)}
              onChange={(e) => patch({ timeStarted: e.target.value })}
            />
          </label>
          <label style={LABEL_STYLE}>
            Date Finished
            <input
              className="input"
              type="date"
              value={defaultEndYmd}
              onChange={(e) => patch({ dateFinished: e.target.value })}
            />
          </label>
          <label style={LABEL_STYLE}>
            Time Finished
            <input
              className="input"
              type="time"
              value={normalizePulloutTimeHHMM(value.timeFinished)}
              onChange={(e) => patch({ timeFinished: e.target.value })}
            />
          </label>
          <label style={LABEL_STYLE}>
            Total Downtime (auto-computed)
            <input
              className="input"
              value={value.totalDowntime}
              placeholder="e.g. 6 hrs 30 mins"
              onChange={(e) => patch({ totalDowntime: e.target.value })}
            />
          </label>
        </div>
      </div>

      {/* Section 1 & 2: Objective & Scope of Work */}
      <div className="card" style={SECTION_STYLE}>
        <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>
          1. Objective &amp; 2. Scope of Work
        </strong>
        <label style={LABEL_STYLE}>
          Objective
          <textarea
            className="input"
            rows={2}
            value={value.objective}
            onChange={(e) => patch({ objective: e.target.value })}
          />
        </label>
        <div style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-primary)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={value.scopeSystemIsolation}
                onChange={(e) => patch({ scopeSystemIsolation: e.target.checked })}
              />
              <span>System Isolation</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={value.scopeBypassEngaged}
                onChange={(e) => patch({ scopeBypassEngaged: e.target.checked })}
              />
              <span>Bypass Line Engaged</span>
            </label>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={value.scopeDrainingSludge}
              onChange={(e) => patch({ scopeDrainingSludge: e.target.checked })}
            />
            <span>Draining &amp; Sludge Removal</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={value.scopeSurfaceScrubbing}
              onChange={(e) => patch({ scopeSurfaceScrubbing: e.target.checked })}
            />
            <span>Surface Scrubbing &amp; Pressure Washing</span>
          </label>
          <div style={{ display: 'grid', gap: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={value.scopeDisinfection}
                onChange={(e) => patch({ scopeDisinfection: e.target.checked })}
              />
              <span>Disinfection &amp; Sanitization</span>
            </label>
            {value.scopeDisinfection && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, paddingLeft: 20 }}>
                <label style={LABEL_STYLE}>
                  Chlorine Concentration (ppm)
                  <input
                    className="input"
                    value={value.disinfectionConcentrationPpm}
                    placeholder="50"
                    onChange={(e) => patch({ disinfectionConcentrationPpm: e.target.value })}
                  />
                </label>
                <label style={LABEL_STYLE}>
                  Contact Time
                  <input
                    className="input"
                    value={value.disinfectionContactTime}
                    placeholder="30 mins"
                    onChange={(e) => patch({ disinfectionContactTime: e.target.value })}
                  />
                </label>
              </div>
            )}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={value.scopeFlushingRefilling}
              onChange={(e) => patch({ scopeFlushingRefilling: e.target.checked })}
            />
            <span>Flushing &amp; Potable Water Refilling</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={value.scopeCommissioning}
              onChange={(e) => patch({ scopeCommissioning: e.target.checked })}
            />
            <span>Commissioning &amp; Water Quality Verification</span>
          </label>
        </div>
      </div>

      {/* Section 3: Water Quality & Disinfection Log */}
      <div className="card" style={SECTION_STYLE}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>
            3. Water Quality &amp; Disinfection Log (PNSDW Verification)
          </strong>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: evalRes.overall === 'CLEARED' ? 'var(--ok-fg)' : evalRes.overall === 'HOLD' ? 'var(--danger)' : 'var(--text-muted)',
            }}
          >
            Status: {evalRes.overall === 'CLEARED' ? 'CLEARED FOR SERVICE' : evalRes.overall === 'HOLD' ? 'HOLD — REVIEW POST-CLEANING' : 'PENDING READINGS'}
          </span>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr repeat(3, minmax(0, 1fr)) auto', gap: 6, alignItems: 'center', fontSize: 11 }}>
            <strong style={{ color: 'var(--text-primary)' }}>Free Cl₂ (0.30–1.50 mg/L)</strong>
            <input className="input" placeholder="Pre" value={value.chlorinePre} onChange={(e) => patch({ chlorinePre: e.target.value })} />
            <input className="input" placeholder="Disinfect" value={value.chlorineDisinfection} onChange={(e) => patch({ chlorineDisinfection: e.target.value })} />
            <input className="input" placeholder="Post" value={value.chlorinePost} onChange={(e) => patch({ chlorinePost: e.target.value })} />
            <span style={verdictBadgeStyle(evalRes.chlorine)}>{evalRes.chlorine}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr repeat(3, minmax(0, 1fr)) auto', gap: 6, alignItems: 'center', fontSize: 11 }}>
            <strong style={{ color: 'var(--text-primary)' }}>Turbidity (≤ 5.0 NTU)</strong>
            <input className="input" placeholder="Pre" value={value.turbidityPre} onChange={(e) => patch({ turbidityPre: e.target.value })} />
            <span style={{ textAlign: 'center', color: 'var(--text-muted)' }}>N/A</span>
            <input className="input" placeholder="Post (e.g. 0.4)" value={value.turbidityPost} onChange={(e) => patch({ turbidityPost: e.target.value })} />
            <span style={verdictBadgeStyle(evalRes.turbidity)}>{evalRes.turbidity}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr repeat(3, minmax(0, 1fr)) auto', gap: 6, alignItems: 'center', fontSize: 11 }}>
            <strong style={{ color: 'var(--text-primary)' }}>pH Level (6.5–8.5)</strong>
            <input className="input" placeholder="Pre" value={value.phPre} onChange={(e) => patch({ phPre: e.target.value })} />
            <input className="input" placeholder="Disinfect" value={value.phDisinfection} onChange={(e) => patch({ phDisinfection: e.target.value })} />
            <input className="input" placeholder="Post (e.g. 7.2)" value={value.phPost} onChange={(e) => patch({ phPost: e.target.value })} />
            <span style={verdictBadgeStyle(evalRes.ph)}>{evalRes.ph}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr repeat(3, minmax(0, 1fr)) auto', gap: 6, alignItems: 'center', fontSize: 11 }}>
            <strong style={{ color: 'var(--text-primary)' }}>Odor &amp; Appearance</strong>
            <input className="input" placeholder="Pre (e.g. Silt)" value={value.odorPre} onChange={(e) => patch({ odorPre: e.target.value })} />
            <span style={{ textAlign: 'center', color: 'var(--text-muted)' }}>N/A</span>
            <input className="input" placeholder="Post (Clear / Odorless)" value={value.odorPost} onChange={(e) => patch({ odorPost: e.target.value })} />
            <span style={verdictBadgeStyle(evalRes.odor)}>{evalRes.odor}</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, paddingTop: 4 }}>
          <label style={LABEL_STYLE}>
            Disinfectant Used
            <input
              className="input"
              list="tank-disinfectants-list"
              value={value.disinfectantUsed}
              placeholder="Sodium Hypochlorite 12.5%"
              onChange={(e) => patch({ disinfectantUsed: e.target.value })}
            />
            <datalist id="tank-disinfectants-list">
              <option value="Sodium Hypochlorite 12.5%" />
              <option value="Calcium Hypochlorite 70%" />
            </datalist>
          </label>
          <label style={LABEL_STYLE}>
            Total Quantity Used
            <input
              className="input"
              value={value.disinfectantQuantity}
              placeholder="e.g. 12 Liters / 5 kg"
              onChange={(e) => patch({ disinfectantQuantity: e.target.value })}
            />
          </label>
        </div>
      </div>

      {/* Section 4: Physical Inspection & Conclusion */}
      <div className="card" style={SECTION_STYLE}>
        <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>
          4. Physical Inspection &amp; Observations
        </strong>
        <div style={{ display: 'grid', gap: 6 }}>
          {inspectionItems.map((item) => (
            <div key={item.condKey} style={{ display: 'grid', gridTemplateColumns: '1.2fr 115px 1.6fr', gap: 6, alignItems: 'center', fontSize: 11.5 }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.title}</span>
              <select
                className="input"
                value={value[item.condKey]}
                onChange={(e) => patch({ [item.condKey]: e.target.value as TankCleaningCondition })}
              >
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>{c || '—'}</option>
                ))}
              </select>
              <input
                className="input"
                value={value[item.remKey]}
                placeholder={item.placeholder}
                onChange={(e) => patch({ [item.remKey]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <label style={LABEL_STYLE}>
          Conclusion &amp; Recommendations (also saved as Field Notes)
          <textarea
            className="input"
            rows={2}
            value={value.conclusionRecommendations}
            placeholder="Tank cleaned and sanitized successfully; facility restored to sanitary operational condition."
            onChange={(e) => patch({ conclusionRecommendations: e.target.value })}
          />
        </label>
        <label style={{ ...LABEL_STYLE, maxWidth: 240 }}>
          Next Scheduled Cleaning Date
          <input
            className="input"
            type="date"
            value={value.nextScheduledCleaningDate}
            onChange={(e) => patch({ nextScheduledCleaningDate: e.target.value })}
          />
        </label>
      </div>

      {/* Section 6 & 7: Photo Documentation Captions & Signatories */}
      <div className="card" style={SECTION_STYLE}>
        <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>
          6. Photo Captions &amp; 7. Sign-Off Details
        </strong>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Attach Start Photo first and End Photo second in the Field Photos section below — photos are automatically deleted after 30 days.
        </div>
        <div style={GRID_STYLE}>
          <label style={LABEL_STYLE}>
            Start Photo Time Taken
            <input
              className="input"
              type="time"
              value={normalizePulloutTimeHHMM(value.startPhotoTime)}
              onChange={(e) => patch({ startPhotoTime: e.target.value })}
            />
          </label>
          <label style={LABEL_STYLE}>
            Start Photo Remarks
            <input
              className="input"
              value={value.startPhotoRemarks}
              placeholder="e.g. Initial sediment buildup prior to washing"
              onChange={(e) => patch({ startPhotoRemarks: e.target.value })}
            />
          </label>
          <label style={LABEL_STYLE}>
            End Photo Time Taken
            <input
              className="input"
              type="time"
              value={normalizePulloutTimeHHMM(value.endPhotoTime)}
              onChange={(e) => patch({ endPhotoTime: e.target.value })}
            />
          </label>
          <label style={LABEL_STYLE}>
            End Photo Remarks
            <input
              className="input"
              value={value.endPhotoRemarks}
              placeholder="e.g. Cleaned and disinfected interior surfaces"
              onChange={(e) => patch({ endPhotoRemarks: e.target.value })}
            />
          </label>
        </div>
        <div style={GRID_STYLE}>
          <div style={LABEL_STYLE}>
            <span>Prepared By (Lead Operator)</span>
            <div className="input" style={{ background: 'var(--surface-muted)', color: 'var(--text-secondary)', fontSize: 12, display: 'flex', alignItems: 'center' }}>
              {leadOpName || 'Auto-filled from Lead Operator above'}
            </div>
          </div>
          <label style={LABEL_STYLE}>
            Noted By (Technical Head / Supervisor)
            <input
              className="input"
              value={value.notedByName}
              placeholder="Technical Head / Supervisor"
              onChange={(e) => patch({ notedByName: e.target.value })}
            />
          </label>
          <label style={LABEL_STYLE}>
            Approved By (Manager / Unit Head)
            <input
              className="input"
              value={value.approvedByName}
              placeholder="Manager / Unit Head"
              onChange={(e) => patch({ approvedByName: e.target.value })}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
