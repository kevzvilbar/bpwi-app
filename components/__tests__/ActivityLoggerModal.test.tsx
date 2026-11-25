import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ActivityLoggerModal, {
  type LoggerArea,
  type LoggerAssignment,
  type LoggerOperator,
  type LoggerShift,
} from '@/components/ActivityLoggerModal';
import type { DailyActivityRow, LinkedJobOrder, LinkedPmTask } from '@/lib/activity-types';

type InsertResult = Promise<{ data: DailyActivityRow | null; error: { message: string } | null }>;
type UpdateResult = Promise<{ error: { message: string } | null }>;

const activityInsertSingleMock = vi.fn<() => InsertResult>();
const activityInsertPayloads: Record<string, unknown>[] = [];
const pmUpdateEqMock = vi.fn<(col: string, val: string) => UpdateResult>();
const pmUpdateMock = vi.fn((_values: Record<string, unknown>) => ({
  eq: pmUpdateEqMock,
}));
const joUpdateEqMock = vi.fn<(col: string, val: string) => UpdateResult>();
const joUpdateMock = vi.fn((_values: Record<string, unknown>) => ({
  eq: joUpdateEqMock,
}));

vi.mock('@/lib/supabase/client', () => ({
  supabaseBrowser: () => ({
    from: (table: string) => {
      if (table === 'daily_activities') {
        return {
          insert: (payload: Record<string, unknown>) => {
            activityInsertPayloads.push(payload);
            return {
              select: (_cols: string) => ({
                single: activityInsertSingleMock,
              }),
            };
          },
        };
      }
      if (table === 'pm_tasks') {
        return {
          update: pmUpdateMock,
        };
      }
      if (table === 'job_orders') {
        return {
          update: joUpdateMock,
        };
      }
      throw new Error(`Unexpected table mock: ${table}`);
    },
  }),
}));

const OPERATORS: LoggerOperator[] = [
  { id: 'op-1', full_name: 'Alice Santos', position: 'Senior Operator' },
  { id: 'op-2', full_name: 'Bob Reyes', position: 'Operator' },
];

const AREAS: LoggerArea[] = [
  { id: 'area-pl', code: 'PL', name: 'Main Plant', category: 'station', sub_sites: ['Well 1'] },
];

const SHIFTS: LoggerShift[] = [
  { id: 'shift-day', code: 'D1', description: 'Day Shift', is_off: false },
];

const ASSIGNMENTS: LoggerAssignment[] = [
  { operator_id: 'op-1', shift_type_id: 'shift-day', area_code_id: 'area-pl' },
];

const LINKED_PM: LinkedPmTask = {
  id: 'pm-1',
  title: 'Pump Pressure Check',
  activity_type: 'pump_monitoring',
  locations: ['PL'],
  assigned_operator_ids: ['op-1'],
};

const LINKED_JO: LinkedJobOrder = {
  id: 'jo-1',
  jo_number: 'JO-2026-001',
  title: 'Check Mainline Valve',
  activity_type: 'pump_monitoring',
  area_code_id: 'area-pl',
  assigned_operator_ids: ['op-1'],
};

function makeSavedRow(overrides: Partial<DailyActivityRow> = {}): DailyActivityRow {
  return {
    id: 'act-1',
    organization_id: 'org-1',
    activity_date: '2026-04-10',
    logged_by: 'user-1',
    lead_operator_id: 'op-1',
    crew_operator_ids: [],
    shift_type_id: 'shift-day',
    area_code_id: 'area-pl',
    site_or_well: null,
    block_lot: null,
    activity_type: 'pump_monitoring',
    pm_task_id: null,
    status: 'submitted',
    started_at: null,
    completed_at: '2026-04-10T08:00:00+08:00',
    gps_lat: null,
    gps_lng: null,
    notes: null,
    details: {},
    photo_urls: [],
    photo_storage_paths: [],
    photos_expires_at: null,
    photos_purged_at: null,
    verified_by: null,
    verified_at: null,
    review_note: null,
    is_sample: false,
    created_at: '2026-04-10T08:00:00Z',
    updated_at: '2026-04-10T08:00:00Z',
    ...overrides,
  };
}

describe('ActivityLoggerModal', () => {
  const originalOnLineDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');

  beforeEach(() => {
    vi.clearAllMocks();
    activityInsertPayloads.length = 0;
    pmUpdateEqMock.mockResolvedValue({ error: null });
    joUpdateEqMock.mockResolvedValue({ error: null });
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    if (originalOnLineDescriptor) {
      Object.defineProperty(Navigator.prototype, 'onLine', originalOnLineDescriptor);
    } else {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value: true,
      });
    }
  });

  it('submits daily_activities insert with is_sample: false for an operator', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    activityInsertSingleMock.mockResolvedValue({ data: makeSavedRow({ is_sample: false }), error: null });

    render(
      <ActivityLoggerModal
        open
        onClose={onClose}
        onSaved={onSaved}
        orgId="org-1"
        userId="user-op"
        role="operator"
        operatorId="op-1"
        date="2026-04-10"
        operators={OPERATORS}
        areas={AREAS}
        shifts={SHIFTS}
        assignments={ASSIGNMENTS}
        sampleOnly={false}
      />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Log as sample/i })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/Field Notes \/ Observations/i), 'Routine pump check');
    await user.click(screen.getByRole('button', { name: 'Submit Activity Log' }));

    await waitFor(() => {
      expect(activityInsertSingleMock).toHaveBeenCalledTimes(1);
    });
    expect(activityInsertPayloads[0]).toMatchObject({
      organization_id: 'org-1',
      activity_date: '2026-04-10',
      logged_by: 'user-op',
      lead_operator_id: 'op-1',
      activity_type: 'pump_monitoring',
      notes: 'Routine pump check',
      is_sample: false,
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('locks and checks sample checkbox when sampleOnly is true and submits is_sample: true without updating pm_tasks or job_orders', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    activityInsertSingleMock.mockResolvedValue({ data: makeSavedRow({ is_sample: true }), error: null });

    render(
      <ActivityLoggerModal
        open
        onClose={onClose}
        onSaved={onSaved}
        orgId="org-1"
        userId="user-mgr"
        role="manager"
        operatorId={null}
        date="2026-04-10"
        operators={OPERATORS}
        areas={AREAS}
        shifts={SHIFTS}
        assignments={ASSIGNMENTS}
        linkedPmTask={LINKED_PM}
        linkedJobOrder={LINKED_JO}
        canLogSample
        sampleOnly
      />,
    );

    const sampleCheckbox = screen.getByRole('checkbox', {
      name: /Log as sample \(auto-deletes in 24h\)/i,
    });
    expect(sampleCheckbox).toBeChecked();
    expect(sampleCheckbox).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /Log Activity & Complete PM/i }));

    await waitFor(() => {
      expect(activityInsertSingleMock).toHaveBeenCalledTimes(1);
    });
    expect(activityInsertPayloads[0]).toMatchObject({
      organization_id: 'org-1',
      logged_by: 'user-mgr',
      pm_task_id: 'pm-1',
      job_order_id: 'jo-1',
      is_sample: true,
    });
    expect(pmUpdateMock).not.toHaveBeenCalled();
    expect(joUpdateMock).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('queues offline submission via onQueuedOffline when navigator.onLine is false', async () => {
    const user = userEvent.setup();
    const onQueuedOffline = vi.fn();
    const onSaved = vi.fn();
    const onClose = vi.fn();

    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    render(
      <ActivityLoggerModal
        open
        onClose={onClose}
        onSaved={onSaved}
        onQueuedOffline={onQueuedOffline}
        orgId="org-1"
        userId="user-op"
        role="operator"
        operatorId="op-1"
        date="2026-04-10"
        operators={OPERATORS}
        areas={AREAS}
        shifts={SHIFTS}
        assignments={ASSIGNMENTS}
        sampleOnly={false}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Submit Activity Log' }));

    await waitFor(() => {
      expect(onQueuedOffline).toHaveBeenCalledTimes(1);
    });
    expect(onQueuedOffline).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'org-1',
        activity_date: '2026-04-10',
        is_sample: false,
      }),
    );
    expect(activityInsertSingleMock).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: 'org-1' }),
      { offline: true },
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
