/**
 * Types, defaults, hydration, and payload serialization for the
 * "PULL OUT AND INSTALLATION ACCOMPLISHMENT REPORT FORM FOR DEEPWELL"
 * (activity_type === 'well_pull_out').
 *
 * Intentionally free of runtime `@/` path-alias imports so `node --test`
 * can load it directly.
 */

export type WellPulloutEquipmentStatus = '' | 'Brand New' | 'Repaired';

export interface WellPulloutFormDetails {
  // Header / Project
  projectPumpStation: string;
  reportMonth: string;
  reportYear: string;

  // Section 1: To Be Filled Up By Contractor / Site Coordinator
  contractorCoordinator: string;
  timeReportedToEngineer: string;
  arrivalTimeAtSite: string;
  timeOfSetUp: string;
  dateStarted: string;
  timeStarted: string;
  dateFinished: string;
  timeFinished: string;

  // Section 2: Before Pull Out of Pump and Motor
  beforePulloutFlowrateLps: string;
  beforePulloutPressurePsi: string;
  beforePulloutIrL1: string;
  beforePulloutIrL2: string;
  beforePulloutIrL3: string;
  beforePulloutCurrentL1: string;
  beforePulloutCurrentL2: string;
  beforePulloutCurrentL3: string;
  beforePulloutVoltageL1: string;
  beforePulloutVoltageL2: string;
  beforePulloutVoltageL3: string;
  beforePulloutRemarks: string;

  // Section 3: After Pull Out of Pump and Motor
  afterPulloutTime: string;
  afterPulloutRemarks: string;
  pulledPumpBrand: string;
  pulledPumpModel: string;
  pulledPumpStockNo: string;
  pulledMotorBrand: string;
  pulledMotorHpVoltPhase: string;
  pulledMotorSerialNo: string;
  pulledRiserPipeSizeMm: string;
  pulledRiserPipeMaterial: string;
  pulledRiserPipeCount: string;
  wellCasingDiameterMm: string;
  wellDepthM: string;
  pumpSettingM: string;
  swlMeters: string;
  pwlMeters: string;
  motorControlType: string;
  pulledCableSizeMm2: string;
  pulledCableLengthM: string;
  pulledCableSplicingCount: string;
  pulledOverloadRelayRangeA: string;
  pulledOverloadRelaySettingA: string;
  pulledMagneticContactorRatingA: string;

  // Section 4: Before Installation Pump and Motor
  beforeInstallTime: string;
  checkNoLooseThread: string;
  checkNoVisibleCorrosion: string;
  checkElectrodeNotZeroMeg: string;
  installPumpBrand: string;
  installPumpModel: string;
  installPumpControlNo: string;
  installPumpStatus: WellPulloutEquipmentStatus;
  installMotorBrand: string;
  installMotorHpVoltPhase: string;
  installMotorSerialNo: string;
  installMotorStatus: WellPulloutEquipmentStatus;
  motorIrBeforeSpliceL1: string;
  motorIrBeforeSpliceL2: string;
  motorIrBeforeSpliceL3: string;
  beforeSpliceRemarks: string;
  splicedIrL1: string;
  splicedIrL2: string;
  splicedIrL3: string;
  afterSpliceRemarks: string;
  noLoadCurrentL1: string;
  noLoadCurrentL2: string;
  noLoadCurrentL3: string;

  // Section 5: After Installation
  afterInstallTime: string;
  afterInstallRemarks: string;
  installRiserPipeSizeMm: string;
  installRiserPipeCount: string;
  soundingPipeLengthM: string;
  afterInstallFlowrateLps: string;
  afterInstallPressurePsi: string;
  afterInstallIrL1: string;
  afterInstallIrL2: string;
  afterInstallIrL3: string;
  afterInstallCurrentL1: string;
  afterInstallCurrentL2: string;
  afterInstallCurrentL3: string;
  afterInstallVoltageL1: string;
  afterInstallVoltageL2: string;
  afterInstallVoltageL3: string;
  installCableSizeMm2: string;
  installCableLengthM: string;
  installCableSplicingCount: string;
  installOverloadRelayRangeA: string;
  installOverloadRelaySettingA: string;
  installMagneticContactorRatingA: string;
  acceptIrAbove2Meg: string;
  acceptCurrentWithin14Pct: string;
  acceptVoltageWithin10Pct: string;

  // Section 6 & 7: Results of Operation, Overall Remarks & Signatories
  operationDuration: string;
  reasonOfPullout: string;
  overallRemarks: string;
  performedByContractor: string;
  checkedByCoordinator: string;
  notedByEngineer: string;
}

export const INITIAL_WELL_PULLOUT_DETAILS: WellPulloutFormDetails = {
  projectPumpStation: '',
  reportMonth: '',
  reportYear: '',

  contractorCoordinator: 'Operations/Technical Team',
  timeReportedToEngineer: '',
  arrivalTimeAtSite: '',
  timeOfSetUp: '',
  dateStarted: '',
  timeStarted: '',
  dateFinished: '',
  timeFinished: '',

  beforePulloutFlowrateLps: '',
  beforePulloutPressurePsi: '',
  beforePulloutIrL1: '',
  beforePulloutIrL2: '',
  beforePulloutIrL3: '',
  beforePulloutCurrentL1: '',
  beforePulloutCurrentL2: '',
  beforePulloutCurrentL3: '',
  beforePulloutVoltageL1: '',
  beforePulloutVoltageL2: '',
  beforePulloutVoltageL3: '',
  beforePulloutRemarks: '',

  afterPulloutTime: '',
  afterPulloutRemarks: '',
  pulledPumpBrand: '',
  pulledPumpModel: '',
  pulledPumpStockNo: '',
  pulledMotorBrand: '',
  pulledMotorHpVoltPhase: '',
  pulledMotorSerialNo: '',
  pulledRiserPipeSizeMm: '',
  pulledRiserPipeMaterial: 'Galvanized Iron',
  pulledRiserPipeCount: '',
  wellCasingDiameterMm: '',
  wellDepthM: '',
  pumpSettingM: '',
  swlMeters: '',
  pwlMeters: '',
  motorControlType: '',
  pulledCableSizeMm2: '',
  pulledCableLengthM: '',
  pulledCableSplicingCount: '',
  pulledOverloadRelayRangeA: '',
  pulledOverloadRelaySettingA: '',
  pulledMagneticContactorRatingA: '',

  beforeInstallTime: '',
  checkNoLooseThread: 'NONE',
  checkNoVisibleCorrosion: 'NONE',
  checkElectrodeNotZeroMeg: 'YES',
  installPumpBrand: '',
  installPumpModel: '',
  installPumpControlNo: '',
  installPumpStatus: '',
  installMotorBrand: '',
  installMotorHpVoltPhase: '',
  installMotorSerialNo: '',
  installMotorStatus: '',
  motorIrBeforeSpliceL1: '',
  motorIrBeforeSpliceL2: '',
  motorIrBeforeSpliceL3: '',
  beforeSpliceRemarks: '',
  splicedIrL1: '',
  splicedIrL2: '',
  splicedIrL3: '',
  afterSpliceRemarks: '',
  noLoadCurrentL1: '',
  noLoadCurrentL2: '',
  noLoadCurrentL3: '',

  afterInstallTime: '',
  afterInstallRemarks: '',
  installRiserPipeSizeMm: '',
  installRiserPipeCount: '',
  soundingPipeLengthM: '',
  afterInstallFlowrateLps: '',
  afterInstallPressurePsi: '',
  afterInstallIrL1: '',
  afterInstallIrL2: '',
  afterInstallIrL3: '',
  afterInstallCurrentL1: '',
  afterInstallCurrentL2: '',
  afterInstallCurrentL3: '',
  afterInstallVoltageL1: '',
  afterInstallVoltageL2: '',
  afterInstallVoltageL3: '',
  installCableSizeMm2: '',
  installCableLengthM: '',
  installCableSplicingCount: '',
  installOverloadRelayRangeA: '',
  installOverloadRelaySettingA: '',
  installMagneticContactorRatingA: '',
  acceptIrAbove2Meg: 'YES',
  acceptCurrentWithin14Pct: 'YES',
  acceptVoltageWithin10Pct: 'YES',

  operationDuration: '',
  reasonOfPullout: '',
  overallRemarks: '',
  performedByContractor: '',
  checkedByCoordinator: '',
  notedByEngineer: '',
};

function strVal(v: unknown, fallback = ''): string {
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function statusVal(v: unknown): WellPulloutEquipmentStatus {
  return v === 'Brand New' || v === 'Repaired' ? v : '';
}

function pickSource(d: Record<string, unknown>): Record<string, unknown> {
  const nested = d.wellPullout;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return { ...d, ...(nested as Record<string, unknown>) };
  }
  return d;
}

/** Hydrate WellPulloutFormDetails from saved activity `details` JSON. */
export function hydrateWellPulloutDetails(d: Record<string, unknown>): WellPulloutFormDetails {
  const src = pickSource(d);
  const init = INITIAL_WELL_PULLOUT_DETAILS;
  return {
    projectPumpStation: strVal(src.projectPumpStation, init.projectPumpStation),
    reportMonth: strVal(src.reportMonth, init.reportMonth),
    reportYear: strVal(src.reportYear, init.reportYear),

    contractorCoordinator: strVal(src.contractorCoordinator, init.contractorCoordinator),
    timeReportedToEngineer: strVal(src.timeReportedToEngineer),
    arrivalTimeAtSite: strVal(src.arrivalTimeAtSite),
    timeOfSetUp: strVal(src.timeOfSetUp),
    dateStarted: strVal(src.dateStarted),
    timeStarted: strVal(src.timeStarted),
    dateFinished: strVal(src.dateFinished),
    timeFinished: strVal(src.timeFinished),

    beforePulloutFlowrateLps: strVal(src.beforePulloutFlowrateLps),
    beforePulloutPressurePsi: strVal(src.beforePulloutPressurePsi),
    beforePulloutIrL1: strVal(src.beforePulloutIrL1),
    beforePulloutIrL2: strVal(src.beforePulloutIrL2),
    beforePulloutIrL3: strVal(src.beforePulloutIrL3),
    beforePulloutCurrentL1: strVal(src.beforePulloutCurrentL1),
    beforePulloutCurrentL2: strVal(src.beforePulloutCurrentL2),
    beforePulloutCurrentL3: strVal(src.beforePulloutCurrentL3),
    beforePulloutVoltageL1: strVal(src.beforePulloutVoltageL1),
    beforePulloutVoltageL2: strVal(src.beforePulloutVoltageL2),
    beforePulloutVoltageL3: strVal(src.beforePulloutVoltageL3),
    beforePulloutRemarks: strVal(src.beforePulloutRemarks),

    afterPulloutTime: strVal(src.afterPulloutTime),
    afterPulloutRemarks: strVal(src.afterPulloutRemarks),
    pulledPumpBrand: strVal(src.pulledPumpBrand),
    pulledPumpModel: strVal(src.pulledPumpModel),
    pulledPumpStockNo: strVal(src.pulledPumpStockNo),
    pulledMotorBrand: strVal(src.pulledMotorBrand),
    pulledMotorHpVoltPhase: strVal(src.pulledMotorHpVoltPhase),
    pulledMotorSerialNo: strVal(src.pulledMotorSerialNo),
    pulledRiserPipeSizeMm: strVal(src.pulledRiserPipeSizeMm),
    pulledRiserPipeMaterial: strVal(src.pulledRiserPipeMaterial, init.pulledRiserPipeMaterial),
    pulledRiserPipeCount: strVal(src.pulledRiserPipeCount),
    wellCasingDiameterMm: strVal(src.wellCasingDiameterMm),
    wellDepthM: strVal(src.wellDepthM),
    pumpSettingM: strVal(src.pumpSettingM),
    swlMeters: strVal(src.swlMeters),
    pwlMeters: strVal(src.pwlMeters),
    motorControlType: strVal(src.motorControlType),
    pulledCableSizeMm2: strVal(src.pulledCableSizeMm2),
    pulledCableLengthM: strVal(src.pulledCableLengthM),
    pulledCableSplicingCount: strVal(src.pulledCableSplicingCount),
    pulledOverloadRelayRangeA: strVal(src.pulledOverloadRelayRangeA),
    pulledOverloadRelaySettingA: strVal(src.pulledOverloadRelaySettingA),
    pulledMagneticContactorRatingA: strVal(src.pulledMagneticContactorRatingA),

    beforeInstallTime: strVal(src.beforeInstallTime),
    checkNoLooseThread: strVal(src.checkNoLooseThread, init.checkNoLooseThread),
    checkNoVisibleCorrosion: strVal(src.checkNoVisibleCorrosion, init.checkNoVisibleCorrosion),
    checkElectrodeNotZeroMeg: strVal(src.checkElectrodeNotZeroMeg, init.checkElectrodeNotZeroMeg),
    installPumpBrand: strVal(src.installPumpBrand),
    installPumpModel: strVal(src.installPumpModel),
    installPumpControlNo: strVal(src.installPumpControlNo),
    installPumpStatus: statusVal(src.installPumpStatus),
    installMotorBrand: strVal(src.installMotorBrand),
    installMotorHpVoltPhase: strVal(src.installMotorHpVoltPhase),
    installMotorSerialNo: strVal(src.installMotorSerialNo),
    installMotorStatus: statusVal(src.installMotorStatus),
    motorIrBeforeSpliceL1: strVal(src.motorIrBeforeSpliceL1),
    motorIrBeforeSpliceL2: strVal(src.motorIrBeforeSpliceL2),
    motorIrBeforeSpliceL3: strVal(src.motorIrBeforeSpliceL3),
    beforeSpliceRemarks: strVal(src.beforeSpliceRemarks),
    splicedIrL1: strVal(src.splicedIrL1),
    splicedIrL2: strVal(src.splicedIrL2),
    splicedIrL3: strVal(src.splicedIrL3),
    afterSpliceRemarks: strVal(src.afterSpliceRemarks),
    noLoadCurrentL1: strVal(src.noLoadCurrentL1),
    noLoadCurrentL2: strVal(src.noLoadCurrentL2),
    noLoadCurrentL3: strVal(src.noLoadCurrentL3),

    afterInstallTime: strVal(src.afterInstallTime),
    afterInstallRemarks: strVal(src.afterInstallRemarks),
    installRiserPipeSizeMm: strVal(src.installRiserPipeSizeMm),
    installRiserPipeCount: strVal(src.installRiserPipeCount),
    soundingPipeLengthM: strVal(src.soundingPipeLengthM),
    afterInstallFlowrateLps: strVal(src.afterInstallFlowrateLps),
    afterInstallPressurePsi: strVal(src.afterInstallPressurePsi),
    afterInstallIrL1: strVal(src.afterInstallIrL1),
    afterInstallIrL2: strVal(src.afterInstallIrL2),
    afterInstallIrL3: strVal(src.afterInstallIrL3),
    afterInstallCurrentL1: strVal(src.afterInstallCurrentL1),
    afterInstallCurrentL2: strVal(src.afterInstallCurrentL2),
    afterInstallCurrentL3: strVal(src.afterInstallCurrentL3),
    afterInstallVoltageL1: strVal(src.afterInstallVoltageL1),
    afterInstallVoltageL2: strVal(src.afterInstallVoltageL2),
    afterInstallVoltageL3: strVal(src.afterInstallVoltageL3),
    installCableSizeMm2: strVal(src.installCableSizeMm2),
    installCableLengthM: strVal(src.installCableLengthM),
    installCableSplicingCount: strVal(src.installCableSplicingCount),
    installOverloadRelayRangeA: strVal(src.installOverloadRelayRangeA),
    installOverloadRelaySettingA: strVal(src.installOverloadRelaySettingA),
    installMagneticContactorRatingA: strVal(src.installMagneticContactorRatingA),
    acceptIrAbove2Meg: strVal(src.acceptIrAbove2Meg, init.acceptIrAbove2Meg),
    acceptCurrentWithin14Pct: strVal(src.acceptCurrentWithin14Pct, init.acceptCurrentWithin14Pct),
    acceptVoltageWithin10Pct: strVal(src.acceptVoltageWithin10Pct, init.acceptVoltageWithin10Pct),

    operationDuration: strVal(src.operationDuration),
    reasonOfPullout: strVal(src.reasonOfPullout),
    overallRemarks: strVal(src.overallRemarks),
    performedByContractor: strVal(src.performedByContractor),
    checkedByCoordinator: strVal(src.checkedByCoordinator),
    notedByEngineer: strVal(src.notedByEngineer),
  };
}

/** Build the persisted JSON details object for `activity_type === 'well_pull_out'`. */
export function buildWellPulloutPayload(w: WellPulloutFormDetails): Record<string, unknown> {
  return {
    wellPullout: w,
    reasonOfPullout: w.reasonOfPullout.trim() || null,
    operationDuration: w.operationDuration.trim() || null,
    pulledPumpBrand: w.pulledPumpBrand.trim() || null,
    pulledPumpModel: w.pulledPumpModel.trim() || null,
    installPumpBrand: w.installPumpBrand.trim() || null,
    installPumpModel: w.installPumpModel.trim() || null,
    installPumpStatus: w.installPumpStatus || null,
    swlMeters: w.swlMeters.trim() || null,
    pwlMeters: w.pwlMeters.trim() || null,
    pumpSettingM: w.pumpSettingM.trim() || null,
    afterInstallFlowrateLps: w.afterInstallFlowrateLps.trim() || null,
    afterInstallPressurePsi: w.afterInstallPressurePsi.trim() || null,
  };
}
