import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Roster from '@/components/Roster';
import type { EditGrant } from '@/lib/profile';
import type { Area, Op, Row, Shift } from '@/lib/roster-helpers';

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

vi.mock('@/lib/supabase/realtime', () => ({
  subscribeVisibilityAwareChannel: vi.fn(() => vi.fn()),
}));

type QueryResult<T = unknown> = Promise<{ data: T; error: { message: string } | null }>;

const scheduleUpsertMock = vi.fn<
  (values: Record<string, unknown>[], options?: { onConflict?: string }) => QueryResult<null>
>();
const scheduleDeleteEqSecondMock = vi.fn<(col: string, val: string) => QueryResult<null>>();
const scheduleDeleteEqFirstMock = vi.fn((_col: string, _val: string) => ({
  eq: scheduleDeleteEqSecondMock,
}));

const changeRequestSingleMock = vi.fn<() => QueryResult<{ id: string }>>();
const changeRequestInsertMock = vi.fn((_payload: Record<string, unknown>) => ({
  select: (_cols: string) => ({
    single: changeRequestSingleMock,
  }),
}));
const changeRequestDeleteEqMock = vi.fn<(col: string, val: string) => QueryResult<null>>();

const changeItemDeleteEq3Mock = vi.fn<(col: string, val: string) => QueryResult<null>>();
const changeItemDeleteEq2Mock = vi.fn((_col: string, _val: string) => ({
  eq: changeItemDeleteEq3Mock,
}));
const changeItemDeleteEq1Mock = vi.fn((_col: string, _val: string) => ({
  eq: changeItemDeleteEq2Mock,
}));
const changeItemInsertSelectMock = vi.fn<() => QueryResult<Record<string, unknown>[]>>();
const changeItemInsertMock = vi.fn((payload: Record<string, unknown>) => {
  changeItemInsertPayloads.push(payload);
  return {
    select: changeItemInsertSelectMock,
  };
});

let changeItemInsertPayloads: Record<string, unknown>[] = [];

vi.mock('@/lib/supabase/client', () => ({
  supabaseBrowser: () => ({
    from: (table: string) => {
      if (table === 'schedule_assignments') {
        return {
          upsert: scheduleUpsertMock,
          delete: () => ({
            eq: scheduleDeleteEqFirstMock,
          }),
        };
      }
      if (table === 'standby_assignments') {
        return {
          upsert: vi.fn(async () => ({ data: null, error: null })),
          delete: () => ({
            eq: () => ({
              eq: vi.fn(async () => ({ data: null, error: null })),
            }),
          }),
        };
      }
      if (table === 'change_requests') {
        return {
          insert: changeRequestInsertMock,
          delete: () => ({
            eq: changeRequestDeleteEqMock,
          }),
        };
      }
      if (table === 'change_request_items') {
        return {
          delete: () => ({
            eq: changeItemDeleteEq1Mock,
          }),
          insert: changeItemInsertMock,
        };
      }
      throw new Error(`Unexpected table mock: ${table}`);
    },
    rpc: vi.fn(async () => ({ data: null, error: null })),
  }),
}));

const OPERATORS: Op[] = [
  { id: 'op-1', full_name: 'Alice Santos', position: 'Senior Operator' },
  { id: 'op-2', full_name: 'Bob Reyes', position: 'Field Technician' },
];

const SHIFTS: Shift[] = [
  {
    id: 'shift-day',
    code: 'D1',
    description: 'Day Shift',
    duration_hours: 8,
    background_color: '#dbeafe',
    text_color: '#1e3a8a',
    is_off: false,
  },
  {
    id: 'shift-off',
    code: 'OFF',
    description: 'Day Off',
    duration_hours: 0,
    background_color: '#f1f5f9',
    text_color: '#475569',
    is_off: true,
  },
];

const AREAS: Area[] = [
  {
    id: 'area-pl',
    code: 'PL',
    name: 'Plant Ops',
    category: 'station',
    background_color: '#dcfce7',
    text_color: '#166534',
  },
];

function renderRoster(overrides: {
  role?: string;
  canEdit?: boolean;
  canPropose?: boolean;
  editGrant?: EditGrant | null;
  rows?: Row[];
} = {}) {
  return render(
    <Roster
      month="2026-04"
      today="2026-04-10"
      operators={OPERATORS}
      shifts={SHIFTS}
      areas={AREAS}
      rows={overrides.rows ?? []}
      standby={[]}
      pmTasks={[]}
      orgId="org-1"
      userId="user-1"
      role={overrides.role ?? 'admin'}
      userName="Test User"
      canEdit={overrides.canEdit ?? true}
      canPropose={overrides.canPropose}
      editGrant={overrides.editGrant ?? null}
    />,
  );
}

describe('Roster', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('bpwi-roster-hint-dismissed', '1');
    changeItemInsertPayloads = [];

    scheduleUpsertMock.mockResolvedValue({ data: null, error: null });
    scheduleDeleteEqSecondMock.mockResolvedValue({ data: null, error: null });
    changeRequestSingleMock.mockResolvedValue({ data: { id: 'draft-req-1' }, error: null });
    changeRequestDeleteEqMock.mockResolvedValue({ data: null, error: null });
    changeItemDeleteEq3Mock.mockResolvedValue({ data: null, error: null });
    changeItemInsertSelectMock.mockImplementation(async () => {
      const latest = changeItemInsertPayloads[changeItemInsertPayloads.length - 1] ?? {};
      return {
        data: [
          {
            id: `draft-item-${changeItemInsertPayloads.length}`,
            request_id: 'draft-req-1',
            organization_id: 'org-1',
            target_table: 'schedule_assignments',
            action: 'upsert',
            status: 'pending',
            created_at: '2026-04-10T00:00:00Z',
            ...latest,
          },
        ],
        error: null,
      };
    });
  });

  it('renders operators and filters the grid when searching by name or position', async () => {
    const user = userEvent.setup();
    renderRoster();

    const grid = screen.getByRole('grid', { name: /Monthly schedule for April 2026/i });
    expect(within(grid).getByText('Alice Santos')).toBeInTheDocument();
    expect(within(grid).getByText('Bob Reyes')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText('Filter operator…');
    await user.type(searchInput, 'Bob');

    expect(within(grid).queryByText('Alice Santos')).not.toBeInTheDocument();
    expect(within(grid).getByText('Bob Reyes')).toBeInTheDocument();
  });

  it('persists a direct schedule_assignments upsert when clicking a gridcell as an editor', async () => {
    const user = userEvent.setup();
    renderRoster({ role: 'admin', canEdit: true });

    const grid = screen.getByRole('grid');
    const targetCell = within(grid).getByRole('gridcell', {
      name: /Alice Santos, 2026-04-05, No shift/i,
    });

    await user.click(targetCell);

    await waitFor(() => {
      expect(scheduleUpsertMock).toHaveBeenCalledTimes(1);
    });
    expect(scheduleUpsertMock).toHaveBeenCalledWith(
      [
        {
          operator_id: 'op-1',
          schedule_date: '2026-04-05',
          shift_type_id: 'shift-day',
          area_code_id: null,
          organization_id: 'org-1',
        },
      ],
      { onConflict: 'operator_id,schedule_date' },
    );

    expect(
      within(grid).getByRole('gridcell', {
        name: /Alice Santos, 2026-04-05, D1/i,
      }),
    ).toBeInTheDocument();
  });

  it('persists directly inside editGrant range and queues a draft proposal outside range for department heads', async () => {
    const user = userEvent.setup();
    const now = Date.now();
    const grant: EditGrant = {
      starts_at: new Date(now - 60_000).toISOString(),
      ends_at: new Date(now + 3_600_000).toISOString(),
      date_from: '2026-04-10',
      date_to: '2026-04-15',
      note: 'Mid-month window',
    };

    renderRoster({
      role: 'manager',
      canEdit: true,
      canPropose: true,
      editGrant: grant,
    });

    const grid = screen.getByRole('grid');

    // In-range date -> direct upsert, no proposal bar
    const inRangeCell = within(grid).getByRole('gridcell', {
      name: /Alice Santos, 2026-04-12, No shift/i,
    });
    await user.click(inRangeCell);

    await waitFor(() => {
      expect(scheduleUpsertMock).toHaveBeenCalledTimes(1);
    });
    expect(changeRequestInsertMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Pending proposal submission bar')).not.toBeInTheDocument();

    // Out-of-range date -> creates draft proposal and shows RosterProposeBar
    const outOfRangeCell = within(grid).getByRole('gridcell', {
      name: /Alice Santos, 2026-04-20, No shift/i,
    });
    await user.click(outOfRangeCell);

    await waitFor(() => {
      expect(changeRequestInsertMock).toHaveBeenCalledWith({
        organization_id: 'org-1',
        requester_id: 'user-1',
        status: 'draft',
        title: 'Schedule Proposal for 2026-04',
      });
    });
    expect(changeItemInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: 'draft-req-1',
        organization_id: 'org-1',
        target_table: 'schedule_assignments',
        action: 'upsert',
        operator_id: 'op-1',
        schedule_date: '2026-04-20',
        shift_type_id: 'shift-day',
      }),
    );

    const proposeBar = await screen.findByLabelText('Pending proposal submission bar');
    expect(proposeBar).toHaveTextContent('Propose Mode: 1 change queued');
    expect(scheduleUpsertMock).toHaveBeenCalledTimes(1);
  });

  it('reverts the painted cell and deletes the assignment when pressing Ctrl+Z', async () => {
    const user = userEvent.setup();
    renderRoster({ role: 'admin', canEdit: true });

    const grid = screen.getByRole('grid');
    const cell = within(grid).getByRole('gridcell', {
      name: /Bob Reyes, 2026-04-03, No shift/i,
    });

    await user.click(cell);

    await waitFor(() => {
      expect(scheduleUpsertMock).toHaveBeenCalledTimes(1);
    });
    expect(
      within(grid).getByRole('gridcell', { name: /Bob Reyes, 2026-04-03, D1/i }),
    ).toBeInTheDocument();

    await user.keyboard('{Control>}z{/Control}');

    await waitFor(() => {
      expect(scheduleDeleteEqFirstMock).toHaveBeenCalledWith('operator_id', 'op-2');
      expect(scheduleDeleteEqSecondMock).toHaveBeenCalledWith('schedule_date', '2026-04-03');
    });
    expect(
      within(grid).getByRole('gridcell', { name: /Bob Reyes, 2026-04-03, No shift/i }),
    ).toBeInTheDocument();
  });

  it('reverts a proposed shift edit via draft discard on Ctrl+Z without direct schedule_assignments writes', async () => {
    const user = userEvent.setup();
    renderRoster({ role: 'manager', canEdit: false, canPropose: true });

    const grid = screen.getByRole('grid');
    const targetCell = within(grid).getByRole('gridcell', {
      name: /Alice Santos, 2026-04-20, No shift/i,
    });

    await user.click(targetCell);

    await waitFor(() => {
      expect(changeItemInsertMock).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByLabelText('Pending proposal submission bar')).toHaveTextContent(
      'Propose Mode: 1 change queued',
    );
    expect(
      within(grid).getByRole('gridcell', { name: /Alice Santos, 2026-04-20, D1/i }),
    ).toBeInTheDocument();

    await user.keyboard('{Control>}z{/Control}');

    await waitFor(() => {
      expect(changeItemDeleteEq1Mock).toHaveBeenCalledWith('id', 'draft-item-1');
    });
    await waitFor(() => {
      expect(screen.queryByLabelText('Pending proposal submission bar')).not.toBeInTheDocument();
    });
    expect(
      within(grid).getByRole('gridcell', { name: /Alice Santos, 2026-04-20, No shift/i }),
    ).toBeInTheDocument();
    expect(scheduleUpsertMock).not.toHaveBeenCalled();
    expect(scheduleDeleteEqFirstMock).not.toHaveBeenCalled();
  });

  it('uses FD as the default station in toolbar and cells instead of PL', () => {
    renderRoster({
      role: 'admin',
      canEdit: true,
      rows: [
        { operator_id: 'op-1', schedule_date: '2026-04-01', shift_type_id: 'shift-day', area_code_id: null },
      ],
    });

    expect(screen.getByRole('button', { name: 'FD (default)' })).toBeInTheDocument();
    expect(screen.getAllByText('Brush: D1 + FD').length).toBeGreaterThanOrEqual(1);

    const grid = screen.getByRole('grid');
    expect(within(grid).getByRole('gridcell', { name: /Alice Santos, 2026-04-01, D1, D1·FD/i })).toBeInTheDocument();
  });

  it('copies a multi-day block and pastes it onto target cells in one undoable batch via Copy & Paste Mode', async () => {
    const user = userEvent.setup();
    renderRoster({
      role: 'admin',
      canEdit: true,
      rows: [
        { operator_id: 'op-1', schedule_date: '2026-04-01', shift_type_id: 'shift-day', area_code_id: 'area-pl' },
        { operator_id: 'op-1', schedule_date: '2026-04-02', shift_type_id: 'shift-off', area_code_id: null },
      ],
    });

    const modeSelect = screen.getByLabelText(/Roster edit mode/i);
    expect(modeSelect).toHaveValue('direct');
    await user.selectOptions(modeSelect, 'copy');
    expect(modeSelect).toHaveValue('copy');
    expect(screen.getByText(/Copy & Paste mode \(Step 1 — Copy\)/i)).toBeInTheDocument();

    const grid = screen.getByRole('grid');
    const srcStart = within(grid).getByRole('gridcell', { name: /Alice Santos, 2026-04-01/i });
    const srcEnd = within(grid).getByRole('gridcell', { name: /Alice Santos, 2026-04-02/i });

    await user.pointer([
      { keys: '[MouseLeft>]', target: srcStart },
      { target: srcEnd },
      { keys: '[/MouseLeft]' },
    ]);

    expect(screen.getByText('Copied: 1×2 (2 days)')).toBeInTheDocument();
    expect(screen.getByText(/Copy & Paste mode \(Step 2 — Paste\)/i)).toBeInTheDocument();
    const pickNewBtn = screen.getByRole('button', { name: 'Pick New Source' });

    const targetCell = within(grid).getByRole('gridcell', { name: /Bob Reyes, 2026-04-05, No shift/i });
    await user.click(targetCell);

    await waitFor(() => {
      expect(scheduleUpsertMock).toHaveBeenCalledTimes(1);
    });
    expect(scheduleUpsertMock).toHaveBeenCalledWith(
      [
        {
          operator_id: 'op-2',
          schedule_date: '2026-04-05',
          shift_type_id: 'shift-day',
          area_code_id: 'area-pl',
          organization_id: 'org-1',
        },
        {
          operator_id: 'op-2',
          schedule_date: '2026-04-06',
          shift_type_id: 'shift-off',
          area_code_id: null,
          organization_id: 'org-1',
        },
      ],
      { onConflict: 'operator_id,schedule_date' },
    );
    expect(within(grid).getByRole('gridcell', { name: /Bob Reyes, 2026-04-05, D1, D1·PL/i })).toBeInTheDocument();
    expect(within(grid).getByRole('gridcell', { name: /Bob Reyes, 2026-04-06, OFF, OFF/i })).toBeInTheDocument();

    // Single Ctrl+Z reverts both pasted cells atomically
    await user.keyboard('{Control>}z{/Control}');
    await waitFor(() => {
      expect(scheduleDeleteEqSecondMock).toHaveBeenCalledWith('schedule_date', '2026-04-05');
      expect(scheduleDeleteEqSecondMock).toHaveBeenCalledWith('schedule_date', '2026-04-06');
    });
    expect(within(grid).getByRole('gridcell', { name: /Bob Reyes, 2026-04-05, No shift/i })).toBeInTheDocument();
    expect(within(grid).getByRole('gridcell', { name: /Bob Reyes, 2026-04-06, No shift/i })).toBeInTheDocument();

    await user.click(pickNewBtn);
    expect(screen.getByText('Select cells to copy')).toBeInTheDocument();
  });
});
