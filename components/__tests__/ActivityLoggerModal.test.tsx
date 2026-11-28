import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

vi.mock('@/components/ActivityMediaCapture', () => ({
  default: ({ onGpsChange }: { onGpsChange: (fix: Record<string, unknown>) => void }) => (
    <>
      <button type="button" onClick={() => onGpsChange({ lat: 14.5995, lng: 120.9842, accuracyM: 5, source: 'gps' })}>
        Test attach GPS
      </button>
      <button type="button" onClick={() => onGpsChange({ lat: null, lng: null, accuracyM: null, source: null })}>
        Test clear GPS
      </button>
    </>
  ),
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
    await user.click(screen.getByRole('button', { name: 'Test attach GPS' }));
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

    await user.click(screen.getByRole('button', { name: 'Test attach GPS' }));
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

    await user.click(screen.getByRole('button', { name: 'Test attach GPS' }));
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
      { editingId: null, expectedUpdatedAt: null },
    );
    expect(activityInsertSingleMock).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: 'org-1' }),
      { offline: true },
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes immediately on clean backdrop click, and prompts discard confirmation when dirty', async () => {
    const user = userEvent.setup();
    const cleanOnClose = vi.fn();

    const { unmount } = render(
      <ActivityLoggerModal
        open
        onClose={cleanOnClose}
        onSaved={vi.fn()}
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

    await user.click(screen.getByRole('dialog'));
    expect(cleanOnClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Discard unsaved activity log\?/i)).not.toBeInTheDocument();
    unmount();

    const dirtyOnClose = vi.fn();
    render(
      <ActivityLoggerModal
        open
        onClose={dirtyOnClose}
        onSaved={vi.fn()}
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

    await user.type(screen.getByLabelText(/Field Notes \/ Observations/i), 'Unsaved field note');
    await user.click(screen.getByRole('dialog'));

    expect(dirtyOnClose).not.toHaveBeenCalled();
    expect(screen.getByText('Discard unsaved activity log?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Keep Editing' }));
    expect(screen.queryByText('Discard unsaved activity log?')).not.toBeInTheDocument();
    expect(dirtyOnClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('dialog'));
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(dirtyOnClose).toHaveBeenCalledTimes(1);
  });

  it('passes pmUpdateFailed and linkedWarning when linked PM update fails after insert', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    activityInsertSingleMock.mockResolvedValue({ data: makeSavedRow({ pm_task_id: 'pm-1' }), error: null });
    pmUpdateEqMock.mockResolvedValueOnce({ error: { message: 'PM RLS denied' } });

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
        linkedPmTask={LINKED_PM}
        sampleOnly={false}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Test attach GPS' }));
    await user.click(screen.getByRole('button', { name: /Log Activity & Complete PM/i }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ pm_task_id: 'pm-1' }),
      expect.objectContaining({
        pmUpdateFailed: true,
        linkedWarning: expect.stringContaining('PM RLS denied'),
      }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  const loggerProps = {
    open: true,
    orgId: 'org-1',
    userId: 'user-op',
    role: 'operator',
    operatorId: 'op-1',
    date: '2026-04-10',
    operators: OPERATORS,
    areas: AREAS,
    shifts: SHIFTS,
    assignments: ASSIGNMENTS,
    sampleOnly: false,
  };

  it.each(['TypeError: Failed to fetch', 'TypeError: Load failed'])(
    'queues under the same id as the first attempt when the response is lost (%s)',
    async (message) => {
      const user = userEvent.setup();
      const onQueuedOffline = vi.fn();
      activityInsertSingleMock.mockResolvedValue({ data: null, error: { message } });

      render(<ActivityLoggerModal {...loggerProps} onClose={vi.fn()} onSaved={vi.fn()} onQueuedOffline={onQueuedOffline} />);
      await user.click(screen.getByRole('button', { name: 'Test attach GPS' }));
      await user.click(screen.getByRole('button', { name: 'Submit Activity Log' }));

      await waitFor(() => expect(onQueuedOffline).toHaveBeenCalledTimes(1));
      expect(activityInsertPayloads[0].id).toEqual(expect.any(String));
      expect(onQueuedOffline.mock.calls[0][0].id).toBe(activityInsertPayloads[0].id);
    },
  );

  it('reuses the id when the user submits again after an error', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    activityInsertSingleMock
      .mockResolvedValueOnce({ data: null, error: { message: 'Service unavailable' } })
      .mockResolvedValueOnce({ data: makeSavedRow(), error: null });

    render(<ActivityLoggerModal {...loggerProps} onClose={vi.fn()} onSaved={onSaved} />);
    await user.click(screen.getByRole('button', { name: 'Test attach GPS' }));
    await user.click(screen.getByRole('button', { name: 'Submit Activity Log' }));
    await screen.findByText(/Service unavailable/);
    await user.click(screen.getByRole('button', { name: 'Submit Activity Log' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(activityInsertPayloads[1].id).toBe(activityInsertPayloads[0].id);
  });

  it('blocks an incomplete chlorine refill, then saves the drum and dosing readings', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    activityInsertSingleMock.mockResolvedValue({ data: makeSavedRow({ activity_type: 'chlorine_refill' }), error: null });

    render(<ActivityLoggerModal {...loggerProps} onClose={vi.fn()} onSaved={onSaved} />);
    await user.selectOptions(screen.getByLabelText(/Activity Type/i), 'chlorine_refill');
    await user.click(screen.getByRole('button', { name: 'Test attach GPS' }));
    await user.click(screen.getByRole('button', { name: 'Submit Activity Log' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/before refilling/);
    expect(activityInsertSingleMock).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/Drum level before/i), '15');
    await user.click(screen.getByRole('button', { name: 'Submit Activity Log' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Select the chlorine chemical type/i);
    expect(activityInsertSingleMock).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText(/Chlorine type/i), 'Sodium Hypochlorite 12.5% (liquid)');
    expect((screen.getByRole('option', { name: 'Kilograms (kg)' }) as HTMLOptionElement).disabled).toBe(true);
    await user.type(screen.getByLabelText(/Chlorine added/i), '4.25');
    await user.type(screen.getByLabelText(/^Pump stroke/i), '55');
    await user.click(screen.getByRole('button', { name: 'Submit Activity Log' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(activityInsertPayloads[0]).toMatchObject({
      activity_type: 'chlorine_refill',
      details: { drumLevelBefore: 15, amountAdded: 4.25, amountUnit: 'L', pumpStrokePct: 55, newPumpStrokePct: null },
    });
  });

  it('requires GPS before a new log can be saved or queued offline', async () => {
    const user = userEvent.setup();
    const onQueuedOffline = vi.fn();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });

    render(<ActivityLoggerModal {...loggerProps} onClose={vi.fn()} onSaved={vi.fn()} onQueuedOffline={onQueuedOffline} />);
    await user.click(screen.getByRole('button', { name: 'Submit Activity Log' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/GPS location is required/);
    expect(onQueuedOffline).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Test attach GPS' }));
    await user.click(screen.getByRole('button', { name: 'Submit Activity Log' }));
    await waitFor(() => expect(onQueuedOffline).toHaveBeenCalledTimes(1));
    expect(onQueuedOffline.mock.calls[0][0]).toMatchObject({
      gps_lat: 14.5995,
      gps_lng: 120.9842,
      created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it('passes editingId and expectedUpdatedAt when queuing an edited activity offline', async () => {
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
        editingActivity={makeSavedRow({ id: 'act-edit-99', status: 'flagged', updated_at: '2026-04-10T09:15:30.123Z' })}
        sampleOnly={false}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(onQueuedOffline).toHaveBeenCalledTimes(1);
    });
    expect(onQueuedOffline).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'submitted' }),
      { editingId: 'act-edit-99', expectedUpdatedAt: '2026-04-10T09:15:30.123Z' },
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('auto-calculates readonly Duration and requires Start/End Product Turbidity (NTU) for backwash', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    activityInsertSingleMock.mockResolvedValue({
      data: makeSavedRow({ id: 'act-bw-1', activity_type: 'backwash' }),
      error: null,
    });

    render(<ActivityLoggerModal {...loggerProps} onClose={vi.fn()} onSaved={onSaved} />);
    await user.selectOptions(screen.getByLabelText(/Activity Type/i), 'backwash');

    const durationInput = screen.getByLabelText(/Duration \(mins, auto from time\)/i) as HTMLInputElement;
    expect(durationInput.readOnly).toBe(true);

    const startInput = screen.getByLabelText(/Start Time \*/i) as HTMLInputElement;
    const endInput = screen.getByLabelText(/Completion Time \*/i) as HTMLInputElement;
    fireEvent.change(startInput, { target: { value: '00:22' } });
    fireEvent.change(endInput, { target: { value: '00:50' } });
    await waitFor(() => expect(durationInput.value).toBe('28'));

    // Bypass native HTML `required` tooltip via form submit to verify app-level validation guard
    fireEvent.submit(durationInput.closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Product Turbidity at Start of Backwash/i);

    await user.click(screen.getByRole('button', { name: 'Test attach GPS' }));
    await user.type(screen.getByLabelText(/Product Turbidity — Start \(NTU\)/i), '1.85');
    await user.type(screen.getByLabelText(/Product Turbidity — End \(NTU\)/i), '0.42');
    await user.click(screen.getByRole('button', { name: 'Submit Activity Log' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(activityInsertPayloads[0]).toMatchObject({
      activity_type: 'backwash',
      details: {
        backwashDurationMin: 28,
        productTurbidityStartNtu: 1.85,
        productTurbidityEndNtu: 0.42,
        waterClarity: 'Clear',
      },
    });
  });
});
