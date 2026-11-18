import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePositionDisplayName,
  wouldCreateCycle,
  collectSubordinatePositionIds,
  type OrgPositionRow,
  type OrgUserLite,
  type OrgOperatorLite,
} from '../org-chart.ts';

function makePos(overrides: Partial<OrgPositionRow> & { id: string; title: string }): OrgPositionRow {
  return {
    organization_id: 'org1',
    department_group: 'OPS',
    tier: 'staff',
    parent_position_id: null,
    secondary_parent_id: null,
    holder_user_id: null,
    holder_operator_id: null,
    fallback_name: null,
    shift_badge: null,
    color_theme: 'slate',
    is_vacant: false,
    is_active: true,
    sort_order: 0,
    ...overrides,
  };
}

describe('org-chart helpers', () => {
  it('resolves display name priority: vacant > active user > operator > directory fallback', () => {
    const users = new Map<string, OrgUserLite>([
      ['u1', { id: 'u1', full_name: 'New Tech Head', role: 'manager', is_active: true }],
      ['u2', { id: 'u2', full_name: 'Resigned Head', role: 'manager', is_active: false }],
    ]);
    const ops = new Map<string, OrgOperatorLite>([
      ['op1', { id: 'op1', full_name: 'Jasson Salarda', position: 'Leak Detection Spec.', is_active: true }],
    ]);

    assert.equal(resolvePositionDisplayName(makePos({ id: 'p1', title: 'Tech Head', is_vacant: true, fallback_name: 'Old' }), users, ops).source, 'vacant');
    assert.equal(resolvePositionDisplayName(makePos({ id: 'p2', title: 'Tech Head', holder_user_id: 'u1', fallback_name: 'Old' }), users, ops).name, 'New Tech Head');
    assert.equal(resolvePositionDisplayName(makePos({ id: 'p3', title: 'Tech Head', holder_user_id: 'u2', holder_operator_id: 'op1' }), users, ops).name, 'Jasson Salarda');
    assert.equal(resolvePositionDisplayName(makePos({ id: 'p4', title: 'Customer Service', fallback_name: 'Haydeline Quinto' }), users, ops).source, 'directory');
  });

  it('detects circular reporting lines before saving restructuring', () => {
    const exec = makePos({ id: 'exec', title: 'BU Head', tier: 'executive' });
    const head = makePos({ id: 'head', title: 'Tech Head', tier: 'head', parent_position_id: 'exec' });
    const staff = makePos({ id: 'staff', title: 'Maint', tier: 'staff', parent_position_id: 'head' });
    const list = [exec, head, staff];

    assert.equal(wouldCreateCycle(list, 'exec', 'staff'), true);
    assert.equal(wouldCreateCycle(list, 'head', 'head'), true);
    assert.equal(wouldCreateCycle(list, 'staff', 'exec'), false);
  });

  it('collects direct and bridged subordinate positions under a head', () => {
    const head = makePos({ id: 'h1', title: 'Tech Head', tier: 'head' });
    const lead = makePos({ id: 'l1', title: 'Leadman', tier: 'leadman', parent_position_id: 'h1' });
    const s1 = makePos({ id: 's1', title: 'Tech 1', parent_position_id: 'h1' });
    const s2 = makePos({ id: 's2', title: 'Tech 2', parent_position_id: 'l1' });
    const subs = collectSubordinatePositionIds([head, lead, s1, s2], 'h1');
    assert.deepEqual([...subs].sort(), ['l1', 's1', 's2']);
  });
});
