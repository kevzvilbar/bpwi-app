import type { MeterTestCalculation } from '@/lib/activity-types';
import {
  INITIAL_WELL_PULLOUT_DETAILS,
  buildWellPulloutPayload,
  hydrateWellPulloutDetails,
  type WellPulloutFormDetails,
} from './well-pullout-types.ts';
import {
  INITIAL_TANK_CLEANING_DETAILS,
  buildTankCleaningPayload,
  hydrateTankCleaningDetails,
  type TankCleaningFormDetails,
} from './tank-cleaning-types.ts';
import {
  INITIAL_LEAK_LOSS_STATE,
  buildLeakLossPayload,
  hydrateLeakLossDetails,
  type LeakVolumeLossFormState,
} from './leak-volume-loss.ts';
import {
  computeFlushingVolume,
  hasBlowOffOrificeInputs,
  hydrateFlushingMeterStatus,
  type FlushingMeterStatus,
} from './flushing-volume.ts';
import {
  INITIAL_FUEL_ACTIVITIES_STATE,
  buildFuelActivityPayload,
  hydrateFuelActivitiesDetails,
  isFuelActivityType,
  type FuelActivitiesFormState,
} from './fuel-activities.ts';
import {
  CHLORINE_REFILL_ACTIVITY_TYPE,
  INITIAL_CHLORINE_REFILL_STATE,
  buildChlorineRefillPayload,
  hydrateChlorineRefillDetails,
  type ChlorineRefillFormState,
} from './chlorine-refill.ts';
import {
  INITIAL_GENSET_MONITORING_STATE,
  buildGensetMonitoringPayload,
  hydrateGensetMonitoringDetails,
  type GensetMonitoringFormState,
} from './genset-monitoring.ts';

export type { WellPulloutFormDetails } from './well-pullout-types.ts';
export { INITIAL_WELL_PULLOUT_DETAILS } from './well-pullout-types.ts';
export type { TankCleaningFormDetails } from './tank-cleaning-types.ts';
export { INITIAL_TANK_CLEANING_DETAILS } from './tank-cleaning-types.ts';
export type { LeakVolumeLossFormState } from './leak-volume-loss.ts';
export { INITIAL_LEAK_LOSS_STATE } from './leak-volume-loss.ts';
export type { FlushingMeterStatus } from './flushing-volume.ts';
export type { FuelActivitiesFormState, FuelDistributionStop } from './fuel-activities.ts';
export { INITIAL_FUEL_ACTIVITIES_STATE } from './fuel-activities.ts';
export type { GensetMonitoringFormState } from './genset-monitoring.ts';
export { INITIAL_GENSET_MONITORING_STATE } from './genset-monitoring.ts';

export interface BlowOffItem {
  name: string;
  initialRead: string;
  finalRead: string;
  diameterMm?: string;
  pressurePsi?: string;
  dischargeCoeff?: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: string;
}

export interface UsedMaterialItem {
  item: string;
  qty: string;
  unit?: string;
}

export interface HaulingCycleItem {
  sourceLocation: string;
  deliveryLocation: string;
  volumeM3: string;
  loadingTime: string;
  injectionTime: string;
}

export interface ActivityDetailFieldsState {
  // 1. Genset
  gensetInitialFuel: string;
  gensetFinalFuel: string;
  runningHours: string;
  gensetCause: 'Routine' | 'Power Outage' | 'PMS';
  genset: GensetMonitoringFormState;

  // 2. Pump Monitoring
  pressurePsi: string;
  flowLps: string;
  totalizerReading: string;
  chlorineResidual: string;

  // 3. Flushing
  flushingMeterStatus: FlushingMeterStatus;
  flushingInitialRead: string;
  flushingFinalRead: string;
  blowOffs: BlowOffItem[];

  // 4. Customer & Metering (common + meter test)
  accountNumber: string;
  accountName: string;
  meterBrand: string;
  meterSerialNumber: string;
  meterSize: string;
  meterNature: 'Old' | 'New';
  testNature: 'Re-testing' | 'Initial';
  refVolumeM3: string;
  initialReading: string;
  reading1: string;
  reading2: string;
  reading3: string;
  witnessedBy: string;

  // Replacement / check fields
  oldMeterBrand: string;
  oldMeterSerial: string;
  oldMeterReading: string;
  newMeterBrand: string;
  newMeterSerial: string;
  newMeterReading: string;
  isMeterRunning: 'Yes' | 'No';
  needsDeclogging: 'No' | 'Yes';

  // 5. Leak Repair / Detection
  pipeSize: string;
  leakType: string;
  usedMaterials: UsedMaterialItem[];
  leakLoss: LeakVolumeLossFormState;

  // 6. Water Hauling
  vehicleType: string;
  plateNumber: string;
  driverName: string;
  haulingCycles: HaulingCycleItem[];

  // 7. Water Sampling
  turbidityNtu: string;
  phLevel: string;
  samplePoint: string;

  // 8. Backwash / Thermal Scanning / Water Level Monitoring
  filterUnit: string;
  backwashDurationMin: string;
  backwashPressureInPsi: string;
  backwashPressureOutPsi: string;
  waterClarity: 'Clear' | 'Slightly Turbid' | 'Turbid';
  productTurbidityStartNtu: string;
  productTurbidityEndNtu: string;
  scannedEquipment: string;
  maxTempC: string;
  hotspotFound: 'No' | 'Yes';
  swlMeters: string;
  pwlMeters: string;

  // 9. Deep Well Pump & Motor Pull-Out
  wellPullout: WellPulloutFormDetails;

  // 10. Tank Cleaning & Sanitation
  tankCleaning: TankCleaningFormDetails;

  // 11. Vehicle & Genset Fuel Operations
  fuel: FuelActivitiesFormState;

  // 12. Chlorine Refilling (Dosing Drum); residual reuses `chlorineResidual`
  chlorine: ChlorineRefillFormState;
}

export const INITIAL_ACTIVITY_DETAIL_FIELDS: ActivityDetailFieldsState = {
  gensetInitialFuel: '',
  gensetFinalFuel: '',
  runningHours: '',
  gensetCause: 'Routine',
  genset: INITIAL_GENSET_MONITORING_STATE,
  pressurePsi: '',
  flowLps: '',
  totalizerReading: '',
  chlorineResidual: '',
  flushingMeterStatus: 'metered',
  flushingInitialRead: '',
  flushingFinalRead: '',
  blowOffs: [{ name: 'Blow-off 1', initialRead: '', finalRead: '' }],
  accountNumber: '',
  accountName: '',
  meterBrand: '',
  meterSerialNumber: '',
  meterSize: '1/2"',
  meterNature: 'Old',
  testNature: 'Re-testing',
  refVolumeM3: '0.01',
  initialReading: '',
  reading1: '',
  reading2: '',
  reading3: '',
  witnessedBy: '',
  oldMeterBrand: '',
  oldMeterSerial: '',
  oldMeterReading: '',
  newMeterBrand: '',
  newMeterSerial: '',
  newMeterReading: '',
  isMeterRunning: 'Yes',
  needsDeclogging: 'No',
  pipeSize: '',
  leakType: '',
  usedMaterials: [],
  leakLoss: INITIAL_LEAK_LOSS_STATE,
  vehicleType: '',
  plateNumber: '',
  driverName: '',
  haulingCycles: [{ sourceLocation: '', deliveryLocation: '', volumeM3: '', loadingTime: '', injectionTime: '' }],
  turbidityNtu: '',
  phLevel: '',
  samplePoint: '',
  filterUnit: '',
  backwashDurationMin: '',
  backwashPressureInPsi: '',
  backwashPressureOutPsi: '',
  waterClarity: 'Clear',
  productTurbidityStartNtu: '',
  productTurbidityEndNtu: '',
  scannedEquipment: '',
  maxTempC: '',
  hotspotFound: 'No',
  swlMeters: '',
  pwlMeters: '',
  wellPullout: INITIAL_WELL_PULLOUT_DETAILS,
  tankCleaning: INITIAL_TANK_CLEANING_DETAILS,
  fuel: INITIAL_FUEL_ACTIVITIES_STATE,
  chlorine: INITIAL_CHLORINE_REFILL_STATE,
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const optStr = (v: unknown): string | undefined =>
  v != null && String(v) !== '' ? String(v) : undefined;

export function hydrateActivityDetailFields(
  d: Record<string, unknown>,
): ActivityDetailFieldsState {
  const next: ActivityDetailFieldsState = {
    ...INITIAL_ACTIVITY_DETAIL_FIELDS,
    blowOffs: [{ name: 'Blow-off 1', initialRead: '', finalRead: '' }],
    usedMaterials: [],
    haulingCycles: [{ sourceLocation: '', deliveryLocation: '', volumeM3: '', loadingTime: '', injectionTime: '' }],
  };

  if (d.gensetInitialFuel != null) next.gensetInitialFuel = String(d.gensetInitialFuel);
  if (d.gensetFinalFuel != null) next.gensetFinalFuel = String(d.gensetFinalFuel);
  if (d.runningHours != null) next.runningHours = String(d.runningHours);
  if (d.gensetCause === 'Routine' || d.gensetCause === 'Power Outage' || d.gensetCause === 'PMS') {
    next.gensetCause = d.gensetCause;
  }
  next.genset = hydrateGensetMonitoringDetails(d);
  if (d.pressurePsi != null) next.pressurePsi = String(d.pressurePsi);
  if (d.flowLps != null) next.flowLps = String(d.flowLps);
  if (d.totalizerReading != null) next.totalizerReading = String(d.totalizerReading);
  if (d.chlorineResidual != null) next.chlorineResidual = String(d.chlorineResidual);
  next.flushingMeterStatus = hydrateFlushingMeterStatus(d);
  if (d.flushingInitialRead != null) next.flushingInitialRead = String(d.flushingInitialRead);
  if (d.flushingFinalRead != null) next.flushingFinalRead = String(d.flushingFinalRead);

  if (Array.isArray(d.blowOffs) && d.blowOffs.length > 0) {
    const mapped = d.blowOffs.filter(isRecord).map((b) => ({
      name: typeof b.name === 'string' ? b.name : '',
      initialRead: b.initialRead != null ? String(b.initialRead) : '',
      finalRead: b.finalRead != null ? String(b.finalRead) : '',
      ...(b.diameterMm != null && String(b.diameterMm) !== '' ? { diameterMm: String(b.diameterMm) } : {}),
      ...(b.pressurePsi != null && String(b.pressurePsi) !== '' ? { pressurePsi: String(b.pressurePsi) } : {}),
      ...(b.dischargeCoeff != null && String(b.dischargeCoeff) !== '' ? { dischargeCoeff: String(b.dischargeCoeff) } : {}),
      ...(typeof b.startTime === 'string' && b.startTime !== '' ? { startTime: b.startTime } : {}),
      ...(typeof b.endTime === 'string' && b.endTime !== '' ? { endTime: b.endTime } : {}),
      ...(b.durationMinutes != null && String(b.durationMinutes) !== '' ? { durationMinutes: String(b.durationMinutes) } : {}),
    }));
    if (mapped.length > 0) next.blowOffs = mapped;
  }

  if (d.accountNumber) next.accountNumber = String(d.accountNumber);
  if (d.accountName) next.accountName = String(d.accountName);
  if (d.meterBrand) next.meterBrand = String(d.meterBrand);
  if (d.meterSerialNumber) next.meterSerialNumber = String(d.meterSerialNumber);
  if (d.meterSize) next.meterSize = String(d.meterSize);
  if (d.meterNature === 'Old' || d.meterNature === 'New') next.meterNature = d.meterNature;
  if (d.testNature === 'Re-testing' || d.testNature === 'Initial') next.testNature = d.testNature;
  if (d.refVolumeM3 != null) next.refVolumeM3 = String(d.refVolumeM3);
  if (d.initialReading != null) next.initialReading = String(d.initialReading);
  if (d.reading1 != null) next.reading1 = String(d.reading1);
  if (d.reading2 != null) next.reading2 = String(d.reading2);
  if (d.reading3 != null) next.reading3 = String(d.reading3);
  if (d.witnessedBy) next.witnessedBy = String(d.witnessedBy);
  if (d.oldMeterBrand) next.oldMeterBrand = String(d.oldMeterBrand);
  if (d.oldMeterSerial) next.oldMeterSerial = String(d.oldMeterSerial);
  if (d.oldMeterReading != null) next.oldMeterReading = String(d.oldMeterReading);
  if (d.newMeterBrand) next.newMeterBrand = String(d.newMeterBrand);
  if (d.newMeterSerial) next.newMeterSerial = String(d.newMeterSerial);
  if (d.newMeterReading != null) next.newMeterReading = String(d.newMeterReading);
  if (d.isMeterRunning === 'Yes' || d.isMeterRunning === 'No') next.isMeterRunning = d.isMeterRunning;
  if (d.needsDeclogging === 'No' || d.needsDeclogging === 'Yes') next.needsDeclogging = d.needsDeclogging;
  if (d.pipeSize) next.pipeSize = String(d.pipeSize);
  if (d.leakType) next.leakType = String(d.leakType);

  if (Array.isArray(d.usedMaterials)) {
    next.usedMaterials = d.usedMaterials.filter(isRecord).map((m) => ({
      item: String(m.item ?? ''),
      qty: String(m.qty ?? '1'),
      ...(typeof m.unit === 'string' && m.unit.trim() ? { unit: m.unit.trim() } : {}),
    }));
  }
  next.leakLoss = hydrateLeakLossDetails(d);

  if (d.vehicleType) next.vehicleType = String(d.vehicleType);
  if (d.plateNumber) next.plateNumber = String(d.plateNumber);
  if (d.driverName) next.driverName = String(d.driverName);

  if (Array.isArray(d.haulingCycles) && d.haulingCycles.length > 0) {
    const mapped = d.haulingCycles.filter(isRecord).map((c) => ({
      sourceLocation: typeof c.sourceLocation === 'string' ? c.sourceLocation : '',
      deliveryLocation: typeof c.deliveryLocation === 'string' ? c.deliveryLocation : '',
      volumeM3: optStr(c.volumeM3) ?? '',
      loadingTime: typeof c.loadingTime === 'string' ? c.loadingTime : '',
      injectionTime: typeof c.injectionTime === 'string' ? c.injectionTime : '',
    }));
    if (mapped.length > 0) next.haulingCycles = mapped;
  }

  if (d.turbidityNtu != null) next.turbidityNtu = String(d.turbidityNtu);
  if (d.phLevel != null) next.phLevel = String(d.phLevel);
  if (d.samplePoint) next.samplePoint = String(d.samplePoint);
  if (d.filterUnit) next.filterUnit = String(d.filterUnit);
  if (d.backwashDurationMin != null) next.backwashDurationMin = String(d.backwashDurationMin);
  if (d.backwashPressureInPsi != null) next.backwashPressureInPsi = String(d.backwashPressureInPsi);
  if (d.backwashPressureOutPsi != null) next.backwashPressureOutPsi = String(d.backwashPressureOutPsi);
  if (d.waterClarity === 'Clear' || d.waterClarity === 'Slightly Turbid' || d.waterClarity === 'Turbid') {
    next.waterClarity = d.waterClarity;
  }
  if (d.productTurbidityStartNtu != null) next.productTurbidityStartNtu = String(d.productTurbidityStartNtu);
  if (d.productTurbidityEndNtu != null) next.productTurbidityEndNtu = String(d.productTurbidityEndNtu);
  if (d.scannedEquipment) next.scannedEquipment = String(d.scannedEquipment);
  if (d.maxTempC != null) next.maxTempC = String(d.maxTempC);
  if (d.hotspotFound === 'No' || d.hotspotFound === 'Yes') next.hotspotFound = d.hotspotFound;
  if (d.swlMeters != null) next.swlMeters = String(d.swlMeters);
  if (d.pwlMeters != null) next.pwlMeters = String(d.pwlMeters);
  next.wellPullout = hydrateWellPulloutDetails(d);
  next.tankCleaning = hydrateTankCleaningDetails(d);
  next.fuel = hydrateFuelActivitiesDetails(d);
  next.chlorine = hydrateChlorineRefillDetails(d);

  return next;
}

export function isMeterFieldActivity(activityType: string): boolean {
  return (
    activityType === 'meter_inst' ||
    activityType === 'meter_replacement' ||
    activityType === 'meter_relocation' ||
    activityType === 'meter_check_indiv' ||
    activityType === 'meter_check_bulk' ||
    activityType === 'reconnection'
  );
}

export function buildActivityDetailsPayload(
  activityType: string,
  f: ActivityDetailFieldsState,
  meterCalc: MeterTestCalculation,
): Record<string, unknown> {
  if (activityType === 'genset_monitoring') {
    return buildGensetMonitoringPayload(
      {
        gensetInitialFuel: f.gensetInitialFuel,
        gensetFinalFuel: f.gensetFinalFuel,
        runningHours: f.runningHours,
        gensetCause: f.gensetCause,
      },
      f.genset,
    );
  }
  if (activityType === 'pump_monitoring') {
    return {
      pressurePsi: f.pressurePsi ? Number(f.pressurePsi) : null,
      flowLps: f.flowLps ? Number(f.flowLps) : null,
      totalizerReading: f.totalizerReading ? Number(f.totalizerReading) : null,
      chlorineResidual: f.chlorineResidual ? Number(f.chlorineResidual) : null,
    };
  }
  if (activityType === 'flushing') {
    const useOrifice = f.flushingMeterStatus !== 'metered' || hasBlowOffOrificeInputs(f.blowOffs);
    if (!useOrifice) {
      return {
        flushingInitialRead: f.flushingInitialRead ? Number(f.flushingInitialRead) : null,
        flushingFinalRead: f.flushingFinalRead ? Number(f.flushingFinalRead) : null,
        blowOffs: f.blowOffs.map((b) => ({
          name: b.name,
          initialRead: b.initialRead ? Number(b.initialRead) : null,
          finalRead: b.finalRead ? Number(b.finalRead) : null,
        })),
      };
    }
    const summary = computeFlushingVolume({
      meterStatus: f.flushingMeterStatus,
      flushingInitialRead: f.flushingInitialRead,
      flushingFinalRead: f.flushingFinalRead,
      blowOffs: f.blowOffs,
    });
    return {
      flushingMeterStatus: f.flushingMeterStatus,
      flushingInitialRead: null,
      flushingFinalRead: null,
      blowOffs: f.blowOffs.map((b, idx) => {
        const pt = summary.blowOffPoints[idx];
        const orf = pt?.orifice;
        return {
          name: b.name,
          diameterMm: b.diameterMm?.trim() ? Number(b.diameterMm) : null,
          pressurePsi: b.pressurePsi?.trim() ? Number(b.pressurePsi) : null,
          dischargeCoeff: b.dischargeCoeff?.trim() ? Number(b.dischargeCoeff) : 0.6,
          startTime: b.startTime?.trim() || null,
          endTime: b.endTime?.trim() || null,
          durationMinutes: orf ? orf.durationMinutes : b.durationMinutes?.trim() ? Number(b.durationMinutes) : null,
          areaM2: orf ? Number(orf.areaM2.toFixed(6)) : null,
          deltaPa: orf ? Number(orf.deltaPa.toFixed(4)) : null,
          flowM3PerSec: orf ? Number(orf.flowM3PerSec.toFixed(6)) : null,
          volumeM3: pt?.volumeM3 ?? null,
        };
      }),
      flushingVolume: {
        basis: summary.basis,
        totalVolumeM3: summary.totalVolumeM3,
        computedPointCount: summary.computedPointCount,
      },
    };
  }
  if (activityType === 'meter_test') {
    return {
      accountNumber: f.accountNumber.trim() || null,
      accountName: f.accountName.trim() || null,
      meterBrand: f.meterBrand.trim() || null,
      meterSerialNumber: f.meterSerialNumber.trim() || null,
      meterSize: f.meterSize.trim() || null,
      meterNature: f.meterNature,
      testNature: f.testNature,
      refVolumeM3: Number(f.refVolumeM3) || 0.01,
      initialReading: f.initialReading !== '' ? Number(f.initialReading) : null,
      reading1: f.reading1 !== '' ? Number(f.reading1) : null,
      reading2: f.reading2 !== '' ? Number(f.reading2) : null,
      reading3: f.reading3 !== '' ? Number(f.reading3) : null,
      ...meterCalc,
      witnessedBy: f.witnessedBy.trim() || null,
    };
  }
  if (isMeterFieldActivity(activityType)) {
    return {
      accountNumber: f.accountNumber.trim() || null,
      accountName: f.accountName.trim() || null,
      isMeterRunning: f.isMeterRunning,
      needsDeclogging: f.needsDeclogging,
      oldMeterBrand: f.oldMeterBrand.trim() || null,
      oldMeterSerial: f.oldMeterSerial.trim() || null,
      oldMeterReading: f.oldMeterReading !== '' ? Number(f.oldMeterReading) : null,
      newMeterBrand: f.newMeterBrand.trim() || null,
      newMeterSerial: f.newMeterSerial.trim() || null,
      newMeterReading: f.newMeterReading !== '' ? Number(f.newMeterReading) : null,
    };
  }
  if (activityType === 'leak_repair' || activityType === 'leak_detection' || activityType === 'valve_replacement') {
    const leakLoss = activityType === 'leak_repair' ? buildLeakLossPayload(f.leakLoss) : null;
    return {
      pipeSize: f.pipeSize.trim() || null,
      leakType: f.leakType.trim() || null,
      usedMaterials: f.usedMaterials
        .filter((m) => m.item.trim() !== '')
        .map((m) => ({
          item: m.item,
          qty: m.qty,
          ...(m.unit && m.unit.trim() ? { unit: m.unit.trim() } : {}),
        })),
      ...(leakLoss ? { leakLoss } : {}),
    };
  }
  if (activityType === 'low_pressure' || activityType === 'no_water_supply') {
    return {
      accountNumber: f.accountNumber.trim() || null,
      accountName: f.accountName.trim() || null,
      pressurePsi: f.pressurePsi !== '' ? Number(f.pressurePsi) : null,
    };
  }
  if (activityType === 'tankering') {
    return {
      vehicleType: f.vehicleType.trim() || null,
      plateNumber: f.plateNumber.trim() || null,
      driverName: f.driverName.trim() || null,
      haulingCycles: f.haulingCycles.filter(
        (c) => c.sourceLocation.trim() || c.deliveryLocation.trim() || c.volumeM3.trim(),
      ),
    };
  }
  if (activityType === CHLORINE_REFILL_ACTIVITY_TYPE) {
    return buildChlorineRefillPayload(f.chlorine, f.chlorineResidual);
  }
  if (activityType === 'water_sampling') {
    return {
      chlorineResidual: f.chlorineResidual !== '' ? Number(f.chlorineResidual) : null,
      turbidityNtu: f.turbidityNtu !== '' ? Number(f.turbidityNtu) : null,
      phLevel: f.phLevel !== '' ? Number(f.phLevel) : null,
      samplePoint: f.samplePoint.trim() || null,
    };
  }
  if (activityType === 'backwash') {
    return {
      filterUnit: f.filterUnit.trim() || null,
      backwashDurationMin: f.backwashDurationMin !== '' ? Number(f.backwashDurationMin) : null,
      backwashPressureInPsi: f.backwashPressureInPsi !== '' ? Number(f.backwashPressureInPsi) : null,
      backwashPressureOutPsi: f.backwashPressureOutPsi !== '' ? Number(f.backwashPressureOutPsi) : null,
      waterClarity: f.waterClarity,
      productTurbidityStartNtu: f.productTurbidityStartNtu !== '' ? Number(f.productTurbidityStartNtu) : null,
      productTurbidityEndNtu: f.productTurbidityEndNtu !== '' ? Number(f.productTurbidityEndNtu) : null,
    };
  }
  if (activityType === 'thermal_scanning') {
    return {
      scannedEquipment: f.scannedEquipment.trim() || null,
      maxTempC: f.maxTempC !== '' ? Number(f.maxTempC) : null,
      hotspotFound: f.hotspotFound,
    };
  }
  if (activityType === 'water_level_monitoring') {
    const swl = f.swlMeters !== '' ? Number(f.swlMeters) : null;
    const pwl = f.pwlMeters !== '' ? Number(f.pwlMeters) : null;
    return {
      swlMeters: swl,
      pwlMeters: pwl,
      drawdownMeters: swl !== null && pwl !== null ? Math.round((pwl - swl) * 100) / 100 : null,
    };
  }
  if (activityType === 'well_pull_out') {
    return buildWellPulloutPayload(f.wellPullout);
  }
  if (activityType === 'tank_cleaning') {
    return buildTankCleaningPayload(f.tankCleaning);
  }
  if (isFuelActivityType(activityType)) {
    return buildFuelActivityPayload(activityType, f.fuel, {
      vehicleType: f.vehicleType,
      plateNumber: f.plateNumber,
      driverName: f.driverName,
    });
  }
  return {};
}

export function currentManilaHHMM(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const h = parts.find((p) => p.type === 'hour')?.value ?? '08';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h === '24' ? '00' : h}:${m}`;
}

export function toManilaTimestampIso(ymd: string, hhmm: string): string | null {
  if (!ymd || !hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  try {
    return new Date(`${ymd}T${hhmm}:00+08:00`).toISOString();
  } catch {
    return null;
  }
}

export function calcDurationMinutes(startHHMM: string, endHHMM: string): string {
  if (!/^\d{2}:\d{2}$/.test(startHHMM) || !/^\d{2}:\d{2}$/.test(endHHMM)) return '';
  const [sh, sm] = startHHMM.split(':').map(Number);
  const [eh, em] = endHHMM.split(':').map(Number);
  const startM = sh * 60 + sm;
  let endM = eh * 60 + em;
  if (endM < startM) endM += 24 * 60;
  const diff = endM - startM;
  return diff > 0 ? String(diff) : '';
}

/** Validates required Start/Completion times, Start Pressure In/Out, and Start/End Product Turbidity (NTU) for backwash logs. */
export function validateBackwashTelemetry(input: {
  startedHHMM: string;
  completedHHMM: string;
  backwashPressureInPsi: string;
  backwashPressureOutPsi: string;
  productTurbidityStartNtu: string;
  productTurbidityEndNtu: string;
}): string | null {
  const durationMin = calcDurationMinutes(input.startedHHMM, input.completedHHMM);
  if (!input.startedHHMM || !input.completedHHMM || !durationMin) {
    return 'Please enter both Start Time and Completion Time for backwash (duration must be > 0 mins).';
  }
  const pInRaw = input.backwashPressureInPsi.trim();
  if (!pInRaw || !Number.isFinite(Number(pInRaw)) || Number(pInRaw) < 0) {
    return 'Please enter Pressure In before backwash starts (PSI, 0 or higher).';
  }
  const pOutRaw = input.backwashPressureOutPsi.trim();
  if (!pOutRaw || !Number.isFinite(Number(pOutRaw)) || Number(pOutRaw) < 0) {
    return 'Please enter Pressure Out before backwash starts (PSI, 0 or higher).';
  }
  const startRaw = input.productTurbidityStartNtu.trim();
  if (!startRaw || !Number.isFinite(Number(startRaw)) || Number(startRaw) < 0) {
    return 'Please enter Product Turbidity at Start of Backwash (NTU, 0 or higher).';
  }
  const endRaw = input.productTurbidityEndNtu.trim();
  if (!endRaw || !Number.isFinite(Number(endRaw)) || Number(endRaw) < 0) {
    return 'Please enter Product Turbidity at End of Backwash (NTU, 0 or higher).';
  }
  return null;
}
