export interface JobOrderSlaDef {
  id: string;
  label: string;
  slaDays: number;
  slaHours: number;
  defaultPriority: 'low' | 'medium' | 'high';
  activityType: string;
  description: string;
}

export const JOB_ORDER_SLA_STANDARDS: readonly JobOrderSlaDef[] = [
  {
    id: 'new_connection',
    label: 'New Connection / New Meter Installation',
    slaDays: 5,
    slaHours: 120,
    defaultPriority: 'medium',
    activityType: 'meter_inst',
    description: '5 calendar days standard response',
  },
  {
    id: 'leakage',
    label: 'Leakage',
    slaDays: 1,
    slaHours: 24,
    defaultPriority: 'high',
    activityType: 'leak_repair',
    description: '1 day (24 hrs) urgent response',
  },
  {
    id: 'meter_relocation',
    label: 'Meter Relocation',
    slaDays: 5,
    slaHours: 120,
    defaultPriority: 'medium',
    activityType: 'meter_relocation',
    description: '5 calendar days standard response',
  },
  {
    id: 'water_quality_complaint',
    label: 'Water Quality Complaint',
    slaDays: 1,
    slaHours: 24,
    defaultPriority: 'high',
    activityType: 'water_sampling',
    description: '1 day (24 hrs) urgent response',
  },
  {
    id: 'low_pressure_complaint',
    label: 'Low Pressure Complaint',
    slaDays: 1,
    slaHours: 24,
    defaultPriority: 'high',
    activityType: 'low_pressure',
    description: '1 day (24 hrs) urgent response',
  },
  {
    id: 'no_water_supply_complaint',
    label: 'No Water Supply Complaint',
    slaDays: 1,
    slaHours: 24,
    defaultPriority: 'high',
    activityType: 'no_water_supply',
    description: '1 day (24 hrs) urgent response',
  },
  {
    id: 'meter_replacement',
    label: 'Meter Replacement',
    slaDays: 3,
    slaHours: 72,
    defaultPriority: 'medium',
    activityType: 'meter_replacement',
    description: '3 calendar days standard response',
  },
  {
    id: 'valve_replacement',
    label: 'Valve Replacement',
    slaDays: 3,
    slaHours: 72,
    defaultPriority: 'medium',
    activityType: 'valve_replacement',
    description: '3 calendar days standard response',
  },
  {
    id: 'meter_testing',
    label: 'Meter Testing',
    slaDays: 5,
    slaHours: 120,
    defaultPriority: 'medium',
    activityType: 'meter_test',
    description: '5 calendar days standard response',
  },
];

export const JOB_ORDER_SLA_BY_ID: Record<string, JobOrderSlaDef> = Object.fromEntries(
  JOB_ORDER_SLA_STANDARDS.map((s) => [s.id, s]),
);

export function findJobOrderSlaByActivityType(activityType: string | null | undefined): JobOrderSlaDef | null {
  if (!activityType) return null;
  if (activityType === 'leak_detection') return JOB_ORDER_SLA_BY_ID.leakage ?? null;
  return JOB_ORDER_SLA_STANDARDS.find((s) => s.activityType === activityType) ?? null;
}

export function formatSlaDurationLabel(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours) || hours <= 0) return 'Custom';
  if (hours === 24) return '1 day (24 hrs)';
  if (hours % 24 === 0) return `${hours / 24} days (${hours} hrs)`;
  return `${hours} hrs`;
}

/**
 * Adds exact calendar hours (`slaHours`) to `baseDate` and formats `YYYY-MM-DDTHH:mm`
 * in Asia/Manila for `<input type="datetime-local">`.
 */
export function computeSlaDeadlineManilaLocal(slaHours: number, baseDate: Date = new Date()): string {
  const target = new Date(baseDate.getTime() + slaHours * 3_600_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(target);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hh = get('hour') === '24' ? '00' : get('hour').padStart(2, '0');
  const mm = get('minute').padStart(2, '0');
  return `${get('year')}-${get('month')}-${get('day')}T${hh}:${mm}`;
}

export type JobOrderSlaState = 'met' | 'breached_closed' | 'breached_open' | 'at_risk' | 'on_track' | 'none';

export interface JobOrderSlaStatus {
  state: JobOrderSlaState;
  isOverdue: boolean;
  badgeLabel: string;
  detailLabel: string;
}

function formatDurationDelta(ms: number): string {
  const totalMins = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  if (totalMins < 60) return `${totalMins}m`;
  const totalHours = Math.floor(totalMins / 60);
  const remMins = totalMins % 60;
  if (totalHours < 24) return `${totalHours}h${remMins ? ` ${remMins}m` : ''}`;
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  return `${days}d${remHours ? ` ${remHours}h` : ''}`;
}

export function computeJobOrderSlaStatus(
  jo: {
    status: string;
    created_at: string;
    deadline: string | null;
    completed_at: string | null;
    estimated_hours?: number | null;
  },
  nowMs: number = Date.now(),
): JobOrderSlaStatus {
  if (jo.status === 'cancelled') {
    return { state: 'none', isOverdue: false, badgeLabel: 'CANCELLED', detailLabel: 'Cancelled' };
  }
  if (!jo.deadline) {
    return {
      state: 'none',
      isOverdue: false,
      badgeLabel: jo.status.replace('_', ' ').toUpperCase(),
      detailLabel: 'No SLA deadline set',
    };
  }

  const deadlineMs = new Date(jo.deadline).getTime();
  if (!Number.isFinite(deadlineMs)) {
    return {
      state: 'none',
      isOverdue: false,
      badgeLabel: jo.status.replace('_', ' ').toUpperCase(),
      detailLabel: 'Invalid SLA deadline',
    };
  }

  if (jo.status === 'completed') {
    const doneMs = jo.completed_at ? new Date(jo.completed_at).getTime() : nowMs;
    if (Number.isFinite(doneMs) && doneMs <= deadlineMs) {
      const earlyMs = deadlineMs - doneMs;
      return {
        state: 'met',
        isOverdue: false,
        badgeLabel: 'MET SLA',
        detailLabel: earlyMs >= 60_000 ? `Closed ${formatDurationDelta(earlyMs)} early` : 'Closed on SLA target',
      };
    }
    const lateMs = Number.isFinite(doneMs) ? Math.max(60_000, doneMs - deadlineMs) : 60_000;
    return {
      state: 'breached_closed',
      isOverdue: true,
      badgeLabel: 'BREACHED SLA',
      detailLabel: `Exceeded SLA by ${formatDurationDelta(lateMs)}`,
    };
  }

  const remainingMs = deadlineMs - nowMs;
  if (remainingMs < 0) {
    return {
      state: 'breached_open',
      isOverdue: true,
      badgeLabel: 'SLA BREACH',
      detailLabel: `Overdue by ${formatDurationDelta(-remainingMs)}`,
    };
  }

  const createdMs = new Date(jo.created_at).getTime();
  const windowMs =
    Number.isFinite(createdMs) && deadlineMs > createdMs
      ? deadlineMs - createdMs
      : (jo.estimated_hours && jo.estimated_hours > 0 ? jo.estimated_hours : 24) * 3_600_000;
  const atRiskThresholdMs = Math.min(6 * 3_600_000, windowMs * 0.25);

  if (remainingMs <= atRiskThresholdMs) {
    return {
      state: 'at_risk',
      isOverdue: false,
      badgeLabel: 'AT RISK',
      detailLabel: `${formatDurationDelta(remainingMs)} left`,
    };
  }

  return {
    state: 'on_track',
    isOverdue: false,
    badgeLabel: jo.status.replace('_', ' ').toUpperCase(),
    detailLabel: `${formatDurationDelta(remainingMs)} left`,
  };
}
