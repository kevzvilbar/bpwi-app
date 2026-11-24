import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateImportPayload } from '../import-validation.ts';

describe('validateImportPayload', () => {
  it('accepts a valid legacy JSON backup payload including leap-day dates and hex colors', () => {
    const res = validateImportPayload({
      operators: [{ id: 'op1', name: 'Operator A', role: 'Technician', phone: null }],
      shifts: { s1: { id: 's1', label: '7-4', hours: 8, isOff: false, bg: '#0d9488', text: '#fff' } },
      areaLeaves: [{ code: 'PL', name: 'Plant Operations', isLeave: false, bg: '#e2e8f0', text: '#0f172a' }],
      schedule: { op1: { '2024-02-29': { shift: 's1', text: 'PL', onCall: null } } },
      pmTasks: [{ id: 'pm1', type: 'FLUSH', date: '2026-11-25', status: 'planned', sites: ['Main Tank'], assignees: ['op1'] }],
    });
    assert.equal(res.ok, true);
  });

  it('rejects non-object top-level payloads', () => {
    assert.equal(validateImportPayload([]).ok, false);
    assert.equal(validateImportPayload('bad').ok, false);
  });

  it('rejects non-string operator names and duplicate ids', () => {
    const badName = validateImportPayload({
      operators: [{ id: 'op1', name: 12345 }],
    });
    assert.equal(badName.ok, false);
    if (!badName.ok) assert.match(badName.error, /operators\[0\]/);

    const dupOp = validateImportPayload({
      operators: [
        { id: 'op1', name: 'Operator A' },
        { id: 'op1', name: 'Operator B' },
      ],
    });
    assert.equal(dupOp.ok, false);
    if (!dupOp.ok) assert.match(dupOp.error, /Duplicate operator id/);
  });

  it('rejects impossible calendar dates, invalid PM statuses, duplicate task ids, and non-hex colors', () => {
    const badCalendarDate = validateImportPayload({
      schedule: { op1: { '2026-13-45': { shift: 's1' } } },
    });
    assert.equal(badCalendarDate.ok, false);
    if (!badCalendarDate.ok) assert.match(badCalendarDate.error, /valid YYYY-MM-DD/);

    const nonLeapFeb29 = validateImportPayload({
      schedule: { op1: { '2026-02-29': { shift: 's1' } } },
    });
    assert.equal(nonLeapFeb29.ok, false);

    const badStatus = validateImportPayload({
      pmTasks: [{ id: 'pm1', type: 'FLUSH', date: '2026-11-25', status: 'archived' }],
    });
    assert.equal(badStatus.ok, false);
    if (!badStatus.ok) assert.match(badStatus.error, /status/);

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
