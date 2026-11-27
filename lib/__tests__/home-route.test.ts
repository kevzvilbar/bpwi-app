import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getScheduleNavHref, resolveDefaultHomePath } from '../home-route.ts';

describe('role-based home route helpers', () => {
  it('routes operators to /field by default when no explicit roster param is set', () => {
    assert.equal(resolveDefaultHomePath('operator'), '/field');
    assert.equal(resolveDefaultHomePath('operator', {}), '/field');
  });

  it('keeps operators on the roster when ?view=roster or ?m=... is explicitly requested', () => {
    assert.equal(resolveDefaultHomePath('operator', { view: 'roster' }), null);
    assert.equal(resolveDefaultHomePath('operator', { m: '2026-11' }), null);
  });

  it('keeps non-operator roles on the monthly roster at /', () => {
    for (const role of ['admin', 'scheduler', 'manager', 'viewer', null, undefined]) {
      assert.equal(resolveDefaultHomePath(role, {}), null);
    }
  });

  it('returns /?view=roster for the operator Schedule nav link and / for other roles', () => {
    assert.equal(getScheduleNavHref('operator'), '/?view=roster');
    assert.equal(getScheduleNavHref('admin'), '/');
    assert.equal(getScheduleNavHref('scheduler'), '/');
    assert.equal(getScheduleNavHref('manager'), '/');
    assert.equal(getScheduleNavHref('viewer'), '/');
  });
});
