'use client';

import type { MutableRefObject } from 'react';
import type { computeMeterTestResult } from '@/lib/activity-types';
import {
  isMeterFieldActivity,
  type ActivityDetailFieldsState,
} from '@/lib/activity-logger-details';
import WellPulloutFields from '@/components/WellPulloutFields';
import TankCleaningFields from '@/components/TankCleaningFields';
import LeakRepairFields from '@/components/LeakRepairFields';
import FlushingFields from '@/components/FlushingFields';
import FuelActivityFields from '@/components/FuelActivityFields';
import ChlorineRefillFields from '@/components/ChlorineRefillFields';
import GensetMonitoringFields from '@/components/GensetMonitoringFields';
import { isFuelActivityType } from '@/lib/fuel-activities';

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
        <GensetMonitoringFields fields={fields} setFields={setFields} />
      )}

      {activityType === 'pump_monitoring' && (
        <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: 'var(--info-border)' }}>
          <strong style={{ fontSize: 12.5, color: 'var(--accent)' }}>Pump House Readings</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, alignItems: 'end' }}>
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

      {activityType === 'flushing' && <FlushingFields fields={fields} setFields={setFields} />}

      {isFuelActivityType(activityType) && (
        <FuelActivityFields
          activityType={activityType}
          fields={fields}
          setFields={setFields}
          leadOpName={leadOpName}
        />
      )}

      {activityType === 'meter_test' && (
        <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: 'var(--violet-border)' }}>
          <strong style={{ fontSize: 12.5, color: 'var(--violet-fg)' }}>Volumetric Meter Calibration Test</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, alignItems: 'end' }}>
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
          <div className="grid-2" style={{ gap: 8, alignItems: 'end' }}>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Witnessed By
              <input className="input" value={fields.witnessedBy} onChange={(e) => patch({ witnessedBy: e.target.value })} placeholder="Customer / rep name" />
            </label>
            <div style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Witness Signature</span>
                <button
                  type="button"
                  style={{ background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', minHeight: 34, padding: '4px 8px' }}
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
          <div className="grid-2" style={{ gap: 8, alignItems: 'end' }}>
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
          <div className="grid-2" style={{ gap: 8, alignItems: 'end' }}>
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

      {(activityType === 'leak_repair' || activityType === 'leak_detection' || activityType === 'valve_replacement') && (
        <LeakRepairFields activityType={activityType} fields={fields} setFields={setFields} />
      )}

      {(activityType === 'low_pressure' || activityType === 'no_water_supply') && (
        <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: 'var(--info-border)' }}>
          <strong style={{ fontSize: 12.5, color: 'var(--accent)' }}>
            {activityType === 'low_pressure' ? 'Low Pressure Inspection Details' : 'No Water Supply Investigation Details'}
          </strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, alignItems: 'end' }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Account # (12-char auto-parse)
              <input className="input" value={fields.accountNumber} onChange={(e) => patch({ accountNumber: e.target.value })} placeholder="Optional 12-char account #" />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Account Name
              <input className="input" value={fields.accountName} onChange={(e) => patch({ accountName: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Observed Line Pressure (PSI)
              <input className="input" type="number" step="0.1" value={fields.pressurePsi} onChange={(e) => patch({ pressurePsi: e.target.value })} placeholder="e.g. 12.5" />
            </label>
          </div>
        </div>
      )}

      {activityType === 'tankering' && (
        <div className="card" style={{ padding: 10, display: 'grid', gap: 8, borderColor: 'var(--violet-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 12.5, color: 'var(--violet-fg)' }}>Water Hauling / Tanker Log</strong>
            <button
              type="button"
              className="btn btn-add"
              style={{ minHeight: 30, padding: '3px 10px', fontSize: 12 }}
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, alignItems: 'end' }}>
            <input className="input" placeholder="Vehicle Type" value={fields.vehicleType} onChange={(e) => patch({ vehicleType: e.target.value })} />
            <input className="input" placeholder="Plate #" value={fields.plateNumber} onChange={(e) => patch({ plateNumber: e.target.value })} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Driver: <strong>{leadOpName || 'Auto-filled from Lead Operator above'}</strong>
          </div>
          {fields.haulingCycles.map((c, idx) => (
            <div key={idx} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <input
                className="input"
                aria-label={`Trip ${idx + 1} source location`}
                style={{ flex: '1 1 140px', minWidth: 0 }}
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
                aria-label={`Trip ${idx + 1} delivery location`}
                style={{ flex: '1 1 140px', minWidth: 0 }}
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
                aria-label={`Trip ${idx + 1} volume in m³`}
                style={{ flex: '0 1 100px', minWidth: 80 }}
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
              {fields.haulingCycles.length > 1 && (
                <button
                  type="button"
                  className="btn btn-sm btn-danger-soft"
                  aria-label={`Remove trip cycle ${idx + 1}`}
                  onClick={() =>
                    setFields((prev) => ({
                      ...prev,
                      haulingCycles: prev.haulingCycles.filter((_, i) => i !== idx),
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

      {activityType === 'chlorine_refill' && <ChlorineRefillFields fields={fields} setFields={setFields} />}

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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, alignItems: 'end' }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Duration (mins, auto from time)
              <input
                className="input"
                type="text"
                inputMode="numeric"
                value={fields.backwashDurationMin}
                readOnly
                aria-readonly="true"
                tabIndex={-1}
                placeholder="Auto from start & end time"
                style={{ background: 'var(--surface-muted)', color: 'var(--text-secondary)', cursor: 'not-allowed' }}
              />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Pressure In — Before Backwash (PSI) *
              <input
                className="input"
                type="number"
                step="0.1"
                min="0"
                required
                placeholder="e.g. 35"
                value={fields.backwashPressureInPsi}
                onChange={(e) => patch({ backwashPressureInPsi: e.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Pressure Out — Before Backwash (PSI) *
              <input
                className="input"
                type="number"
                step="0.1"
                min="0"
                required
                placeholder="e.g. 22"
                value={fields.backwashPressureOutPsi}
                onChange={(e) => patch({ backwashPressureOutPsi: e.target.value })}
              />
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
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Product Turbidity — Start (NTU) *
              <input
                className="input"
                type="number"
                step="0.01"
                min="0"
                required
                placeholder="e.g. 1.25"
                value={fields.productTurbidityStartNtu}
                onChange={(e) => patch({ productTurbidityStartNtu: e.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Product Turbidity — End (NTU) *
              <input
                className="input"
                type="number"
                step="0.01"
                min="0"
                required
                placeholder="e.g. 0.45"
                value={fields.productTurbidityEndNtu}
                onChange={(e) => patch({ productTurbidityEndNtu: e.target.value })}
              />
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, alignItems: 'end' }}>
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
