export type AppRole = 'admin' | 'scheduler' | 'manager' | 'operator' | 'viewer';

export interface PermissionContext {
  role: string;
  isActive: boolean;
  canApproveFlag?: boolean;
  hasLiveEditGrant?: boolean;
}

export function computePermissions(ctx: PermissionContext) {
  const active = Boolean(ctx.isActive);
  const role = ctx.role as AppRole;
  const isAdmin = active && role === 'admin';
  const isScheduler = active && role === 'scheduler';
  const isManager = active && role === 'manager';
  const isOperator = active && role === 'operator';
  const hasGrant = isManager && Boolean(ctx.hasLiveEditGrant);

  return {
    isAdmin,
    isManager,
    canEditSchedule: isAdmin || isScheduler || hasGrant,
    canGenerateSchedule: isAdmin || isScheduler,
    canApproveRequests: isAdmin || (active && Boolean(ctx.canApproveFlag)),
    canProposeRequests: isManager && !hasGrant,
    canClosePm: isAdmin || isScheduler || isOperator || hasGrant,
    canLogActivity: isAdmin || isOperator,
    canVerifyActivity: isAdmin || isScheduler || isManager,
    canViewOrgChart: isAdmin || isScheduler || isManager,
    canEditOrgChart: isAdmin || isManager,
    canRestructureOrgChart: isAdmin,
    canExportPmCsv: isAdmin || isManager,
    canExportLeaveCsv: isAdmin || isScheduler || isManager,
    canAccessSetup: isAdmin,
  };
}
