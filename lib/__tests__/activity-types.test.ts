import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMeterTestResult,
  parse12DigitAccount,
  resolveActivityTypeFromPm,
} from '../activity-types.ts';

describe('computeMeterTestResult', () => {
  it('returns Passed / Retain when average error is within ±5%', () => {
    const res = computeMeterTestResult(10.0, 10.01, 10.02, 10.03, 0.01);
    assert.equal(res.avgErr, 0);
    assert.equal(res.verdict, 'Passed');
    assert.equal(res.recommendation, 'Retain');
  });

  it('returns Fast Moving / Replace when average error exceeds +5%', () => {
    const res = computeMeterTestResult(0, 0.011, 0.022, 0.033, 0.01);
    assert.equal(res.avgErr, 10);
    assert.equal(res.verdict, 'Fast Moving');
    assert.equal(res.recommendation, 'Replace');
  });

  it('returns Slow Moving / Replace when average error is below -5%', () => {
    const res = computeMeterTestResult(0, 0.008, 0.016, 0.024, 0.01);
    assert.equal(res.avgErr, -20);
    assert.equal(res.verdict, 'Slow Moving');
    assert.equal(res.recommendation, 'Replace');
  });

  it('handles null/invalid readings and zero reference volume safely', () => {
    const empty = computeMeterTestResult(null, null, null, null, 0.01);
    assert.equal(empty.avgErr, null);
    assert.equal(empty.verdict, null);

    const zeroRef = computeMeterTestResult(0, 0.01, 0.02, 0.03, 0);
    assert.equal(zeroRef.avgErr, null);
  });
});

describe('parse12DigitAccount', () => {
  it('parses contiguous 12-character account numbers', () => {
    const parsed = parse12DigitAccount('001002004012');
    assert.deepEqual(parsed, {
      projectCode: '001',
      phaseCode: '002',
      block: '004',
      lot: '012',
      blockLotFormatted: 'Block 004 Lot 012',
    });
  });

  it('parses hyphenated 12-character account numbers', () => {
    const parsed = parse12DigitAccount('PR2-001-007-019');
    assert.deepEqual(parsed, {
      projectCode: 'PR2',
      phaseCode: '001',
      block: '007',
      lot: '019',
      blockLotFormatted: 'Block 007 Lot 019',
    });
  });

  it('returns null for non-12-character strings', () => {
    assert.equal(parse12DigitAccount('12345'), null);
  });
});

describe('resolveActivityTypeFromPm', () => {
  it('maps legacy custom MMF Backwashing code to backwash', () => {
    const id = resolveActivityTypeFromPm(
      { activity_type: 'Xmwe7pim0', title: 'MMF Backwashing' },
      [{ code: 'Xmwe7pim0', label: 'MMF Backwashing', short_label: 'MMF Backwash' }],
    );
    assert.equal(id, 'backwash');
  });

  it('maps standard PM preset codes accurately', () => {
    assert.equal(resolveActivityTypeFromPm({ activity_type: 'FLUSH', title: 'Line Flushing' }), 'flushing');
    assert.equal(resolveActivityTypeFromPm({ activity_type: 'TANK', title: 'Tank Cleaning' }), 'tank_cleaning');
    assert.equal(resolveActivityTypeFromPm({ activity_type: 'PULL', title: 'Deep Well Pull-out' }), 'well_pull_out');
    assert.equal(resolveActivityTypeFromPm({ activity_type: 'THERM', title: 'Thermal Scanning' }), 'thermal_scanning');
    assert.equal(resolveActivityTypeFromPm({ activity_type: 'LEVEL', title: 'SWL & PWL' }), 'water_level_monitoring');
    assert.equal(resolveActivityTypeFromPm({ activity_type: 'GENSET', title: 'Genset PMS' }), 'genset_monitoring');
  });
});
