import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateImportPayload } from '../import-validation.ts';

describe('validateImportPayload', () => {
  it('accepts a realistic legacy export fixture (white blank shift, named colors, null/postponed PM statuses, leap-day dates)', () => {
    const res = validateImportPayload({
      operators: [
        { id: 'op_1', name: 'Operator One', role: 'Plant Operator', phone: null, defaultStation: 'PW' },
        { id: 'op_2', name: 'Operator Two', role: 'Technician', phone: '555-0102', defaultStation: 'RM' },
      ],
      shifts: {
        white: { id: 'white', label: '', name: 'Blank / Unassigned', hours: 0, isOff: true, bg: 'white', text: 'black' },
        s_day: { id: 's_day', label: '7-4', name: 'Day Shift', hours: 8, isOff: false, bg: '#0d9488', text: '#ffffff' },
      },
      areaLeaves: [
        { code: 'PL', name: 'Plant Operations', isLeave: false, bg: '#e2e8f0', text: '#0f172a' },
        { code: 'VL', name: 'Vacation Leave', isLeave: true, bg: 'gold', text: '#111' },
      ],
      schedule: {
        op_1: {
          '2024-02-29': { shift: 's_day', text: 'PL', onCall: null },
          '2026-11-24': { shift: 'white', text: null, onCall: 'OC' },
        },
      },
      pmTasks: [
        { id: 'pm_1', type: 'FLUSH', date: '2026-11-25', status: 'planned', sites: ['Main Tank'], assignees: ['op_1'] },
        { id: 'pm_2', type: 'TANK', date: '2026-11-26', status: 'postponed', site: 'Tank 2', doneOn: null, notes: null },
        { id: 'pm_3', type: 'PULL', date: '2026-11-27', status: 'done', doneOn: '2026-11-27' },
        { id: 'pm_4', type: 'THERM', date: '2026-11-28', status: null },
        { id: 'pm_5', type: 'LEVEL', date: '2026-11-29' },
      ],
    });
    assert.equal(res.ok, true);
  });

  it('rejects non-object top-level payloads', () => {
    assert.equal(validateImportPayload([]).ok, false);
    assert.equal(validateImportPayload('bad').ok, false);
  });

  it('rejects non-string operator names, empty non-white shift labels, and duplicate ids', () => {
    const badName = validateImportPayload({
      operators: [{ id: 'op1', name: 12345 }],
    });
    assert.equal(badName.ok, false);
    if (!badName.ok) assert.match(badName.error, /operators\[0\]/);

    const emptyNormalLabel = validateImportPayload({
      shifts: { s1: { id: 's1', label: '' } },
    });
    assert.equal(emptyNormalLabel.ok, false);

    const dupOp = validateImportPayload({
      operators: [
        { id: 'op1', name: 'Operator A' },
        { id: 'op1', name: 'Operator B' },
      ],
    });
    assert.equal(dupOp.ok, false);
    if (!dupOp.ok) assert.match(dupOp.error, /Duplicate operator id/);
  });

  it('rejects impossible calendar dates, non-DB PM statuses, duplicate task ids, and unsafe color strings', () => {
    const badCalendarDate = validateImportPayload({
      schedule: { op1: { '2026-13-45': { shift: 's1' } } },
    });
    assert.equal(badCalendarDate.ok, false);
    if (!badCalendarDate.ok) assert.match(badCalendarDate.error, /valid YYYY-MM-DD/);

    const nonLeapFeb29 = validateImportPayload({
      schedule: { op1: { '2026-02-29': { shift: 's1' } } },
    });
    assert.equal(nonLeapFeb29.ok, false);

    for (const invalidStatus of ['in_progress', 'cancelled', 'archived']) {
      const badStatus = validateImportPayload({
        pmTasks: [{ id: 'pm1', type: 'FLUSH', date: '2026-11-25', status: invalidStatus }],
      });
      assert.equal(badStatus.ok, false, `Expected status "${invalidStatus}" to be rejected`);
      if (!badStatus.ok) assert.match(badStatus.error, /planned, done, or postponed/);
    }

    const dupPm = validateImportPayload({
      pmTasks: [
        { id: 'pm1', type: 'FLUSH', date: '2026-11-25' },
        { id: 'pm1', type: 'TANK', date: '2026-11-26' },
      ],
    });
    assert.equal(dupPm.ok, false);
    if (!dupPm.ok) assert.match(dupPm.error, /Duplicate pmTasks id/);

    const badColor = validateImportPayload({
      shifts: { s1: { id: 's1', label: '7-4', bg: 'red;expression(alert(1))' } },
    });
    assert.equal(badColor.ok, false);
    if (!badColor.ok) assert.match(badColor.error, /shifts\["s1"\]/);
  });
});
