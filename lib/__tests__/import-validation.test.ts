import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateImportPayload } from '../import-validation.ts';

describe('validateImportPayload', () => {
  it('accepts a valid legacy JSON backup payload', () => {
    const res = validateImportPayload({
      operators: [{ id: 'op1', name: 'Operator A', role: 'Technician', phone: null }],
      shifts: { s1: { id: 's1', label: '7-4', hours: 8, isOff: false } },
      areaLeaves: [{ code: 'PL', name: 'Plant Operations', isLeave: false }],
      schedule: { op1: { '2026-11-24': { shift: 's1', text: 'PL', onCall: null } } },
      pmTasks: [{ id: 'pm1', type: 'FLUSH', date: '2026-11-25', sites: ['Main Tank'], assignees: ['op1'] }],
    });
    assert.equal(res.ok, true);
  });

  it('rejects non-object top-level payloads', () => {
    const arrRes = validateImportPayload([]);
    assert.equal(arrRes.ok, false);
    const strRes = validateImportPayload('bad');
    assert.equal(strRes.ok, false);
  });

  it('rejects non-string operator names instead of letting DB throw 500', () => {
    const res = validateImportPayload({
      operators: [{ id: 'op1', name: 12345 }],
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /operators\[0\]/);
  });

  it('rejects invalid schedule date keys and malformed PM tasks', () => {
    const badDate = validateImportPayload({
      schedule: { op1: { '11/24/2026': { shift: 's1' } } },
    });
    assert.equal(badDate.ok, false);
    if (!badDate.ok) assert.match(badDate.error, /YYYY-MM-DD/);

    const badTask = validateImportPayload({
      pmTasks: [{ id: 'pm1', type: 'FLUSH', date: 'invalid-date' }],
    });
    assert.equal(badTask.ok, false);
    if (!badTask.ok) assert.match(badTask.error, /pmTasks\[0\]\.date/);
  });
});
