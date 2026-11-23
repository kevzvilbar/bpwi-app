/**
 * Pure helpers and schemas for fleet & generator fuel workflow activities:
 * - Vehicle Refueling (`vehicle_fueling`)
 * - Genset Fuel Purchase (`genset_fuel_purchase`)
 * - Genset Fuel Distribution (`genset_fuel_distribution`)
 * - Genset Fuel Refilling (`genset_fuel_refill`)
 */

export type FuelType = 'Diesel' | 'Gasoline';
export type GensetRefillSource = 'Stock Drum / Container' | 'Direct Purchase' | 'Transferred';

export const FUEL_ACTIVITY_TYPES = new Set([
  'vehicle_fueling',
  'genset_fuel_purchase',
  'genset_fuel_distribution',
  'genset_fuel_refill',
]);

export interface FuelDistributionStop {
  destinationSite: string;
  liters: string;
  containerNote: string;
}

export interface FuelActivitiesFormState {
  fuelType: FuelType;
  litersAmount: string;
  fuelBefore: string;
  fuelAfter: string;
  hourMeterReading: string;
  fuelSource: GensetRefillSource;
  odometerKm: string;
  containerDescription: string;
  supplierStation: string;
  receiptNumber: string;
  totalCostPhp: string;
  fuelDistributions: FuelDistributionStop[];
}

export const INITIAL_FUEL_ACTIVITIES_STATE: FuelActivitiesFormState = {
  fuelType: 'Diesel',
  litersAmount: '',
  fuelBefore: '',
  fuelAfter: '',
  hourMeterReading: '',
  fuelSource: 'Stock Drum / Container',
  odometerKm: '',
  containerDescription: '',
  supplierStation: '',
  receiptNumber: '',
  totalCostPhp: '',
  fuelDistributions: [{ destinationSite: '', liters: '', containerNote: '' }],
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function numOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function isFuelActivityType(activityType: string): boolean {
  return FUEL_ACTIVITY_TYPES.has(activityType);
}

/** Sums valid positive/non-negative liters across fuel distribution stops. */
export function computeTotalDistributedLiters(
  stops: readonly FuelDistributionStop[],
): { totalLiters: number; validStopCount: number } {
  let sum = 0;
  let validStopCount = 0;
  for (const s of stops) {
    const n = numOrNull(s.liters);
    if (n !== null && n > 0) {
      sum += n;
      validStopCount += 1;
    } else if (s.destinationSite.trim()) {
      validStopCount += 1;
    }
  }
  return {
    totalLiters: Math.round(sum * 100) / 100,
    validStopCount,
  };
}

/** Hydrates fuel activity details safely from JSONB with fresh array instances. */
export function hydrateFuelActivitiesDetails(d: Record<string, unknown>): FuelActivitiesFormState {
  const next: FuelActivitiesFormState = {
    ...INITIAL_FUEL_ACTIVITIES_STATE,
    fuelDistributions: [{ destinationSite: '', liters: '', containerNote: '' }],
  };

  if (d.fuelType === 'Diesel' || d.fuelType === 'Gasoline') next.fuelType = d.fuelType;
  const rawLiters = d.litersAdded ?? d.litersPurchased;
  if (rawLiters != null) next.litersAmount = String(rawLiters);
  if (d.fuelBefore != null) next.fuelBefore = String(d.fuelBefore);
  if (d.fuelAfter != null) next.fuelAfter = String(d.fuelAfter);
  if (d.hourMeterReading != null) next.hourMeterReading = String(d.hourMeterReading);
  if (
    d.fuelSource === 'Stock Drum / Container' ||
    d.fuelSource === 'Direct Purchase' ||
    d.fuelSource === 'Transferred'
  ) {
    next.fuelSource = d.fuelSource;
  }
  if (d.odometerKm != null) next.odometerKm = String(d.odometerKm);
  if (d.containerDescription) next.containerDescription = String(d.containerDescription);
  if (d.supplierStation) next.supplierStation = String(d.supplierStation);
  if (d.receiptNumber) next.receiptNumber = String(d.receiptNumber);
  if (d.totalCostPhp != null) next.totalCostPhp = String(d.totalCostPhp);

  if (Array.isArray(d.fuelDistributions) && d.fuelDistributions.length > 0) {
    const mapped = d.fuelDistributions.filter(isRecord).map((row) => ({
      destinationSite: typeof row.destinationSite === 'string' ? row.destinationSite : '',
      liters: row.liters != null ? String(row.liters) : '',
      containerNote: typeof row.containerNote === 'string' ? row.containerNote : '',
    }));
    if (mapped.length > 0) next.fuelDistributions = mapped;
  }

  return next;
}

/** Serializes the `details` JSONB payload for any of the 4 fuel workflow activities. */
export function buildFuelActivityPayload(
  activityType: string,
  f: FuelActivitiesFormState,
  vehicle: { vehicleType: string; plateNumber: string; driverName: string },
): Record<string, unknown> {
  if (activityType === 'vehicle_fueling') {
    return {
      vehicleType: vehicle.vehicleType.trim() || null,
      plateNumber: vehicle.plateNumber.trim() || null,
      driverName: vehicle.driverName.trim() || null,
      fuelType: f.fuelType,
      litersAdded: numOrNull(f.litersAmount),
      odometerKm: numOrNull(f.odometerKm),
      supplierStation: f.supplierStation.trim() || null,
      receiptNumber: f.receiptNumber.trim() || null,
      totalCostPhp: numOrNull(f.totalCostPhp),
    };
  }
  if (activityType === 'genset_fuel_purchase') {
    return {
      fuelType: f.fuelType,
      litersPurchased: numOrNull(f.litersAmount),
      containerDescription: f.containerDescription.trim() || null,
      supplierStation: f.supplierStation.trim() || null,
      receiptNumber: f.receiptNumber.trim() || null,
      totalCostPhp: numOrNull(f.totalCostPhp),
    };
  }
  if (activityType === 'genset_fuel_distribution') {
    const validStops = f.fuelDistributions.filter(
      (s) => s.destinationSite.trim() || s.liters.trim() || s.containerNote.trim(),
    );
    const { totalLiters } = computeTotalDistributedLiters(validStops);
    return {
      fuelType: f.fuelType,
      vehicleType: vehicle.vehicleType.trim() || null,
      plateNumber: vehicle.plateNumber.trim() || null,
      driverName: vehicle.driverName.trim() || null,
      containerDescription: f.containerDescription.trim() || null,
      totalDistributedLiters: totalLiters > 0 ? totalLiters : null,
      fuelDistributions: validStops.map((s) => ({
        destinationSite: s.destinationSite.trim(),
        liters: numOrNull(s.liters),
        containerNote: s.containerNote.trim() || null,
      })),
    };
  }
  if (activityType === 'genset_fuel_refill') {
    return {
      fuelType: f.fuelType,
      fuelSource: f.fuelSource,
      fuelBefore: numOrNull(f.fuelBefore),
      litersAdded: numOrNull(f.litersAmount),
      fuelAfter: numOrNull(f.fuelAfter),
      hourMeterReading: numOrNull(f.hourMeterReading),
    };
  }
  return {};
}
