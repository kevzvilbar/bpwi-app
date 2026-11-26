'use client';

import type { ActivityDetailFieldsState } from '@/lib/activity-logger-details';
import {
  GENSET_BATTERY_STATUS_OPTIONS,
  GENSET_COOLANT_LEVEL_OPTIONS,
  GENSET_DURATION_PRESETS_MIN,
  GENSET_EXHAUST_SMOKE_OPTIONS,
  GENSET_LEAK_STATUS_OPTIONS,
  GENSET_NOISE_STATUS_OPTIONS,
  GENSET_OIL_LEVEL_OPTIONS,
  GENSET_RUN_MODE_OPTIONS,
  evaluateGensetDurationGuidance,
  evaluateGensetHealth,
  type GensetBatteryStatus,
  type GensetCoolantLevel,
  type GensetExhaustSmoke,
  type GensetLeakStatus,
  type GensetMonitoringFormState,
  type GensetNoiseStatus,
  type GensetOilLevel,
  type GensetRunMode,
  type GensetUnitFuelType,
} from '@/lib/genset-monitoring';

interface GensetMonitoringFieldsProps {
  fields: ActivityDetailFieldsState;
  setFields: React.Dispatch<React.SetStateAction<ActivityDetailFieldsState>>;
}

export default function GensetMonitoringFields({ fields, setFields }: GensetMonitoringFieldsProps) {
  const g = fields.genset;
  const patchBase = (updates: Partial<ActivityDetailFieldsState>) =>
    setFields((prev) => ({ ...prev, ...updates }));
  const patchGenset = (updates: Partial<GensetMonitoringFormState>) =>
    setFields((prev) => ({ ...prev, genset: { ...prev.genset, ...updates } }));

  const durationGuidance = evaluateGensetDurationGuidance(g.runMode, g.runDurationMin, g.unitFuelType);
  const health = evaluateGensetHealth(g);
  const isSkippedRun = g.runMode === 'skipped_ran_outage';

  const guidanceToneStyle =
    durationGuidance?.tone === 'ok'
      ? { background: 'var(--ok-bg)', color: 'var(--ok-fg)', border: '1px solid var(--ok-border)' }
      : durationGuidance?.tone === 'warn'
        ? { background: 'var(--warn-bg)', color: 'var(--warn-fg)', border: '1px solid var(--warn-border)' }
        : { background: 'var(--info-bg)', color: 'var(--info-fg)', border: '1px solid var(--info-border)' };

  const verdictStyle =
    health.verdict === 'READY'
      ? { background: 'var(--ok-bg)', color: 'var(--ok-fg)', border: '1px solid var(--ok-border)' }
      : health.verdict === 'NEEDS_ATTENTION'
        ? { background: 'var(--warn-bg)', color: 'var(--warn-fg)', border: '1px solid var(--warn-border)' }
        : { background: 'var(--danger-bg)', color: 'var(--danger-fg)', border: '1px solid var(--danger-border)' };

  const handleFuelTypeChange = (nextFuel: GensetUnitFuelType) => {
    const nextCoolant: GensetCoolantLevel =
      nextFuel === 'Gasoline' && g.coolantLevel === 'Normal'
        ? 'N/A (Air-Cooled)'
        : nextFuel === 'Diesel' && g.coolantLevel === 'N/A (Air-Cooled)'
          ? 'Normal'
          : g.coolantLevel;
    patchGenset({ unitFuelType: nextFuel, coolantLevel: nextCoolant });
  };

  const handleRunModeChange = (nextMode: GensetRunMode) => {
    let nextCause = fields.gensetCause;
    if (nextMode === 'no_load_pms') nextCause = 'PMS';
    else if (nextMode === 'power_outage') nextCause = 'Power Outage';

    const nextSmoke: GensetExhaustSmoke =
      nextMode === 'skipped_ran_outage'
        ? 'N/A (Not Run)'
        : g.exhaustSmoke === 'N/A (Not Run)'
          ? 'Clear / Normal'
          : g.exhaustSmoke;

    setFields((prev) => ({
      ...prev,
      gensetCause: nextCause,
      genset: {
        ...prev.genset,
        runMode: nextMode,
        runDurationMin: nextMode === 'skipped_ran_outage' ? '' : prev.genset.runDurationMin,
        exhaustSmoke: nextSmoke,
      },
    }));
  };

  return (
    <div className="card" style={{ padding: 12, display: 'grid', gap: 10, borderColor: 'var(--warn-border)' }}>
      {/* Header & Unit Fuel Toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <strong style={{ fontSize: 13, color: 'var(--warn-fg)' }}>
          Genset Monitoring &amp; Weekly PMS Inspection
        </strong>
        <div style={{ display: 'inline-flex', gap: 4 }}>
          {(['Diesel', 'Gasoline'] as const).map((fuel) => {
            const active = g.unitFuelType === fuel;
            return (
              <button
                key={fuel}
                type="button"
                className="chip-btn"
                onClick={() => handleFuelTypeChange(fuel)}
                style={{
                  padding: '3px 10px',
                  borderRadius: 999,
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: active ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                  background: active ? 'var(--info-bg)' : 'var(--surface-muted)',
                  color: active ? 'var(--info-fg)' : 'var(--text-secondary)',
                }}
              >
                {fuel}
              </button>
            );
          })}
        </div>
      </div>

      {/* Section 1: Exercise Run & Fuel Level */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8, alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
          Run Cause
          <select
            className="input"
            value={fields.gensetCause}
            onChange={(e) => patchBase({ gensetCause: e.target.value as ActivityDetailFieldsState['gensetCause'] })}
          >
            <option value="PMS">Weekly PMS</option>
            <option value="Routine">Routine Test</option>
            <option value="Power Outage">Power Outage</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
          Exercise / Run Mode
          <select
            className="input"
            value={g.runMode}
            onChange={(e) => handleRunModeChange(e.target.value as GensetRunMode)}
          >
            {GENSET_RUN_MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, alignItems: 'end' }}>
        <div style={{ display: 'grid', gap: 3, fontSize: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
            <span>Run Duration (mins)</span>
            {!isSkippedRun && (
              <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
                {GENSET_DURATION_PRESETS_MIN.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => patchGenset({ runDurationMin: String(m) })}
                    style={{
                      minHeight: 24,
                      padding: '2px 7px',
                      fontSize: 11,
                      fontWeight: 700,
                      borderRadius: 4,
                      cursor: 'pointer',
                      border: g.runDurationMin === String(m) ? '1px solid var(--accent)' : '1px solid var(--border)',
                      background: g.runDurationMin === String(m) ? 'var(--info-bg)' : 'var(--surface-muted)',
                      color: g.runDurationMin === String(m) ? 'var(--info-fg)' : 'var(--text-secondary)',
                    }}
                  >
                    {m}m
                  </button>
                ))}
              </span>
            )}
          </div>
          <input
            className="input"
            type="number"
            min="1"
            step="1"
            disabled={isSkippedRun}
            placeholder={isSkippedRun ? 'Skipped (ran on outage)' : '15–20 recommended'}
            value={g.runDurationMin}
            onChange={(e) => patchGenset({ runDurationMin: e.target.value })}
          />
        </div>
        <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
          Hour Meter (hrs)
          <input
            className="input"
            type="number"
            step="0.1"
            placeholder="e.g. 412.5"
            value={fields.runningHours}
            onChange={(e) => patchBase({ runningHours: e.target.value })}
          />
        </label>
        <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
          Initial Fuel (L / %)
          <input
            className="input"
            type="number"
            step="0.1"
            value={fields.gensetInitialFuel}
            onChange={(e) => patchBase({ gensetInitialFuel: e.target.value })}
          />
        </label>
        <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
          Final Fuel (L / %)
          <input
            className="input"
            type="number"
            step="0.1"
            value={fields.gensetFinalFuel}
            onChange={(e) => patchBase({ gensetFinalFuel: e.target.value })}
          />
        </label>
      </div>

      {durationGuidance && (
        <div
          style={{
            ...guidanceToneStyle,
            borderRadius: 6,
            padding: '6px 9px',
            fontSize: 11.5,
            fontWeight: 600,
          }}
        >
          {durationGuidance.message}
        </div>
      )}

      {/* Section 2: Fluid Levels & Battery */}
      <div className="grid-2" style={{ gap: 8, alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
          Engine Oil Level
          <select
            className="input"
            value={g.oilLevel}
            onChange={(e) => patchGenset({ oilLevel: e.target.value as GensetOilLevel })}
          >
            {GENSET_OIL_LEVEL_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
          Coolant / Radiator
          <select
            className="input"
            value={g.coolantLevel}
            onChange={(e) => patchGenset({ coolantLevel: e.target.value as GensetCoolantLevel })}
          >
            {GENSET_COOLANT_LEVEL_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
          Battery &amp; Cranking
          <select
            className="input"
            value={g.batteryStatus}
            onChange={(e) => patchGenset({ batteryStatus: e.target.value as GensetBatteryStatus })}
          >
            {GENSET_BATTERY_STATUS_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
          Battery Voltage (V, opt.)
          <input
            className="input"
            type="number"
            step="0.1"
            placeholder="e.g. 12.6 / 25.4"
            value={g.batteryVoltageV}
            onChange={(e) => patchGenset({ batteryVoltageV: e.target.value })}
          />
        </label>
      </div>

      {/* Section 3: Mechanical / Exhaust Observations & Optional Output */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
          Leaks Observed
          <select
            className="input"
            value={g.leaksObserved}
            onChange={(e) => patchGenset({ leaksObserved: e.target.value as GensetLeakStatus })}
          >
            {GENSET_LEAK_STATUS_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
          Noise / Vibration
          <select
            className="input"
            value={g.noiseVibration}
            onChange={(e) => patchGenset({ noiseVibration: e.target.value as GensetNoiseStatus })}
          >
            {GENSET_NOISE_STATUS_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
          Exhaust Smoke
          <select
            className="input"
            value={g.exhaustSmoke}
            onChange={(e) => patchGenset({ exhaustSmoke: e.target.value as GensetExhaustSmoke })}
          >
            {GENSET_EXHAUST_SMOKE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid-2" style={{ gap: 8, alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
          Output Voltage (V, opt.)
          <input
            className="input"
            type="number"
            step="1"
            placeholder="e.g. 230 / 400"
            value={g.outputVoltageV}
            onChange={(e) => patchGenset({ outputVoltageV: e.target.value })}
          />
        </label>
        <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
          Frequency (Hz, opt.)
          <input
            className="input"
            type="number"
            step="0.1"
            placeholder="e.g. 60.0"
            value={g.frequencyHz}
            onChange={(e) => patchGenset({ frequencyHz: e.target.value })}
          />
        </label>
      </div>

      <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
        Additional Observations / Maintenance Needed (optional)
        <input
          className="input"
          placeholder="e.g. Topped up 1L SAE 15W-40, cleaned air filter, scheduled oil change next month"
          value={g.standbyNote}
          onChange={(e) => patchGenset({ standbyNote: e.target.value })}
        />
      </label>

      {/* Section 4: Live Standby Readiness Verdict */}
      <div
        style={{
          ...verdictStyle,
          borderRadius: 8,
          padding: '8px 10px',
          display: 'grid',
          gap: 3,
          fontSize: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <span style={{ fontWeight: 800, letterSpacing: '0.02em' }}>
            Standby Status: {health.verdictLabel.toUpperCase()}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600 }}>
            {g.unitFuelType} · {g.oilLevel}
          </span>
        </div>
        {health.findings.length > 0 && (
          <div style={{ fontSize: 11.5 }}>
            <b>Flagged items:</b> {health.findings.join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}
