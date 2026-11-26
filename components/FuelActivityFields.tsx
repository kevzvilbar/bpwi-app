'use client';

import {
  computeTotalDistributedLiters,
  type FuelActivitiesFormState,
  type FuelDistributionStop,
  type FuelType,
  type GensetRefillSource,
} from '@/lib/fuel-activities';
import type { ActivityDetailFieldsState } from '@/lib/activity-logger-details';

interface FuelActivityFieldsProps {
  activityType: string;
  fields: ActivityDetailFieldsState;
  setFields: React.Dispatch<React.SetStateAction<ActivityDetailFieldsState>>;
  leadOpName?: string;
}

const TITLES: Record<string, string> = {
  vehicle_fueling: 'Vehicle Refueling Details',
  genset_fuel_purchase: 'Genset Fuel Purchase Details',
  genset_fuel_distribution: 'Genset Fuel Distribution to Areas',
  genset_fuel_refill: 'Genset Fuel Refilling Details',
};

/**
 * Form section for Vehicle Refueling, Genset Fuel Purchase,
 * Genset Fuel Distribution, and Genset Fuel Refilling.
 */
export default function FuelActivityFields({
  activityType,
  fields,
  setFields,
  leadOpName,
}: FuelActivityFieldsProps) {
  const fuel = fields.fuel;
  const patchTop = (updates: Partial<ActivityDetailFieldsState>) =>
    setFields((prev) => ({ ...prev, ...updates }));
  const patchFuel = (updates: Partial<FuelActivitiesFormState>) =>
    setFields((prev) => ({ ...prev, fuel: { ...prev.fuel, ...updates } }));
  const patchStop = (idx: number, updates: Partial<FuelDistributionStop>) =>
    setFields((prev) => ({
      ...prev,
      fuel: {
        ...prev.fuel,
        fuelDistributions: prev.fuel.fuelDistributions.map((s, i) =>
          i === idx ? { ...s, ...updates } : s,
        ),
      },
    }));

  const distSummary =
    activityType === 'genset_fuel_distribution'
      ? computeTotalDistributedLiters(fuel.fuelDistributions)
      : null;

  const isVehicle = activityType === 'vehicle_fueling';
  const isPurchase = activityType === 'genset_fuel_purchase';
  const isDist = activityType === 'genset_fuel_distribution';
  const isRefill = activityType === 'genset_fuel_refill';

  return (
    <div
      className="card"
      style={{
        padding: 10,
        display: 'grid',
        gap: 8,
        borderColor: isVehicle ? 'var(--teal)' : 'var(--warn-border)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 12.5, color: isVehicle ? 'var(--teal)' : 'var(--warn-fg)' }}>
          {TITLES[activityType] ?? 'Fuel Activity Details'}
        </strong>
        {isDist && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {distSummary && distSummary.totalLiters > 0 && (
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
                Total: {distSummary.totalLiters} L ({distSummary.validStopCount} site{distSummary.validStopCount === 1 ? '' : 's'})
              </span>
            )}
            <button
              type="button"
              className="btn btn-add btn-sm"
              style={{ minHeight: 36 }}
              onClick={() =>
                patchFuel({
                  fuelDistributions: [
                    ...fuel.fuelDistributions,
                    { destinationSite: '', liters: '', containerNote: '' },
                  ],
                })
              }
            >
              + Add Area / Genset
            </button>
          </div>
        )}
      </div>

      {/* Vehicle Refueling */}
      {isVehicle && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Vehicle / Unit
              <input
                className="input"
                placeholder="e.g. Service Pickup / Elf"
                value={fields.vehicleType}
                onChange={(e) => patchTop({ vehicleType: e.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Plate #
              <input
                className="input"
                placeholder="e.g. ABC-1234"
                value={fields.plateNumber}
                onChange={(e) => patchTop({ plateNumber: e.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Fuel Type
              <select
                className="input"
                value={fuel.fuelType}
                onChange={(e) => patchFuel({ fuelType: e.target.value as FuelType })}
              >
                <option value="Diesel">Diesel</option>
                <option value="Gasoline">Gasoline</option>
              </select>
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Liters Added (L)
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 35.5"
                value={fuel.litersAmount}
                onChange={(e) => patchFuel({ litersAmount: e.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Odometer (km, opt.)
              <input
                className="input"
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 48210"
                value={fuel.odometerKm}
                onChange={(e) => patchFuel({ odometerKm: e.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Fuel Station / Supplier
              <input
                className="input"
                placeholder="e.g. Petron Pavia"
                value={fuel.supplierStation}
                onChange={(e) => patchFuel({ supplierStation: e.target.value })}
              />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Receipt / PO / Slip # (opt.)
              <input
                className="input"
                placeholder="e.g. OR-10452"
                value={fuel.receiptNumber}
                onChange={(e) => patchFuel({ receiptNumber: e.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Total Amount (Php, opt.)
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 2100.00"
                value={fuel.totalCostPhp}
                onChange={(e) => patchFuel({ totalCostPhp: e.target.value })}
              />
            </label>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Driver / Personnel: <strong>{leadOpName || 'Auto-filled from Lead Operator above'}</strong>
          </div>
        </>
      )}

      {/* Genset Fuel Purchase */}
      {isPurchase && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Fuel Type
              <select
                className="input"
                value={fuel.fuelType}
                onChange={(e) => patchFuel({ fuelType: e.target.value as FuelType })}
              >
                <option value="Diesel">Diesel</option>
                <option value="Gasoline">Gasoline</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Liters Purchased (L)
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 200"
                value={fuel.litersAmount}
                onChange={(e) => patchFuel({ litersAmount: e.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Containers / Drums
              <input
                className="input"
                placeholder="e.g. 1 drum / 4 jerrycans"
                value={fuel.containerDescription}
                onChange={(e) => patchFuel({ containerDescription: e.target.value })}
              />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Gas Station / Supplier
              <input
                className="input"
                placeholder="e.g. Shell Sta. Barbara"
                value={fuel.supplierStation}
                onChange={(e) => patchFuel({ supplierStation: e.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Receipt / PO / Slip # (opt.)
              <input
                className="input"
                placeholder="e.g. PO-2026-081"
                value={fuel.receiptNumber}
                onChange={(e) => patchFuel({ receiptNumber: e.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Total Amount (Php, opt.)
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 11800.00"
                value={fuel.totalCostPhp}
                onChange={(e) => patchFuel({ totalCostPhp: e.target.value })}
              />
            </label>
          </div>
        </>
      )}

      {/* Genset Fuel Distribution to Areas */}
      {isDist && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Fuel Type
              <select
                className="input"
                value={fuel.fuelType}
                onChange={(e) => patchFuel({ fuelType: e.target.value as FuelType })}
              >
                <option value="Diesel">Diesel</option>
                <option value="Gasoline">Gasoline</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Transport Vehicle (opt.)
              <input
                className="input"
                placeholder="e.g. Utility Truck"
                value={fields.vehicleType}
                onChange={(e) => patchTop({ vehicleType: e.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Plate # (opt.)
              <input
                className="input"
                placeholder="e.g. XYZ-789"
                value={fields.plateNumber}
                onChange={(e) => patchTop({ plateNumber: e.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              Batch / Drum Note (opt.)
              <input
                className="input"
                placeholder="e.g. 5 jerrycans from Base HQ"
                value={fuel.containerDescription}
                onChange={(e) => patchFuel({ containerDescription: e.target.value })}
              />
            </label>
          </div>

          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)' }}>
              Area / Genset Drops
            </span>
            {fuel.fuelDistributions.map((stop, idx) => (
              <div
                key={idx}
                style={{
                  padding: 8,
                  borderRadius: 8,
                  border: '1px solid var(--border-light)',
                  background: 'var(--surface-muted)',
                  display: 'grid',
                  gap: 6,
                }}
              >
                {fuel.fuelDistributions.length > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
                      Drop #{idx + 1}
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger-soft"
                      aria-label={`Remove drop ${idx + 1}`}
                      style={{ minHeight: 36 }}
                      onClick={() =>
                        patchFuel({
                          fuelDistributions: fuel.fuelDistributions.filter((_, i) => i !== idx),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                )}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                    gap: 6,
                    alignItems: 'center',
                  }}
                >
                  <input
                    className="input"
                    placeholder="Area / Genset site (e.g. Well 2 Genset)"
                    value={stop.destinationSite}
                    onChange={(e) => patchStop(idx, { destinationSite: e.target.value })}
                  />
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="Liters"
                    value={stop.liters}
                    onChange={(e) => patchStop(idx, { liters: e.target.value })}
                  />
                  <input
                    className="input"
                    placeholder="Container / Received by (opt.)"
                    value={stop.containerNote}
                    onChange={(e) => patchStop(idx, { containerNote: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Genset Fuel Refilling */}
      {isRefill && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
          <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
            Fuel Source
            <select
              className="input"
              value={fuel.fuelSource}
              onChange={(e) => patchFuel({ fuelSource: e.target.value as GensetRefillSource })}
            >
              <option value="Stock Drum / Container">Stock Drum / Container</option>
              <option value="Direct Purchase">Direct Purchase</option>
              <option value="Transferred">Transferred</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
            Fuel Type
            <select
              className="input"
              value={fuel.fuelType}
              onChange={(e) => patchFuel({ fuelType: e.target.value as FuelType })}
            >
              <option value="Diesel">Diesel</option>
              <option value="Gasoline">Gasoline</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
            Fuel Level Before (L / %)
            <input
              className="input"
              type="number"
              min="0"
              step="0.1"
              placeholder="e.g. 25"
              value={fuel.fuelBefore}
              onChange={(e) => patchFuel({ fuelBefore: e.target.value })}
            />
          </label>
          <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
            Liters Refilled (L)
            <input
              className="input"
              type="number"
              min="0"
              step="0.1"
              placeholder="e.g. 60"
              value={fuel.litersAmount}
              onChange={(e) => patchFuel({ litersAmount: e.target.value })}
            />
          </label>
          <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
            Fuel Level After (L / %)
            <input
              className="input"
              type="number"
              min="0"
              step="0.1"
              placeholder="e.g. 85"
              value={fuel.fuelAfter}
              onChange={(e) => patchFuel({ fuelAfter: e.target.value })}
            />
          </label>
          <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
            Hour Meter Reading (opt.)
            <input
              className="input"
              type="number"
              min="0"
              step="0.1"
              placeholder="e.g. 1245.5"
              value={fuel.hourMeterReading}
              onChange={(e) => patchFuel({ hourMeterReading: e.target.value })}
            />
          </label>
        </div>
      )}
    </div>
  );
}
