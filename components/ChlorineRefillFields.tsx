'use client';

import {
  CHLORINE_CHEMICALS,
  DRUM_LEVEL_UNITS,
  isDrumLevelLowerAfterRefill,
  type ChlorineAmountUnit,
  type ChlorineRefillFormState,
  type DrumLevelUnit,
} from '@/lib/chlorine-refill';
import type { ActivityDetailFieldsState } from '@/lib/activity-logger-details';

interface ChlorineRefillFieldsProps {
  fields: ActivityDetailFieldsState;
  setFields: React.Dispatch<React.SetStateAction<ActivityDetailFieldsState>>;
}

const GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, alignItems: 'end' } as const;
const LABEL = { display: 'grid', gap: 3, fontSize: 12 } as const;
const HEADING = { fontSize: 12, fontWeight: 700 } as const;

/** Form section for the Chlorine Refilling (Dosing Drum) activity. */
export default function ChlorineRefillFields({ fields, setFields }: ChlorineRefillFieldsProps) {
  const cl = fields.chlorine;
  const patch = (updates: Partial<ChlorineRefillFormState>) =>
    setFields((prev) => ({ ...prev, chlorine: { ...prev.chlorine, ...updates } }));

  const numberInput = (
    label: string,
    value: string,
    onChange: (next: string) => void,
    placeholder?: string,
  ) => (
    <label style={LABEL}>
      {label}
      <input
        className="input"
        type="number"
        inputMode="decimal"
        step="any"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );

  return (
    <div className="card" style={{ padding: 10, display: 'grid', gap: 10, borderColor: 'var(--teal)' }}>
      <strong style={{ fontSize: 12.5, color: 'var(--teal)' }}>Chlorine Dosing Drum Refill</strong>

      <div style={GRID}>
        <label style={LABEL}>
          Chlorine type
          <select
            className="input"
            value={cl.chemicalType}
            onChange={(e) => {
              const chemical = CHLORINE_CHEMICALS.find((c) => c.name === e.target.value);
              patch({ chemicalType: e.target.value, ...(chemical ? { amountUnit: chemical.unit } : {}) });
            }}
          >
            <option value="">— Select —</option>
            {CHLORINE_CHEMICALS.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label style={LABEL}>
          Drum level measured in
          <select
            className="input"
            value={cl.drumLevelUnit}
            onChange={(e) => patch({ drumLevelUnit: e.target.value as DrumLevelUnit })}
          >
            {DRUM_LEVEL_UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={GRID}>
        {numberInput(`Drum level before (${cl.drumLevelUnit}) *`, cl.drumLevelBefore, (v) => patch({ drumLevelBefore: v }))}
        {numberInput(`Drum level after (${cl.drumLevelUnit})`, cl.drumLevelAfter, (v) => patch({ drumLevelAfter: v }))}
      </div>
      {isDrumLevelLowerAfterRefill(cl) && (
        <div role="status" className="alert alert-warn text-xs">
          The level after refilling is lower than before. Please check both readings.
        </div>
      )}

      <div style={GRID}>
        {numberInput('Chlorine added *', cl.amountAdded, (v) => patch({ amountAdded: v }))}
        <label style={LABEL}>
          Unit
          <select
            className="input"
            value={cl.amountUnit}
            onChange={(e) => patch({ amountUnit: e.target.value as ChlorineAmountUnit })}
          >
            <option value="kg">Kilograms (kg)</option>
            <option value="L">Liters (L)</option>
          </select>
        </label>
        {numberInput('Water added (L)', cl.waterAddedLiters, (v) => patch({ waterAddedLiters: v }))}
      </div>

      <span style={HEADING}>Current dosing setting (stroke, speed, or both) *</span>
      <div style={GRID}>
        {numberInput('Pump stroke (%)', cl.pumpStrokePct, (v) => patch({ pumpStrokePct: v }))}
        {numberInput('Pump speed / frequency (%)', cl.pumpSpeedPct, (v) => patch({ pumpSpeedPct: v }))}
      </div>

      <span style={HEADING}>New dosing setting (leave blank if unchanged)</span>
      <div style={GRID}>
        {numberInput('New stroke (%)', cl.newPumpStrokePct, (v) => patch({ newPumpStrokePct: v }), 'Unchanged')}
        {numberInput('New speed / frequency (%)', cl.newPumpSpeedPct, (v) => patch({ newPumpSpeedPct: v }), 'Unchanged')}
      </div>

      <div style={{ ...GRID, maxWidth: 260 }}>
        {numberInput('Residual chlorine (mg/L), if tested', fields.chlorineResidual, (v) =>
          setFields((prev) => ({ ...prev, chlorineResidual: v })),
        )}
      </div>
    </div>
  );
}
