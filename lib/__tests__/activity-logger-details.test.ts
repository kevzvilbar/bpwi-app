import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_ACTIVITY_DETAIL_FIELDS,
  INITIAL_TANK_CLEANING_DETAILS,
  INITIAL_WELL_PULLOUT_DETAILS,
  buildActivityDetailsPayload,
  hydrateActivityDetailFields,
  isMeterFieldActivity,
  type ActivityDetailFieldsState,
} from '../activity-logger-details.ts';
import { formatTelemetrySummary } from '../activity-telemetry.ts';
import {
  computeTankDowntime,
  evaluateTankWaterQuality,
  formatTankReportNumber,
} from '../tank-cleaning-types.ts';
import {
  computePulloutDuration,
  evaluateWellPulloutAcceptance,
  formatPulloutDateDisplay,
  formatPulloutTimeDisplay,
  normalizePulloutDateYMD,
  normalizePulloutTimeHHMM,
} from '../well-pullout-types.ts';
import type { DailyActivityRow, MeterTestCalculation } from '../activity-types.ts';

function makeActivity(
  activity_type: string,
  details: Record<string, unknown>,
): DailyActivityRow {
  return {
    id: 'act-001',
    organization_id: 'org-001',
    activity_date: '2026-11-19',
    logged_by: 'usr-001',
    lead_operator_id: 'op-001',
    crew_operator_ids: [],
    shift_type_id: null,
    area_code_id: null,
    site_or_well: null,
    block_lot: null,
    activity_type,
    pm_task_id: null,
    job_order_id: null,
    status: 'submitted',
    started_at: null,
    completed_at: null,
    gps_lat: null,
    gps_lng: null,
    notes: null,
    details,
    photo_urls: [],
    photo_storage_paths: [],
    photos_expires_at: null,
    photos_purged_at: null,
    signature_data: null,
    verified_by: null,
    verified_at: null,
    review_note: null,
    created_at: '2026-11-19T00:00:00Z',
    updated_at: '2026-11-19T00:00:00Z',
  };
}

const SAMPLE_METER_CALC: MeterTestCalculation = {
  err1: 1.5,
  err2: 2.0,
  err3: 1.0,
  avgErr: 1.5,
  verdict: 'Passed',
  recommendation: 'Retain',
};

describe('activity-logger-details helpers', () => {
  it('hydrates empty details to initial defaults without sharing mutable array references', () => {
    const a = hydrateActivityDetailFields({});
    const b = hydrateActivityDetailFields({});
    assert.deepEqual(a, INITIAL_ACTIVITY_DETAIL_FIELDS);
    a.blowOffs[0].name = 'Modified';
    assert.equal(b.blowOffs[0].name, 'Blow-off 1');
  });

  it('hydrates valid telemetry scalars and array items cleanly', () => {
    const hydrated = hydrateActivityDetailFields({
      gensetInitialFuel: 120,
      gensetFinalFuel: 85,
      runningHours: 3.5,
      gensetCause: 'Power Outage',
      pressurePsi: 48,
      flowLps: 12.4,
      totalizerReading: 10542,
      chlorineResidual: 0.6,
      blowOffs: [{ name: 'BO North', initialRead: 10, finalRead: 22 }],
      usedMaterials: [{ item: '2-inch GI Coupling', qty: 2 }],
      haulingCycles: [
        {
          sourceLocation: 'Well 1',
          deliveryLocation: 'Phase 2 Tank',
          volumeM3: 10,
          loadingTime: '08:00',
          injectionTime: '08:45',
        },
      ],
      waterClarity: 'Slightly Turbid',
      hotspotFound: 'Yes',
      swlMeters: 14.2,
      pwlMeters: 21.7,
    });

    assert.equal(hydrated.gensetInitialFuel, '120');
    assert.equal(hydrated.gensetFinalFuel, '85');
    assert.equal(hydrated.gensetCause, 'Power Outage');
    assert.deepEqual(hydrated.blowOffs, [{ name: 'BO North', initialRead: '10', finalRead: '22' }]);
    assert.deepEqual(hydrated.usedMaterials, [{ item: '2-inch GI Coupling', qty: '2' }]);
    assert.equal(hydrated.haulingCycles[0].volumeM3, '10');
    assert.equal(hydrated.waterClarity, 'Slightly Turbid');
    assert.equal(hydrated.hotspotFound, 'Yes');
    assert.equal(hydrated.swlMeters, '14.2');
    assert.equal(hydrated.pwlMeters, '21.7');
  });

  it('safely handles malformed unknown values in hydrateActivityDetailFields', () => {
    const hydrated = hydrateActivityDetailFields({
      gensetCause: 'InvalidCause',
      meterNature: 42,
      testNature: null,
      waterClarity: { bad: true },
      hotspotFound: 123,
      blowOffs: [null, 'bad', { name: 99, initialRead: 1.5, finalRead: undefined }],
      usedMaterials: ['ignored', { item: 'Gate Valve', qty: 3 }],
      haulingCycles: [123, { sourceLocation: { nested: true }, deliveryLocation: 'Zone B', volumeM3: 8 }],
    });

    assert.equal(hydrated.gensetCause, 'Routine');
    assert.equal(hydrated.meterNature, 'Old');
    assert.equal(hydrated.testNature, 'Re-testing');
    assert.equal(hydrated.waterClarity, 'Clear');
    assert.equal(hydrated.hotspotFound, 'No');
    assert.deepEqual(hydrated.blowOffs, [{ name: '', initialRead: '1.5', finalRead: '' }]);
    assert.deepEqual(hydrated.usedMaterials, [{ item: 'Gate Valve', qty: '3' }]);
    assert.deepEqual(hydrated.haulingCycles, [
      {
        sourceLocation: '',
        deliveryLocation: 'Zone B',
        volumeM3: '8',
        loadingTime: '',
        injectionTime: '',
      },
    ]);
  });

  it('identifies meter field activities accurately', () => {
    for (const t of ['meter_inst', 'meter_replacement', 'meter_check_indiv', 'meter_check_bulk', 'reconnection']) {
      assert.equal(isMeterFieldActivity(t), true);
    }
    for (const t of ['meter_test', 'genset_monitoring', 'pump_monitoring', 'flushing', 'leak_repair', 'tankering']) {
      assert.equal(isMeterFieldActivity(t), false);
    }
  });

  it('builds structured payloads for every specialized activity type', () => {
    const base: ActivityDetailFieldsState = {
      ...INITIAL_ACTIVITY_DETAIL_FIELDS,
      gensetInitialFuel: '100',
      gensetFinalFuel: '75',
      runningHours: '2.5',
      gensetCause: 'PMS',
      pressurePsi: '42',
      flowLps: '15.2',
      totalizerReading: '9980',
      chlorineResidual: '0.5',
      flushingInitialRead: '1000',
      flushingFinalRead: '1045',
      blowOffs: [{ name: 'BO 1', initialRead: '10', finalRead: '25' }],
      accountNumber: ' 123456001002 ',
      accountName: ' Sample Customer ',
      meterBrand: 'Ever',
      meterSerialNumber: 'SN-001',
      initialReading: '50',
      reading1: '50.01',
      reading2: '50.02',
      reading3: '50.03',
      witnessedBy: ' Inspector A ',
      oldMeterReading: '400',
      newMeterReading: '0',
      pipeSize: '75mm uPVC',
      leakType: 'Joint Leak',
      usedMaterials: [
        { item: 'Rubber Gasket', qty: '2' },
        { item: '   ', qty: '1' },
      ],
      vehicleType: 'Water Tanker',
      plateNumber: 'ABC-1234',
      driverName: 'Driver One',
      haulingCycles: [
        { sourceLocation: 'Well 1', deliveryLocation: 'Phase 1', volumeM3: '12', loadingTime: '09:00', injectionTime: '09:30' },
        { sourceLocation: '', deliveryLocation: '', volumeM3: '', loadingTime: '', injectionTime: '' },
      ],
      turbidityNtu: '0.8',
      phLevel: '7.2',
      samplePoint: 'Clubhouse Tap',
      filterUnit: 'MMF-1',
      backwashDurationMin: '18',
      waterClarity: 'Clear',
      scannedEquipment: 'VFD Panel A',
      maxTempC: '47.5',
      hotspotFound: 'No',
      swlMeters: '12.345',
      pwlMeters: '19.8',
    };

    assert.deepEqual(buildActivityDetailsPayload('genset_monitoring', base, SAMPLE_METER_CALC), {
      gensetInitialFuel: 100,
      gensetFinalFuel: 75,
      runningHours: 2.5,
      gensetCause: 'PMS',
      gensetUnitFuelType: 'Diesel',
      gensetRunMode: 'no_load_pms',
      gensetRunDurationMin: null,
      gensetOilLevel: 'Normal / Full',
      gensetCoolantLevel: 'Normal',
      gensetBatteryStatus: 'Good / Strong Crank',
      gensetBatteryVoltageV: null,
      gensetLeaksObserved: 'None',
      gensetNoiseVibration: 'Normal',
      gensetExhaustSmoke: 'Clear / Normal',
      gensetOutputVoltageV: null,
      gensetFrequencyHz: null,
      gensetStandbyNote: null,
      gensetStandbyVerdict: 'READY',
      gensetFindings: [],
    });

    assert.deepEqual(buildActivityDetailsPayload('pump_monitoring', base, SAMPLE_METER_CALC), {
      pressurePsi: 42,
      flowLps: 15.2,
      totalizerReading: 9980,
      chlorineResidual: 0.5,
    });

    assert.deepEqual(buildActivityDetailsPayload('flushing', base, SAMPLE_METER_CALC), {
      flushingInitialRead: 1000,
      flushingFinalRead: 1045,
      blowOffs: [{ name: 'BO 1', initialRead: 10, finalRead: 25 }],
    });

    const meterTestPayload = buildActivityDetailsPayload('meter_test', base, SAMPLE_METER_CALC);
    assert.equal(meterTestPayload.accountNumber, '123456001002');
    assert.equal(meterTestPayload.accountName, 'Sample Customer');
    assert.equal(meterTestPayload.avgErr, 1.5);
    assert.equal(meterTestPayload.verdict, 'Passed');
    assert.equal(meterTestPayload.witnessedBy, 'Inspector A');

    const replacePayload = buildActivityDetailsPayload('meter_replacement', base, SAMPLE_METER_CALC);
    assert.equal(replacePayload.oldMeterReading, 400);
    assert.equal(replacePayload.newMeterReading, 0);

    const leakPayload = buildActivityDetailsPayload('leak_repair', base, SAMPLE_METER_CALC);
    assert.deepEqual(leakPayload.usedMaterials, [{ item: 'Rubber Gasket', qty: '2' }]);

    const tankerPayload = buildActivityDetailsPayload('tankering', base, SAMPLE_METER_CALC);
    assert.equal((tankerPayload.haulingCycles as unknown[]).length, 1);

    assert.deepEqual(buildActivityDetailsPayload('water_sampling', base, SAMPLE_METER_CALC), {
      chlorineResidual: 0.5,
      turbidityNtu: 0.8,
      phLevel: 7.2,
      samplePoint: 'Clubhouse Tap',
    });

    assert.deepEqual(buildActivityDetailsPayload('backwash', base, SAMPLE_METER_CALC), {
      filterUnit: 'MMF-1',
      backwashDurationMin: 18,
      pressurePsi: 42,
      waterClarity: 'Clear',
    });

    assert.deepEqual(buildActivityDetailsPayload('thermal_scanning', base, SAMPLE_METER_CALC), {
      scannedEquipment: 'VFD Panel A',
      maxTempC: 47.5,
      hotspotFound: 'No',
    });

    assert.deepEqual(buildActivityDetailsPayload('water_level_monitoring', base, SAMPLE_METER_CALC), {
      swlMeters: 12.345,
      pwlMeters: 19.8,
      drawdownMeters: 7.46,
    });

    assert.deepEqual(buildActivityDetailsPayload('other_activity', base, SAMPLE_METER_CALC), {});
  });
});

describe('activity-telemetry formatTelemetrySummary', () => {
  it('formats summaries across activity types', () => {
    assert.deepEqual(
      formatTelemetrySummary(
        makeActivity('genset_monitoring', {
          gensetInitialFuel: 120,
          gensetFinalFuel: 90,
          runningHours: 2,
          gensetCause: 'Routine',
        }),
      ),
      ['Fuel: 120 → 90', 'Run: 2h', 'Cause: Routine'],
    );

    assert.deepEqual(
      formatTelemetrySummary(
        makeActivity('pump_monitoring', {
          pressurePsi: 45,
          flowLps: 14,
          totalizerReading: 500,
          chlorineResidual: 0.5,
        }),
      ),
      ['45 PSI', '14 LPS', 'Totalizer: 500 m³', 'Cl₂: 0.5 mg/L'],
    );

    assert.deepEqual(
      formatTelemetrySummary(
        makeActivity('flushing', {
          flushingInitialRead: 100,
          flushingFinalRead: 130,
          blowOffs: [{ name: 'BO1' }, { name: 'BO2' }],
        }),
      ),
      ['Main Read: 100 → 130', '2 blow-off point(s)'],
    );

    assert.deepEqual(
      formatTelemetrySummary(
        makeActivity('meter_test', {
          accountNumber: '123456001002',
          accountName: 'Sample Customer',
          avgErr: 1.5,
          verdict: 'Passed',
          recommendation: 'Retain',
        }),
      ),
      ['Acct: 123456001002', 'Sample Customer', 'Avg Err: 1.5% (Passed · Retain)'],
    );

    assert.deepEqual(
      formatTelemetrySummary(
        makeActivity('tankering', {
          haulingCycles: [{ volumeM3: '10' }, { volumeM3: 15 }],
          plateNumber: 'XYZ-789',
        }),
      ),
      ['2 trip(s) · 25 m³', 'Plate: XYZ-789'],
    );

    assert.deepEqual(
      formatTelemetrySummary(
        makeActivity('water_level_monitoring', {
          swlMeters: 12.5,
          pwlMeters: 19.0,
          drawdownMeters: 6.5,
        }),
      ),
      ['SWL: 12.5m', 'PWL: 19m', 'Drawdown: 6.5m'],
    );
  });

  it('safely ignores non-primitive objects and malformed arrays in details', () => {
    const malformedGenset = formatTelemetrySummary(
      makeActivity('genset_monitoring', {
        gensetInitialFuel: { nested: 'obj' },
        gensetFinalFuel: ['array'],
        runningHours: null,
        gensetCause: { obj: true },
      }),
    );
    assert.deepEqual(malformedGenset, []);

    const malformedTanker = formatTelemetrySummary(
      makeActivity('tankering', {
        haulingCycles: [{ volumeM3: 'not-a-number' }, { volumeM3: 5 }],
        plateNumber: { bad: 1 },
      }),
    );
    assert.deepEqual(malformedTanker, ['2 trip(s) · 5 m³']);

    const malformedFlushing = formatTelemetrySummary(
      makeActivity('flushing', {
        flushingInitialRead: true,
        blowOffs: 'not-an-array',
      }),
    );
    assert.deepEqual(malformedFlushing, []);
  });

  it('builds and round-trips full well_pull_out form details and formats telemetry summary', () => {
    const state: ActivityDetailFieldsState = {
      ...INITIAL_ACTIVITY_DETAIL_FIELDS,
      wellPullout: {
        ...INITIAL_WELL_PULLOUT_DETAILS,
        projectPumpStation: 'STA. BARBARA WELL 2',
        reportMonth: 'July',
        reportYear: '2026',
        timeStarted: '1300H',
        timeFinished: '0100H',
        beforePulloutPressurePsi: '28',
        beforePulloutIrL1: '0.036',
        beforePulloutIrL2: '0.038',
        beforePulloutIrL3: '0.037',
        beforePulloutCurrentL1: '28',
        beforePulloutCurrentL2: '28',
        beforePulloutCurrentL3: '28',
        beforePulloutVoltageL1: '232',
        beforePulloutVoltageL2: '233',
        beforePulloutVoltageL3: '231',
        afterPulloutTime: '0245H',
        afterPulloutRemarks: 'MOTOR IN GOOD CONDITION. PUMP FOR REPLACEMENT.',
        pulledPumpBrand: 'SHAKTI INDIA',
        pulledPumpModel: 'DP 17-8',
        pulledMotorBrand: 'FRANKLIN MOTORS ELECTRIC',
        pulledMotorHpVoltPhase: '10/230/3',
        pulledRiserPipeSizeMm: '80',
        pulledRiserPipeCount: '12',
        wellCasingDiameterMm: '254',
        pumpSettingM: '73',
        swlMeters: '35',
        pwlMeters: '69',
        motorControlType: 'VFD',
        pulledCableSizeMm2: '5.26',
        pulledCableLengthM: '76',
        beforeInstallTime: '0445H',
        installPumpBrand: 'DYNAFLOW',
        installPumpModel: 'DP17-8',
        installPumpStatus: 'Repaired',
        installMotorBrand: 'FRANKLIN MOTORS',
        installMotorHpVoltPhase: '10/230/3',
        installMotorStatus: 'Brand New',
        splicedIrL1: '30.63',
        splicedIrL2: '30.13',
        splicedIrL3: '31.66',
        afterInstallRemarks: 'ALL GOOD. NO LEAKS AFTER ACTIVITY COMPLETION.',
        installRiserPipeSizeMm: '80',
        installRiserPipeCount: '12',
        soundingPipeLengthM: '72',
        afterInstallPressurePsi: '28',
        afterInstallIrL1: '29.5',
        afterInstallIrL2: '30.1',
        afterInstallIrL3: '32.33',
        afterInstallCurrentL1: '28',
        afterInstallCurrentL2: '27',
        afterInstallCurrentL3: '28',
        afterInstallVoltageL1: '231',
        afterInstallVoltageL2: '233',
        afterInstallVoltageL3: '235',
        installCableSizeMm2: '5.26',
        installCableLengthM: '75',
        operationDuration: '9 HOURS',
        reasonOfPullout: 'VIBRATION AND HIGH AMPERE',
        overallRemarks: 'PUMP REPLACED. ALL GOOD AFTER INSTALLATION',
      },
    };

    const payload = buildActivityDetailsPayload('well_pull_out', state, SAMPLE_METER_CALC);
    assert.equal(payload.reasonOfPullout, 'VIBRATION AND HIGH AMPERE');
    assert.equal(payload.pumpSettingM, '73');

    const rehydrated = hydrateActivityDetailFields(payload);
    assert.deepEqual(rehydrated.wellPullout, {
      ...state.wellPullout,
      afterSpliceRemarks: 'OK',
      acceptIrAbove2Meg: 'YES',
      acceptCurrentWithin14Pct: 'YES',
      acceptVoltageWithin10Pct: 'YES',
    });

    assert.deepEqual(
      evaluateWellPulloutAcceptance({
        ...INITIAL_WELL_PULLOUT_DETAILS,
        motorIrBeforeSpliceL1: '120',
        motorIrBeforeSpliceL2: '115',
        motorIrBeforeSpliceL3: '90',
        splicedIrL1: '1.5',
        splicedIrL2: '3',
        splicedIrL3: '3',
        afterInstallIrL1: '3',
        afterInstallIrL2: '3',
        afterInstallIrL3: '3',
        afterInstallCurrentL1: '20',
        afterInstallCurrentL2: '20',
        afterInstallCurrentL3: '35',
        afterInstallVoltageL1: '230',
        afterInstallVoltageL2: '260',
        afterInstallVoltageL3: '230',
      }),
      {
        electrode: 'YES',
        beforeSplice: 'NOT OK',
        afterSplice: 'NOT OK',
        ir2Meg: 'YES',
        currentUnbalance: 'NO',
        voltageVariation: 'NO',
      },
    );

    const summary = formatTelemetrySummary(makeActivity('well_pull_out', payload));
    assert.deepEqual(summary, [
      'Reason: VIBRATION AND HIGH AMPERE',
      'Pulled: SHAKTI INDIA DP 17-8',
      'Installed: DYNAFLOW DP17-8 (Repaired)',
      'Setting: 73m',
      'SWL/PWL: 35m/69m',
      'Duration: 9 HOURS',
    ]);
  });

  it('normalizes times/dates, computes overnight pull-out duration, and falls back Section 3 -> Section 5 specs', () => {
    assert.equal(normalizePulloutTimeHHMM('1300H'), '13:00');
    assert.equal(normalizePulloutTimeHHMM('8:30 am'), '08:30');
    assert.equal(normalizePulloutTimeHHMM('0130h'), '01:30');
    assert.equal(formatPulloutTimeDisplay('13:00'), '1300H');
    assert.equal(formatPulloutTimeDisplay('0800H'), '0800H');

    assert.equal(normalizePulloutDateYMD('November 20, 2026'), '2026-11-20');
    assert.equal(normalizePulloutDateYMD('', '2026-11-20'), '2026-11-20');
    assert.equal(formatPulloutDateDisplay('2026-11-20'), 'November 20, 2026');

    assert.equal(
      computePulloutDuration('2026-11-20', '10:00', '2026-11-21', '01:30'),
      '15.5 HOURS',
    );
    assert.equal(
      computePulloutDuration('', '1300H', '', '0100H', '2026-11-20'),
      '12 HOURS',
    );

    const stateWithSection3Only: ActivityDetailFieldsState = {
      ...INITIAL_ACTIVITY_DETAIL_FIELDS,
      wellPullout: {
        ...INITIAL_WELL_PULLOUT_DETAILS,
        dateStarted: '2026-11-20',
        timeStarted: '10:00',
        dateFinished: '2026-11-21',
        timeFinished: '01:30',
        pulledRiserPipeSizeMm: '80',
        pulledRiserPipeCount: '12',
        pulledCableSizeMm2: '5.26',
        pulledCableLengthM: '76',
        pulledCableSplicingCount: '1',
        pulledOverloadRelayRangeA: '24-36',
        pulledOverloadRelaySettingA: '30',
        pulledMagneticContactorRatingA: '50',
      },
    };
    const payload = buildActivityDetailsPayload('well_pull_out', stateWithSection3Only, SAMPLE_METER_CALC);
    const hydrated = hydrateActivityDetailFields(payload);
    assert.equal(hydrated.wellPullout.installRiserPipeSizeMm, '80');
    assert.equal(hydrated.wellPullout.installRiserPipeCount, '12');
    assert.equal(hydrated.wellPullout.installCableSizeMm2, '5.26');
    assert.equal(hydrated.wellPullout.installCableLengthM, '76');
    assert.equal(hydrated.wellPullout.installCableSplicingCount, '1');
    assert.equal(hydrated.wellPullout.installOverloadRelayRangeA, '24-36');
    assert.equal(hydrated.wellPullout.installOverloadRelaySettingA, '30');
    assert.equal(hydrated.wellPullout.installMagneticContactorRatingA, '50');
    assert.equal(hydrated.wellPullout.operationDuration, '15.5 HOURS');
    assert.equal(payload.operationDuration, '15.5 HOURS');
  });

  it('builds/round-trips tank_cleaning details, evaluates PNSDW clearance, computes downtime, and formats telemetry', () => {
    assert.equal(
      computeTankDowntime('2026-11-20', '08:00', '2026-11-20', '14:30'),
      '6 hrs 30 mins',
    );
    assert.equal(
      computeTankDowntime('2026-11-20', '22:00', '2026-11-21', '01:00'),
      '3 hrs',
    );
    assert.equal(
      formatTankReportNumber('2026-11-20', '35d9ae9f-1234', ''),
      'TCAR-2026-11-35D9',
    );
    assert.equal(
      formatTankReportNumber('2026-11-20', '35d9ae9f', 'TCAR-CUSTOM-01'),
      'TCAR-CUSTOM-01',
    );

    const clearedEval = evaluateTankWaterQuality({
      ...INITIAL_TANK_CLEANING_DETAILS,
      chlorinePost: '0.85',
      turbidityPost: '< 1.0',
      phPost: '7.2',
      odorPost: 'Clear / Odorless',
    });
    assert.deepEqual(clearedEval, {
      chlorine: 'PASS',
      turbidity: 'PASS',
      ph: 'PASS',
      odor: 'PASS',
      overall: 'CLEARED',
    });

    const holdEval = evaluateTankWaterQuality({
      ...INITIAL_TANK_CLEANING_DETAILS,
      chlorinePost: '2.40',
      turbidityPost: '0.6',
      phPost: '7.1',
      odorPost: 'Silt odor',
    });
    assert.deepEqual(holdEval, {
      chlorine: 'FAIL',
      turbidity: 'PASS',
      ph: 'PASS',
      odor: 'FAIL',
      overall: 'HOLD',
    });

    const incompleteEval = evaluateTankWaterQuality(INITIAL_TANK_CLEANING_DETAILS);
    assert.equal(incompleteEval.overall, 'INCOMPLETE');

    const tcState: ActivityDetailFieldsState = {
      ...INITIAL_ACTIVITY_DETAIL_FIELDS,
      tankCleaning: {
        ...INITIAL_TANK_CLEANING_DETAILS,
        tankId: 'Reservoir 1',
        tankType: 'Ground Reservoir',
        tankCapacity: '150',
        tankCapacityUnit: 'm³',
        dateStarted: '2026-11-20',
        timeStarted: '08:00',
        dateFinished: '2026-11-20',
        timeFinished: '14:30',
        chlorineDisinfection: '75',
        chlorinePost: '0.80',
        turbidityPost: '0.4',
        phPost: '7.2',
        odorPost: 'Clear / Odorless',
        conclusionRecommendations: 'Restored cleanly to service.',
        nextScheduledCleaningDate: '2027-05-20',
      },
    };

    const payload = buildActivityDetailsPayload('tank_cleaning', tcState, SAMPLE_METER_CALC);
    assert.equal(payload.totalDowntime, '6 hrs 30 mins');
    assert.equal(payload.sanitaryClearance, 'CLEARED');
    assert.equal(payload.tankId, 'Reservoir 1');

    const hydrated = hydrateActivityDetailFields(payload);
    assert.equal(hydrated.tankCleaning.totalDowntime, '6 hrs 30 mins');
    assert.equal(hydrated.tankCleaning.disinfectionConcentrationPpm, '75');
    assert.equal(hydrated.tankCleaning.nextScheduledCleaningDate, '2027-05-20');

    const summary = formatTelemetrySummary(makeActivity('tank_cleaning', payload));
    assert.deepEqual(summary, [
      'Tank: Reservoir 1 · Ground Reservoir (150 m³)',
      'Downtime: 6 hrs 30 mins',
      'Post Cl₂: 0.80 mg/L',
      'Turbidity: 0.4 NTU',
      'pH: 7.2',
      'CLEARED',
    ]);

    const fallbackAct = makeActivity('tank_cleaning', { tankType: 'Ground Reservoir' });
    fallbackAct.site_or_well = 'Pavia Tank 2';
    assert.deepEqual(formatTelemetrySummary(fallbackAct), ['Tank: Pavia Tank 2 · Ground Reservoir']);
  });
});
