'use client';

import { useState } from 'react';
import {
  DISCHARGE_COEFF_PRESETS,
  LEAK_MATERIAL_UNITS,
  LEAK_PIPE_BORE_PRESETS_MM,
  calcLeakDurationMinutesFromTimes,
  computeLeakVolumeLoss,
  type LeakFaultAttribution,
  type LeakOpeningShape,
  type LeakVolumeLossFormState,
} from '@/lib/leak-volume-loss';
import type { ActivityDetailFieldsState } from '@/lib/activity-logger-details';

interface LeakRepairFieldsProps {
  activityType: string;
  fields: ActivityDetailFieldsState;
  setFields: React.Dispatch<React.SetStateAction<ActivityDetailFieldsState>>;
}

/**
 * Leak Repair, Leak Detection & Valve Replacement form section:
 * captures pipe/cause specs, Fault Attribution (NRW vs Customer/3rd-Party),
 * Torricelli orifice water-wastage volume inputs, and unit-aware Materials Used
 * (peso tariff & labor pricing are intentionally omitted and handled manually by Billing).
 */
export default function LeakRepairFields({
  activityType,
  fields,
  setFields,
}: LeakRepairFieldsProps) {
  const isRepair = activityType === 'leak_repair';
  const isValve = activityType === 'valve_replacement';
  const leak = fields.leakLoss;
  const presetValues = new Set(DISCHARGE_COEFF_PRESETS.map((p) => p.value));
  const [customMuMode, setCustomMuMode] = useState(
    () => Boolean(leak.dischargeCoeff) && !presetValues.has(leak.dischargeCoeff),
  );

  const patch = (updates: Partial<ActivityDetailFieldsState>) =>
    setFields((prev) => ({ ...prev, ...updates }));

  const patchLeak = (updates: Partial<LeakVolumeLossFormState>) =>
    setFields((prev) => ({
      ...prev,
      leakLoss: { ...prev.leakLoss, ...updates },
    }));

  const updateTimesAndDuration = (nextReported: string, nextIsolated: string) => {
    const mins = calcLeakDurationMinutesFromTimes(nextReported, nextIsolated);
    patchLeak({
      leakReportedAt: nextReported,
      valveIsolatedAt: nextIsolated,
      ...(mins !== null ? { durationMinutes: String(mins) } : {}),
    });
  };

  const computed = isRepair ? computeLeakVolumeLoss(leak) : null;

  return (
    <div
      className="card"
      style={{
        padding: 10,
        display: 'grid',
        gap: 10,
        borderColor: isValve ? 'var(--teal)' : 'var(--danger-border)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 12.5, color: isValve ? 'var(--teal)' : 'var(--danger)' }}>
          {isValve ? 'Valve Details & Materials' : 'Leak Details, Water Loss & Materials'}
        </strong>
        {computed && (
          <span
            style={{
              background: 'var(--warn-bg)',
              color: 'var(--warn-fg)',
              padding: '2px 8px',
              borderRadius: 999,
              fontSize: 11.5,
              fontWeight: 700,
            }}
          >
            Est. Water Loss: {computed.totalVolumeM3.toFixed(2)} m³
          </span>
        )}
      </div>

      {/* Pipe Spec & Cause */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
          Pipe / Valve Size &amp; Spec
          <input
            className="input"
            value={fields.pipeSize}
            onChange={(e) => patch({ pipeSize: e.target.value })}
            placeholder={isValve ? 'e.g. 2" Gate Valve / Brass' : 'e.g. 2" Stand Pipe / uPVC'}
          />
        </label>
        <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
          {isValve ? 'Replacement Cause / Action' : 'Leak Classification / Cause'}
          <input
            className="input"
            value={fields.leakType}
            onChange={(e) => patch({ leakType: e.target.value })}
            placeholder={isValve ? 'e.g. Defective / seized gate valve' : 'e.g. Hit by Car / Saddle clamp / Joint'}
          />
        </label>
      </div>

      {/* Fault Attribution & Orifice Water Loss Calculator (Leak Repair) */}
      {isRepair && (
        <>
          <div
            style={{
              padding: 9,
              borderRadius: 8,
              border: '1px solid var(--border-light)',
              background: 'var(--surface-muted)',
              display: 'grid',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Fault Attribution
              </span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(
                  [
                    { id: 'natural_nrw', label: 'Natural / Wear (Company NRW)' },
                    { id: 'third_party', label: 'Customer / 3rd-Party Fault' },
                  ] as ReadonlyArray<{ id: LeakFaultAttribution; label: string }>
                ).map((opt) => {
                  const active = leak.faultAttribution === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className="btn"
                      onClick={() => patchLeak({ faultAttribution: opt.id })}
                      style={{
                        minHeight: 30,
                        padding: '3px 9px',
                        fontSize: 11.5,
                        fontWeight: 700,
                        background: active
                          ? opt.id === 'third_party'
                            ? 'var(--danger-bg)'
                            : 'var(--info-bg)'
                          : 'var(--surface)',
                        color: active
                          ? opt.id === 'third_party'
                            ? 'var(--danger-fg)'
                            : 'var(--info-fg)'
                          : 'var(--text)',
                        borderColor: active
                          ? opt.id === 'third_party'
                            ? 'var(--danger-border)'
                            : 'var(--info-border)'
                          : 'var(--border)',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {leak.faultAttribution === 'third_party' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, alignItems: 'end' }}>
                <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                  Responsible Party / Customer Name
                  <input
                    className="input"
                    value={leak.responsibleParty}
                    onChange={(e) => patchLeak({ responsibleParty: e.target.value })}
                    placeholder="e.g. Driver / Contractor / Homeowner"
                  />
                </label>
                <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                  Account # / Plate # / Reference
                  <input
                    className="input"
                    value={leak.responsibleAccountNo}
                    onChange={(e) => patchLeak({ responsibleAccountNo: e.target.value })}
                    placeholder="Optional account, plate, or report #"
                  />
                </label>
              </div>
            )}
          </div>

          <div
            style={{
              padding: 9,
              borderRadius: 8,
              border: '1px solid var(--border-light)',
              background: 'var(--surface-muted)',
              display: 'grid',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Theoretical Water Loss (Torricelli Orifice)
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {(
                  [
                    { id: 'circular', label: 'Circular Hole (d)' },
                    { id: 'slit', label: 'Slit / Crack (L × W)' },
                  ] as ReadonlyArray<{ id: LeakOpeningShape; label: string }>
                ).map((shape) => (
                  <button
                    key={shape.id}
                    type="button"
                    className="btn"
                    onClick={() => patchLeak({ openingShape: shape.id })}
                    style={{
                      minHeight: 28,
                      padding: '2px 8px',
                      fontSize: 11,
                      fontWeight: 700,
                      background: leak.openingShape === shape.id ? 'var(--primary)' : 'var(--surface)',
                      color: leak.openingShape === shape.id ? 'var(--primary-fg)' : 'var(--text)',
                      borderColor: leak.openingShape === shape.id ? 'var(--primary)' : 'var(--border)',
                    }}
                  >
                    {shape.label}
                  </button>
                ))}
              </div>
            </div>

            {leak.openingShape === 'circular' ? (
              <div style={{ display: 'grid', gap: 5 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, alignItems: 'end' }}>
                  <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                    Damage Diameter d (mm)
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="0.1"
                      value={leak.diameterMm}
                      onChange={(e) => patchLeak({ diameterMm: e.target.value })}
                      placeholder="e.g. 50"
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                    Operating / Residual Pressure (PSI)
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="0.1"
                      value={leak.pressurePsi}
                      onChange={(e) => patchLeak({ pressurePsi: e.target.value })}
                      placeholder="e.g. 30"
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                    Discharge Coeff. (μ)
                    <select
                      className="input"
                      value={customMuMode ? '__custom' : leak.dischargeCoeff}
                      onChange={(e) => {
                        if (e.target.value === '__custom') {
                          setCustomMuMode(true);
                          return;
                        }
                        setCustomMuMode(false);
                        patchLeak({ dischargeCoeff: e.target.value });
                      }}
                    >
                      {DISCHARGE_COEFF_PRESETS.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                      <option value="__custom">Custom μ…</option>
                    </select>
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Quick bore:</span>
                  {LEAK_PIPE_BORE_PRESETS_MM.map((preset) => (
                    <button
                      key={preset.mm}
                      type="button"
                      className="btn btn-xs"
                      onClick={() => patchLeak({ diameterMm: preset.mm })}
                      style={{
                        fontSize: 11,
                        fontWeight: leak.diameterMm === preset.mm ? 700 : 500,
                        background: leak.diameterMm === preset.mm ? 'var(--info-bg)' : 'var(--surface)',
                        color: leak.diameterMm === preset.mm ? 'var(--info-fg)' : 'var(--text-secondary)',
                      }}
                    >
                      {preset.mm}mm ({preset.label})
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, alignItems: 'end' }}>
                <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                  Crack Length L (mm)
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.1"
                    value={leak.slitLengthMm}
                    onChange={(e) => patchLeak({ slitLengthMm: e.target.value })}
                    placeholder="e.g. 30"
                  />
                </label>
                <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                  Crack Width W (mm)
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.1"
                    value={leak.slitWidthMm}
                    onChange={(e) => patchLeak({ slitWidthMm: e.target.value })}
                    placeholder="e.g. 2"
                  />
                </label>
                <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                  Residual Pressure (PSI)
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.1"
                    value={leak.pressurePsi}
                    onChange={(e) => patchLeak({ pressurePsi: e.target.value })}
                    placeholder="e.g. 30"
                  />
                </label>
                <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                  Discharge Coeff. (μ)
                  <select
                    className="input"
                    value={customMuMode ? '__custom' : leak.dischargeCoeff}
                    onChange={(e) => {
                      if (e.target.value === '__custom') {
                        setCustomMuMode(true);
                        return;
                      }
                      setCustomMuMode(false);
                      patchLeak({ dischargeCoeff: e.target.value });
                    }}
                  >
                    {DISCHARGE_COEFF_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                    <option value="__custom">Custom μ…</option>
                  </select>
                </label>
              </div>
            )}

            {customMuMode && (
              <label style={{ display: 'grid', gap: 3, fontSize: 12, maxWidth: 180 }}>
                Custom μ (0.01 – 1.00)
                <input
                  className="input"
                  type="number"
                  min="0.01"
                  max="1"
                  step="0.01"
                  value={leak.dischargeCoeff}
                  onChange={(e) => patchLeak({ dischargeCoeff: e.target.value })}
                />
              </label>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, alignItems: 'end' }}>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Leak Reported Time
                <input
                  className="input"
                  type="time"
                  value={leak.leakReportedAt}
                  onChange={(e) => updateTimesAndDuration(e.target.value, leak.valveIsolatedAt)}
                />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Valve Isolated Time
                <input
                  className="input"
                  type="time"
                  value={leak.valveIsolatedAt}
                  onChange={(e) => updateTimesAndDuration(leak.leakReportedAt, e.target.value)}
                />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Water-Flow Duration (min)
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.5"
                  value={leak.durationMinutes}
                  onChange={(e) => patchLeak({ durationMinutes: e.target.value })}
                  placeholder="e.g. 44"
                />
              </label>
            </div>

            {computed && (
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: 'var(--info-bg)',
                  color: 'var(--info-fg)',
                  fontSize: 12,
                  display: 'grid',
                  gap: 3,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <strong>Total Theoretical Volume Loss: {computed.totalVolumeM3.toFixed(2)} m³</strong>
                  <span>Duration: {computed.durationMinutes} min ({computed.durationHours.toFixed(2)} hrs)</span>
                </div>
                <div style={{ fontSize: 11.5 }}>
                  Q = {computed.flowM3PerSec.toFixed(4)} m³/s ({computed.flowLps.toFixed(2)} L/s) · A ={' '}
                  {computed.areaM2.toFixed(4)} m² ({computed.formulaAreaText}) · ΔP ={' '}
                  {computed.deltaPa.toFixed(2)} Pa
                </div>
                {computed.highPressureDropWarning && (
                  <div style={{ fontSize: 11, color: 'var(--warn-fg)', marginTop: 2 }}>
                    Note: Verify residual operating pressure at the break — nominal static pressure on large ruptures (≥40 mm) overestimates flow if upstream pressure drops.
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Materials Used (Quantity + Unit; Pricing handled manually by Billing) */}
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
            Materials Used ({fields.usedMaterials.length})
          </span>
          <button
            type="button"
            className="btn btn-add btn-sm"
            onClick={() =>
              setFields((prev) => ({
                ...prev,
                usedMaterials: [...prev.usedMaterials, { item: '', qty: '1', unit: 'pcs' }],
              }))
            }
          >
            + Material
          </button>
        </div>

        {fields.usedMaterials.map((m, idx) => {
          const unitVal = m.unit ?? 'pcs';
          const hasCustomUnit = Boolean(
            unitVal && !LEAK_MATERIAL_UNITS.includes(unitVal as (typeof LEAK_MATERIAL_UNITS)[number]),
          );
          return (
            <div
              key={idx}
              style={{
                padding: 8,
                borderRadius: 8,
                border: '1px solid var(--border-light)',
                background: 'var(--surface-muted)',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                alignItems: 'center',
              }}
            >
              <input
                className="input"
                style={{ flex: '2 1 220px', minWidth: 0 }}
                placeholder="Material description (e.g. 2&quot; GI Coupling)"
                value={m.item}
                onChange={(e) =>
                  setFields((prev) => ({
                    ...prev,
                    usedMaterials: prev.usedMaterials.map((x, i) =>
                      i === idx ? { ...x, item: e.target.value } : x,
                    ),
                  }))
                }
              />
              <input
                className="input"
                style={{ flex: '0 1 88px', minWidth: 72 }}
                placeholder="Qty"
                value={m.qty}
                onChange={(e) =>
                  setFields((prev) => ({
                    ...prev,
                    usedMaterials: prev.usedMaterials.map((x, i) =>
                      i === idx ? { ...x, qty: e.target.value } : x,
                    ),
                  }))
                }
              />
              <select
                className="input"
                aria-label="Material unit"
                style={{ flex: '0 1 112px', minWidth: 96 }}
                value={unitVal}
                onChange={(e) =>
                  setFields((prev) => ({
                    ...prev,
                    usedMaterials: prev.usedMaterials.map((x, i) =>
                      i === idx ? { ...x, unit: e.target.value } : x,
                    ),
                  }))
                }
              >
                {hasCustomUnit && <option value={unitVal}>{unitVal}</option>}
                {LEAK_MATERIAL_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-sm btn-danger-soft"
                aria-label={`Remove material ${idx + 1}`}
                style={{ flexShrink: 0 }}
                onClick={() =>
                  setFields((prev) => ({
                    ...prev,
                    usedMaterials: prev.usedMaterials.filter((_, i) => i !== idx),
                  }))
                }
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
