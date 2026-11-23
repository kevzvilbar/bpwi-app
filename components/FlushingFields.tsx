'use client';

import { useState } from 'react';
import {
  FLUSHING_BORE_PRESETS_MM,
  FLUSHING_DISCHARGE_COEFF_PRESETS,
  FLUSHING_METER_STATUS_OPTIONS,
  computeFlushingVolume,
  type FlushingMeterStatus,
} from '@/lib/flushing-volume';
import { DEFAULT_DISCHARGE_COEFF, calcLeakDurationMinutesFromTimes } from '@/lib/leak-volume-loss';
import type { ActivityDetailFieldsState, BlowOffItem } from '@/lib/activity-logger-details';

interface FlushingFieldsProps {
  fields: ActivityDetailFieldsState;
  setFields: React.Dispatch<React.SetStateAction<ActivityDetailFieldsState>>;
}

/**
 * Line Flushing & Blow-Off form component.
 * Supports Mother Meter readings (`Final - Initial`) as well as per-blow-off Torricelli
 * orifice volume calculation when the mother meter is unreadable/defective or absent.
 */
export default function FlushingFields({ fields, setFields }: FlushingFieldsProps) {
  const presetMus = new Set(FLUSHING_DISCHARGE_COEFF_PRESETS.map((p) => p.value));
  const [customMuRows, setCustomMuRows] = useState<Record<number, boolean>>({});

  const patch = (updates: Partial<ActivityDetailFieldsState>) =>
    setFields((prev) => ({ ...prev, ...updates }));

  const patchBlowOff = (idx: number, updates: Partial<BlowOffItem>) =>
    setFields((prev) => ({
      ...prev,
      blowOffs: prev.blowOffs.map((x, i) => (i === idx ? { ...x, ...updates } : x)),
    }));

  const updatePointTimes = (idx: number, nextStart: string, nextEnd: string) => {
    const mins = calcLeakDurationMinutesFromTimes(nextStart, nextEnd);
    patchBlowOff(idx, {
      startTime: nextStart,
      endTime: nextEnd,
      ...(mins !== null ? { durationMinutes: String(mins) } : {}),
    });
  };

  const status = fields.flushingMeterStatus;
  const isOrificeMode = status === 'unreadable' || status === 'no_meter';
  const summary = computeFlushingVolume({
    meterStatus: status,
    flushingInitialRead: fields.flushingInitialRead,
    flushingFinalRead: fields.flushingFinalRead,
    blowOffs: fields.blowOffs,
  });

  const motherInvalidOrder =
    !isOrificeMode &&
    summary.motherMeterInitial !== null &&
    summary.motherMeterFinal !== null &&
    summary.motherMeterFinal < summary.motherMeterInitial;

  const addBlowOffPoint = () =>
    setFields((prev) => {
      const last = prev.blowOffs[prev.blowOffs.length - 1];
      return {
        ...prev,
        blowOffs: [
          ...prev.blowOffs,
          {
            name: `Blow-off ${prev.blowOffs.length + 1}`,
            initialRead: '',
            finalRead: '',
            ...(isOrificeMode && last?.diameterMm ? { diameterMm: last.diameterMm } : {}),
            ...(isOrificeMode && last?.dischargeCoeff
              ? { dischargeCoeff: last.dischargeCoeff }
              : isOrificeMode
                ? { dischargeCoeff: String(DEFAULT_DISCHARGE_COEFF) }
                : {}),
          },
        ],
      };
    });

  return (
    <div className="card" style={{ padding: 10, display: 'grid', gap: 10, borderColor: 'var(--info-border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 12.5, color: 'var(--accent)' }}>Line Flushing &amp; Blow-Off Readings</strong>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {summary.totalVolumeM3 !== null && (
            <span
              style={{
                background: isOrificeMode ? 'var(--warn-bg)' : 'var(--ok-bg)',
                color: isOrificeMode ? 'var(--warn-fg)' : 'var(--ok-fg)',
                padding: '2px 8px',
                borderRadius: 999,
                fontSize: 11.5,
                fontWeight: 700,
              }}
            >
              {isOrificeMode ? 'Est. Flushed' : 'Flushed'}: {summary.totalVolumeM3.toFixed(2)} m³
            </span>
          )}
          <button
            type="button"
            className="btn btn-add"
            style={{ minHeight: 30, padding: '3px 10px', fontSize: 12 }}
            onClick={addBlowOffPoint}
          >
            + Add Point
          </button>
        </div>
      </div>

      {/* Mother Meter Status Selector */}
      <div
        style={{
          padding: 8,
          borderRadius: 8,
          border: '1px solid var(--border-light)',
          background: 'var(--surface-muted)',
          display: 'grid',
          gap: 6,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
          Mother Meter Availability
        </span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FLUSHING_METER_STATUS_OPTIONS.map((opt) => {
            const active = status === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                className="btn"
                onClick={() => patch({ flushingMeterStatus: opt.id as FlushingMeterStatus })}
                style={{
                  minHeight: 30,
                  padding: '3px 9px',
                  fontSize: 11.5,
                  fontWeight: 700,
                  background: active
                    ? opt.id === 'metered'
                      ? 'var(--ok-bg)'
                      : 'var(--warn-bg)'
                    : 'var(--surface)',
                  color: active
                    ? opt.id === 'metered'
                      ? 'var(--ok-fg)'
                      : 'var(--warn-fg)'
                    : 'var(--text)',
                  borderColor: active
                    ? opt.id === 'metered'
                      ? 'var(--ok-border)'
                      : 'var(--warn-border)'
                    : 'var(--border)',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Metered Inputs */}
      {!isOrificeMode ? (
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Main Meter Initial (m³)
              <input
                className="input"
                type="number"
                step="0.01"
                value={fields.flushingInitialRead}
                onChange={(e) => patch({ flushingInitialRead: e.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Main Meter Final (m³)
              <input
                className="input"
                type="number"
                step="0.01"
                value={fields.flushingFinalRead}
                onChange={(e) => patch({ flushingFinalRead: e.target.value })}
              />
            </label>
          </div>
          {motherInvalidOrder && (
            <div style={{ fontSize: 11.5, color: 'var(--danger)' }}>
              Final reading must be greater than or equal to Initial reading.
            </div>
          )}
        </div>
      ) : (
        <div
          style={{
            padding: '6px 9px',
            borderRadius: 6,
            background: 'var(--warn-bg)',
            color: 'var(--warn-fg)',
            fontSize: 11.5,
          }}
        >
          {status === 'unreadable'
            ? 'Mother meter marked unreadable/defective — computing theoretical orifice volume per blow-off point (Q = μA√(2ΔP/ρ), V = Q·t).'
            : 'Area has no existing mother meter — computing theoretical orifice volume per blow-off point (Q = μA√(2ΔP/ρ), V = Q·t).'}
        </div>
      )}

      {/* Per Blow-Off Point Rows */}
      {fields.blowOffs.map((bo, idx) => {
        const pt = summary.blowOffPoints[idx];
        const muVal = bo.dischargeCoeff?.trim() || String(DEFAULT_DISCHARGE_COEFF);
        const showCustomMu = Boolean(customMuRows[idx] || !presetMus.has(muVal));

        if (!isOrificeMode) {
          return (
            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr auto', gap: 6, alignItems: 'end' }}>
              <input
                className="input"
                placeholder="Point name"
                value={bo.name}
                onChange={(e) => patchBlowOff(idx, { name: e.target.value })}
              />
              <input
                className="input"
                type="number"
                step="0.01"
                placeholder="Initial"
                value={bo.initialRead}
                onChange={(e) => patchBlowOff(idx, { initialRead: e.target.value })}
              />
              <input
                className="input"
                type="number"
                step="0.01"
                placeholder="Final"
                value={bo.finalRead}
                onChange={(e) => patchBlowOff(idx, { finalRead: e.target.value })}
              />
              {fields.blowOffs.length > 1 && (
                <button
                  type="button"
                  className="btn"
                  style={{ minHeight: 38, padding: '0 8px', color: 'var(--danger)' }}
                  onClick={() =>
                    setFields((prev) => ({
                      ...prev,
                      blowOffs: prev.blowOffs.filter((_, i) => i !== idx),
                    }))
                  }
                >
                  ✕
                </button>
              )}
            </div>
          );
        }

        return (
          <div
            key={idx}
            style={{
              padding: 9,
              borderRadius: 8,
              border: '1px solid var(--border-light)',
              background: 'var(--surface-muted)',
              display: 'grid',
              gap: 7,
            }}
          >
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                className="input"
                placeholder={`Blow-off ${idx + 1} location/name`}
                value={bo.name}
                onChange={(e) => patchBlowOff(idx, { name: e.target.value })}
                style={{ flex: 1 }}
              />
              {pt?.orifice && (
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--info-fg)', whiteSpace: 'nowrap' }}>
                  {pt.orifice.totalVolumeM3.toFixed(2)} m³
                </span>
              )}
              {fields.blowOffs.length > 1 && (
                <button
                  type="button"
                  className="btn"
                  style={{ minHeight: 34, padding: '0 8px', color: 'var(--danger)' }}
                  onClick={() =>
                    setFields((prev) => ({
                      ...prev,
                      blowOffs: prev.blowOffs.filter((_, i) => i !== idx),
                    }))
                  }
                >
                  ✕
                </button>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Blow-Off Diameter d (mm)
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="e.g. 50"
                  value={bo.diameterMm ?? ''}
                  onChange={(e) => patchBlowOff(idx, { diameterMm: e.target.value })}
                />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Residual Pressure (PSI)
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="e.g. 30"
                  value={bo.pressurePsi ?? ''}
                  onChange={(e) => patchBlowOff(idx, { pressurePsi: e.target.value })}
                />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Discharge Coeff. (μ)
                <select
                  className="input"
                  value={showCustomMu ? '__custom' : muVal}
                  onChange={(e) => {
                    if (e.target.value === '__custom') {
                      setCustomMuRows((prev) => ({ ...prev, [idx]: true }));
                      return;
                    }
                    setCustomMuRows((prev) => ({ ...prev, [idx]: false }));
                    patchBlowOff(idx, { dischargeCoeff: e.target.value });
                  }}
                >
                  {FLUSHING_DISCHARGE_COEFF_PRESETS.map((p) => (
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
              {FLUSHING_BORE_PRESETS_MM.map((preset) => (
                <button
                  key={preset.mm}
                  type="button"
                  className="btn"
                  onClick={() => patchBlowOff(idx, { diameterMm: preset.mm })}
                  style={{
                    minHeight: 24,
                    padding: '1px 7px',
                    fontSize: 11,
                    fontWeight: bo.diameterMm === preset.mm ? 700 : 500,
                    background: bo.diameterMm === preset.mm ? 'var(--info-bg)' : 'var(--surface)',
                    color: bo.diameterMm === preset.mm ? 'var(--info-fg)' : 'var(--text-secondary)',
                  }}
                >
                  {preset.mm}mm ({preset.label})
                </button>
              ))}
            </div>

            {showCustomMu && (
              <label style={{ display: 'grid', gap: 3, fontSize: 12, maxWidth: 180 }}>
                Custom μ (0.01 – 1.00)
                <input
                  className="input"
                  type="number"
                  min="0.01"
                  max="1"
                  step="0.01"
                  value={bo.dischargeCoeff ?? ''}
                  onChange={(e) => patchBlowOff(idx, { dischargeCoeff: e.target.value })}
                />
              </label>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Start Time
                <input
                  className="input"
                  type="time"
                  value={bo.startTime ?? ''}
                  onChange={(e) => updatePointTimes(idx, e.target.value, bo.endTime ?? '')}
                />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                End Time
                <input
                  className="input"
                  type="time"
                  value={bo.endTime ?? ''}
                  onChange={(e) => updatePointTimes(idx, bo.startTime ?? '', e.target.value)}
                />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                Duration (min)
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="e.g. 44"
                  value={bo.durationMinutes ?? ''}
                  onChange={(e) => patchBlowOff(idx, { durationMinutes: e.target.value })}
                />
              </label>
            </div>

            {pt?.orifice && (
              <div style={{ fontSize: 11, color: 'var(--info-fg)' }}>
                Q = {pt.orifice.flowM3PerSec.toFixed(4)} m³/s ({pt.orifice.flowLps.toFixed(2)} L/s) · A ={' '}
                {pt.orifice.areaM2.toFixed(4)} m² · ΔP = {pt.orifice.deltaPa.toFixed(2)} Pa · t ={' '}
                {pt.orifice.durationMinutes} min ({pt.orifice.durationHours.toFixed(2)} hrs)
              </div>
            )}
          </div>
        );
      })}

      {/* Aggregate Theoretical Volume Summary */}
      {isOrificeMode && summary.totalVolumeM3 !== null && (
        <div
          style={{
            padding: '8px 10px',
            borderRadius: 6,
            background: 'var(--info-bg)',
            color: 'var(--info-fg)',
            fontSize: 12,
            display: 'grid',
            gap: 2,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <strong>Total Theoretical Flushing Volume: {summary.totalVolumeM3.toFixed(2)} m³</strong>
            <span>{summary.computedPointCount} of {summary.blowOffPoints.length} point(s) computed</span>
          </div>
          {summary.hasHighPressureDropWarning && (
            <div style={{ fontSize: 11, color: 'var(--warn-fg)' }}>
              Note: Verify residual operating pressure right at the open blow-off — static system pressure on ≥40 mm outlets overestimates discharge when main pressure drops during flushing.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
