'use client';

import type { MutableRefObject } from 'react';
import type { computeMeterTestResult } from '@/lib/activity-types';
import {
  isMeterFieldActivity,
  type ActivityDetailFieldsState,
} from '@/lib/activity-logger-details';
import WellPulloutFields from '@/components/WellPulloutFields';
import TankCleaningFields from '@/components/TankCleaningFields';

interface ActivityCategoryFieldsProps {
  activityType: string;
  fields: ActivityDetailFieldsState;
  setFields: React.Dispatch<React.SetStateAction<ActivityDetailFieldsState>>;
  meterCalc: ReturnType<typeof computeMeterTestResult>;
  sigCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  sigDrawingRef: MutableRefObject<boolean>;
  setHasSignature: (v: boolean) => void;
  activityDate?: string;
  leadOpName?: string;
  performedBySummary?: string;
}

export default function ActivityCategoryFields({
  activityType,
  fields,
  setFields,
  meterCalc,
  sigCanvasRef,
  sigDrawingRef,
  setHasSignature,
  activityDate,
  leadOpName,
  performedBySummary,
}: ActivityCategoryFieldsProps) {
  const patch = (updates: Partial<ActivityDetailFieldsState>) =>
    setFields((prev) => ({ ...prev, ...updates }));

  function getCanvasCoords(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = sigCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  return (
    <>
      {activityType === 'genset_monitoring' && (
        <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: 'var(--warn-border)' }}>
          <strong style={{ fontSize: 12.5, color: 'var(--warn-fg)' }}>Genset Monitoring Telemetry</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Initial Fuel (L / %)
              <input className="input" type="number" step="0.1" value={fields.gensetInitialFuel} onChange={(e) => patch({ gensetInitialFuel: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Final Fuel (L / %)
              <input className="input" type="number" step="0.1" value={fields.gensetFinalFuel} onChange={(e) => patch({ gensetFinalFuel: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Running Hours
              <input className="input" type="number" step="0.1" value={fields.runningHours} onChange={(e) => patch({ runningHours: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Run Cause
              <select
                className="input"
                value={fields.gensetCause}
                onChange={(e) => patch({ gensetCause: e.target.value as ActivityDetailFieldsState['gensetCause'] })}
              >
                <option value="Routine">Routine Test</option>
                <option value="Power Outage">Power Outage</option>
                <option value="PMS">PMS</option>
              </select>
            </label>
          </div>
        </div>
      )}

      {activityType === 'pump_monitoring' && (
        <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: 'var(--info-border)' }}>
          <strong style={{ fontSize: 12.5, color: 'var(--accent)' }}>Pump House Readings</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Pressure (PSI)
              <input className="input" type="number" step="0.1" value={fields.pressurePsi} onChange={(e) => patch({ pressurePsi: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Flow (LPS)
              <input className="input" type="number" step="0.1" value={fields.flowLps} onChange={(e) => patch({ flowLps: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Totalizer (m³)
              <input className="input" type="number" step="0.01" value={fields.totalizerReading} onChange={(e) => patch({ totalizerReading: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Chlorine Res. (mg/L)
              <input className="input" type="number" step="0.01" value={fields.chlorineResidual} onChange={(e) => patch({ chlorineResidual: e.target.value })} />
            </label>
          </div>
        </div>
      )}

      {activityType === 'flushing' && (
        <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: 'var(--info-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 12.5, color: 'var(--accent)' }}>Line Flushing &amp; Blow-Off Readings</strong>
            <button
              type="button"
              className="btn"
              style={{ minHeight: 28, padding: '2px 8px', fontSize: 11.5 }}
              onClick={() =>
                setFields((prev) => ({
                  ...prev,
                  blowOffs: [...prev.blowOffs, { name: `Blow-off ${prev.blowOffs.length + 1}`, initialRead: '', finalRead: '' }],
                }))
              }
            >
              + Add Point
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Main Meter Initial (m³)
              <input className="input" type="number" step="0.01" value={fields.flushingInitialRead} onChange={(e) => patch({ flushingInitialRead: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Main Meter Final (m³)
              <input className="input" type="number" step="0.01" value={fields.flushingFinalRead} onChange={(e) => patch({ flushingFinalRead: e.target.value })} />
            </label>
          </div>
          {fields.blowOffs.map((bo, idx) => (
            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr auto', gap: 6, alignItems: 'end' }}>
              <input
                className="input"
                placeholder="Point name"
                value={bo.name}
                onChange={(e) =>
                  setFields((prev) => ({
                    ...prev,
                    blowOffs: prev.blowOffs.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)),
                  }))
                }
              />
              <input
                className="input"
                type="number"
                step="0.01"
                placeholder="Initial"
                value={bo.initialRead}
                onChange={(e) =>
                  setFields((prev) => ({
                    ...prev,
                    blowOffs: prev.blowOffs.map((x, i) => (i === idx ? { ...x, initialRead: e.target.value } : x)),
                  }))
                }
              />
              <input
                className="input"
                type="number"
                step="0.01"
                placeholder="Final"
                value={bo.finalRead}
                onChange={(e) =>
                  setFields((prev) => ({
                    ...prev,
                    blowOffs: prev.blowOffs.map((x, i) => (i === idx ? { ...x, finalRead: e.target.value } : x)),
                  }))
                }
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
          ))}
        </div>
      )}

      {activityType === 'meter_test' && (
        <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: 'var(--violet-border)' }}>
          <strong style={{ fontSize: 12.5, color: 'var(--violet-fg)' }}>Volumetric Meter Calibration Test</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Account # (12-char auto-parse)
              <input className="input" value={fields.accountNumber} onChange={(e) => patch({ accountNumber: e.target.value })} placeholder="e.g. 001002003004" />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Account Name
              <input className="input" value={fields.accountName} onChange={(e) => patch({ accountName: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Meter Brand
              <input className="input" value={fields.meterBrand} onChange={(e) => patch({ meterBrand: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Serial #
              <input className="input" value={fields.meterSerialNumber} onChange={(e) => patch({ meterSerialNumber: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Size
              <input className="input" value={fields.meterSize} onChange={(e) => patch({ meterSize: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Ref. Vol (m³)
              <input className="input" type="number" step="0.001" value={fields.refVolumeM3} onChange={(e) => patch({ refVolumeM3: e.target.value })} />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
            <label style={{ display: 'grid', gap: 2, fontSize: 11.5 }}>
              Initial
              <input className="input" type="number" step="0.0001" value={fields.initialReading} onChange={(e) => patch({ initialReading: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 2, fontSize: 11.5 }}>
              Trial 1
              <input className="input" type="number" step="0.0001" value={fields.reading1} onChange={(e) => patch({ reading1: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 2, fontSize: 11.5 }}>
              Trial 2
              <input className="input" type="number" step="0.0001" value={fields.reading2} onChange={(e) => patch({ reading2: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 2, fontSize: 11.5 }}>
              Trial 3
              <input className="input" type="number" step="0.0001" value={fields.reading3} onChange={(e) => patch({ reading3: e.target.value })} />
            </label>
          </div>
          {meterCalc.avgErr !== null && (
            <div
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                background: meterCalc.verdict === 'Passed' ? 'var(--ok-bg)' : 'var(--danger-bg)',
                color: meterCalc.verdict === 'Passed' ? 'var(--ok-fg)' : 'var(--danger-fg)',
                fontSize: 12.5,
                fontWeight: 700,
                display: 'flex',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <span>Avg Error: {meterCalc.avgErr}% ({meterCalc.verdict})</span>
              <span>Recommendation: {meterCalc.recommendation}</span>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Witnessed By
              <input className="input" value={fields.witnessedBy} onChange={(e) => patch({ witnessedBy: e.target.value })} placeholder="Customer / rep name" />
            </label>
            <div style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Witness Signature</span>
                <button
                  type="button"
                  style={{ background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: 11, cursor: 'pointer', padding: 0 }}
                  onClick={() => {
                    const cv = sigCanvasRef.current;
                    if (cv) cv.getContext('2d')?.clearRect(0, 0, cv.width, cv.height);
                    setHasSignature(false);
                  }}
                >
                  Clear
                </button>
              </div>
              <canvas
                ref={sigCanvasRef}
                width={260}
                height={76}
                style={{
                  width: '100%',
                  height: 76,
                  background: '#ffffff',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  touchAction: 'none',
                }}
                onPointerDown={(e) => {
                  const cv = sigCanvasRef.current;
                  const ctx = cv?.getContext('2d');
                  if (!cv || !ctx) return;
                  sigDrawingRef.current = true;
                  const pt = getCanvasCoords(e);
                  ctx.strokeStyle = '#0f172a';
                  ctx.lineWidth = 2;
                  ctx.lineCap = 'round';
                  ctx.beginPath();
                  ctx.moveTo(pt.x, pt.y);
                  setHasSignature(true);
                }}
                onPointerMove={(e) => {
                  if (!sigDrawingRef.current) return;
                  const ctx = sigCanvasRef.current?.getContext('2d');
                  if (!ctx) return;
                  const pt = getCanvasCoords(e);
                  ctx.lineTo(pt.x, pt.y);
                  ctx.stroke();
                }}
                onPointerUp={() => {
                  sigDrawingRef.current = false;
                }}
                onPointerLeave={() => {
                  sigDrawingRef.current = false;
                }}
              />
            </div>
          </div>
        </div>
      )}

      {isMeterFieldActivity(activityType) && (
        <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: 'var(--ok-border)' }}>
          <strong style={{ fontSize: 12.5, color: 'var(--ok-fg)' }}>Customer &amp; Meter Details</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Account # (12-char auto-parse)
              <input className="input" value={fields.accountNumber} onChange={(e) => patch({ accountNumber: e.target.value })} placeholder="e.g. 001002003004" />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Account Name
              <input className="input" value={fields.accountName} onChange={(e) => patch({ accountName: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Meter Running?
              <select className="input" value={fields.isMeterRunning} onChange={(e) => patch({ isMeterRunning: e.target.value as 'Yes' | 'No' })}>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Needs Declogging?
              <select className="input" value={fields.needsDeclogging} onChange={(e) => patch({ needsDeclogging: e.target.value as 'No' | 'Yes' })}>
                <option value="No">No</option>
                <option value="Yes">Yes</option>
              </select>
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Old Brand / Serial
              <input className="input" value={fields.oldMeterSerial} onChange={(e) => patch({ oldMeterSerial: e.target.value })} placeholder="Serial #" />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Old Reading
              <input className="input" type="number" step="0.01" value={fields.oldMeterReading} onChange={(e) => patch({ oldMeterReading: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              New Brand / Serial
              <input className="input" value={fields.newMeterSerial} onChange={(e) => patch({ newMeterSerial: e.target.value })} placeholder="Serial #" />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              New Initial Read
              <input className="input" type="number" step="0.01" value={fields.newMeterReading} onChange={(e) => patch({ newMeterReading: e.target.value })} />
            </label>
          </div>
        </div>
      )}

      {(activityType === 'leak_repair' || activityType === 'leak_detection') && (
        <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: 'var(--danger-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 12.5, color: 'var(--danger)' }}>Leak Details &amp; Materials</strong>
            <button
              type="button"
              className="btn"
              style={{ minHeight: 28, padding: '2px 8px', fontSize: 11.5 }}
              onClick={() => setFields((prev) => ({ ...prev, usedMaterials: [...prev.usedMaterials, { item: '', qty: '1' }] }))}
            >
              + Material
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Pipe Size / Material
              <input className="input" value={fields.pipeSize} onChange={(e) => patch({ pipeSize: e.target.value })} placeholder='e.g. 2" uPVC' />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Leak Classification / Cause
              <input className="input" value={fields.leakType} onChange={(e) => patch({ leakType: e.target.value })} placeholder="e.g. Saddle clamp, joint" />
            </label>
          </div>
          {fields.usedMaterials.map((m, idx) => (
            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 90px auto', gap: 6 }}>
              <input
                className="input"
                placeholder="Material used (e.g. Coupling 2 inch)"
                value={m.item}
                onChange={(e) =>
                  setFields((prev) => ({
                    ...prev,
                    usedMaterials: prev.usedMaterials.map((x, i) => (i === idx ? { ...x, item: e.target.value } : x)),
                  }))
                }
              />
              <input
                className="input"
                placeholder="Qty"
                value={m.qty}
                onChange={(e) =>
                  setFields((prev) => ({
                    ...prev,
                    usedMaterials: prev.usedMaterials.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)),
                  }))
                }
              />
              <button
                type="button"
                className="btn"
                style={{ minHeight: 38, padding: '0 8px', color: 'var(--danger)' }}
                onClick={() =>
                  setFields((prev) => ({
                    ...prev,
                    usedMaterials: prev.usedMaterials.filter((_, i) => i !== idx),
                  }))
                }
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {activityType === 'tankering' && (
        <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: 'var(--violet-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 12.5, color: 'var(--violet-fg)' }}>Water Hauling / Tanker Log</strong>
            <button
              type="button"
              className="btn"
              style={{ minHeight: 28, padding: '2px 8px', fontSize: 11.5 }}
              onClick={() =>
                setFields((prev) => ({
                  ...prev,
                  haulingCycles: [
                    ...prev.haulingCycles,
                    { sourceLocation: '', deliveryLocation: '', volumeM3: '', loadingTime: '', injectionTime: '' },
                  ],
                }))
              }
            >
              + Trip Cycle
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input className="input" placeholder="Vehicle Type" value={fields.vehicleType} onChange={(e) => patch({ vehicleType: e.target.value })} />
            <input className="input" placeholder="Plate #" value={fields.plateNumber} onChange={(e) => patch({ plateNumber: e.target.value })} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Driver: <strong>{leadOpName || 'Auto-filled from Lead Operator above'}</strong>
          </div>
          {fields.haulingCycles.map((c, idx) => (
            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: 6 }}>
              <input
                className="input"
                placeholder="Source"
                value={c.sourceLocation}
                onChange={(e) =>
                  setFields((prev) => ({
                    ...prev,
                    haulingCycles: prev.haulingCycles.map((x, i) => (i === idx ? { ...x, sourceLocation: e.target.value } : x)),
                  }))
                }
              />
              <input
                className="input"
                placeholder="Delivery site"
                value={c.deliveryLocation}
                onChange={(e) =>
                  setFields((prev) => ({
                    ...prev,
                    haulingCycles: prev.haulingCycles.map((x, i) => (i === idx ? { ...x, deliveryLocation: e.target.value } : x)),
                  }))
                }
              />
              <input
                className="input"
                type="number"
                step="0.1"
                placeholder="m³"
                value={c.volumeM3}
                onChange={(e) =>
                  setFields((prev) => ({
                    ...prev,
                    haulingCycles: prev.haulingCycles.map((x, i) => (i === idx ? { ...x, volumeM3: e.target.value } : x)),
                  }))
                }
              />
            </div>
          ))}
        </div>
      )}

      {activityType === 'water_sampling' && (
        <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: 'var(--teal)' }}>
          <strong style={{ fontSize: 12.5, color: 'var(--teal)' }}>Water Quality / Chlorination Readings</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Free Cl₂ (mg/L)
              <input className="input" type="number" step="0.01" value={fields.chlorineResidual} onChange={(e) => patch({ chlorineResidual: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Turbidity (NTU)
              <input className="input" type="number" step="0.01" value={fields.turbidityNtu} onChange={(e) => patch({ turbidityNtu: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              pH Level
              <input className="input" type="number" step="0.1" value={fields.phLevel} onChange={(e) => patch({ phLevel: e.target.value })} />
            </label>
          </div>
        </div>
      )}

      {activityType === 'backwash' && (
        <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: 'var(--violet-border)' }}>
          <strong style={{ fontSize: 12.5, color: 'var(--violet-fg)' }}>MMF / Filter Backwash Telemetry</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Duration (mins, auto from time)
              <input className="input" type="number" step="1" value={fields.backwashDurationMin} onChange={(e) => patch({ backwashDurationMin: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Pressure (PSI)
              <input className="input" type="number" step="0.1" value={fields.pressurePsi} onChange={(e) => patch({ pressurePsi: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Discharge Clarity
              <select
                className="input"
                value={fields.waterClarity}
                onChange={(e) => patch({ waterClarity: e.target.value as ActivityDetailFieldsState['waterClarity'] })}
              >
                <option value="Clear">Clear</option>
                <option value="Slightly Turbid">Slightly Turbid</option>
                <option value="Turbid">Turbid</option>
              </select>
            </label>
          </div>
        </div>
      )}

      {activityType === 'thermal_scanning' && (
        <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: 'var(--warn-border)' }}>
          <strong style={{ fontSize: 12.5, color: 'var(--warn-fg)' }}>Thermal Scanning Readings</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Max Temp (°C)
              <input className="input" type="number" step="0.1" value={fields.maxTempC} onChange={(e) => patch({ maxTempC: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Hotspot Detected?
              <select className="input" value={fields.hotspotFound} onChange={(e) => patch({ hotspotFound: e.target.value as 'No' | 'Yes' })}>
                <option value="No">No (Normal)</option>
                <option value="Yes">Yes (Needs Attention)</option>
              </select>
            </label>
          </div>
        </div>
      )}

      {activityType === 'water_level_monitoring' && (
        <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: 'var(--warn-border)' }}>
          <strong style={{ fontSize: 12.5, color: 'var(--warn-fg)' }}>Well Water Level (SWL &amp; PWL)</strong>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Static Water Level — SWL (m)
              <input className="input" type="number" step="0.01" value={fields.swlMeters} onChange={(e) => patch({ swlMeters: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Pumping Water Level — PWL (m)
              <input className="input" type="number" step="0.01" value={fields.pwlMeters} onChange={(e) => patch({ pwlMeters: e.target.value })} />
            </label>
          </div>
        </div>
      )}

      {activityType === 'well_pull_out' && (
        <WellPulloutFields
          value={fields.wellPullout}
          onChange={(wellPullout) => patch({ wellPullout })}
          activityDate={activityDate}
          performedBySummary={performedBySummary}
        />
      )}

      {activityType === 'tank_cleaning' && (
        <TankCleaningFields
          value={fields.tankCleaning}
          onChange={(tankCleaning) => patch({ tankCleaning })}
          activityDate={activityDate}
          leadOpName={leadOpName ?? performedBySummary}
        />
      )}
    </>
  );
}
