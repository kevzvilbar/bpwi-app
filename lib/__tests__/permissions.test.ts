import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computePermissions } from '../permissions.ts';

describe('Role permission matrix', () => {
  it('grants full access to active admin', () => {
    const p = computePermissions({ role: 'admin', isActive: true });
    assert.equal(p.canAccessSetup, true);
    assert.equal(p.canViewOrgChart, true);
    assert.equal(p.canEditOrgChart, true);
    assert.equal(p.canRestructureOrgChart, true);
    assert.equal(p.canExportPmCsv, true);
    assert.equal(p.canExportLeaveCsv, true);
    assert.equal(p.canLogActivity, true);
    assert.equal(p.canVerifyActivity, true);
  });

  it('scopes department head (manager) properly with and without edit grant', () => {
    const noGrant = computePermissions({ role: 'manager', isActive: true, hasLiveEditGrant: false });
    assert.equal(noGrant.canViewOrgChart, true);
    assert.equal(noGrant.canEditOrgChart, true);
    assert.equal(noGrant.canExportPmCsv, true);
    assert.equal(noGrant.canExportLeaveCsv, true);
    assert.equal(noGrant.canRestructureOrgChart, false);
    assert.equal(noGrant.canEditSchedule, false);
    assert.equal(noGrant.canProposeRequests, true);
    assert.equal(noGrant.canVerifyActivity, true);
    assert.equal(noGrant.canAccessSetup, false);

    const withGrant = computePermissions({ role: 'manager', isActive: true, hasLiveEditGrant: true });
    assert.equal(withGrant.canEditSchedule, true);
    assert.equal(withGrant.canProposeRequests, false);
    assert.equal(withGrant.canClosePm, true);
  });

  it('allows active scheduler to export leave CSV and verify activities without setup access', () => {
    const sched = computePermissions({ role: 'scheduler', isActive: true });
    assert.equal(sched.canEditSchedule, true);
    assert.equal(sched.canExportLeaveCsv, true);
    assert.equal(sched.canVerifyActivity, true);
    assert.equal(sched.canAccessSetup, false);
  });

  it('blocks operators and viewers from org chart, setup, exports, and verification', () => {
    const op = computePermissions({ role: 'operator', isActive: true });
    assert.equal(op.canLogActivity, true);
    assert.equal(op.canClosePm, true);
    assert.equal(op.canViewOrgChart, false);
    assert.equal(op.canExportPmCsv, false);
    assert.equal(op.canExportLeaveCsv, false);
    assert.equal(op.canEditOrgChart, false);
    assert.equal(op.canVerifyActivity, false);
    assert.equal(op.canAccessSetup, false);

    const viewer = computePermissions({ role: 'viewer', isActive: true });
    assert.equal(viewer.canLogActivity, false);
    assert.equal(viewer.canViewOrgChart, false);
    assert.equal(viewer.canExportLeaveCsv, false);
    assert.equal(viewer.canEditSchedule, false);
  });

  it('revokes all privileged actions when isActive is false (resigned / pending)', () => {
    const inactiveAdmin = computePermissions({ role: 'admin', isActive: false, canApproveFlag: true });
    assert.equal(inactiveAdmin.isAdmin, false);
    assert.equal(inactiveAdmin.canAccessSetup, false);
    assert.equal(inactiveAdmin.canViewOrgChart, false);
    assert.equal(inactiveAdmin.canExportLeaveCsv, false);
    assert.equal(inactiveAdmin.canApproveRequests, false);
  });
});
