import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChangeRequests from '@/components/ChangeRequests';
import type { ChangeRequest, ChangeRequestItem } from '@/lib/profile';

const mockRefresh = vi.fn();
const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mockRefresh,
    push: mockPush,
  }),
}));

type RpcResult = Promise<{ data: unknown; error: { message: string } | null }>;
const rpcMock = vi.fn<(fnName: string, params: Record<string, unknown>) => RpcResult>();

vi.mock('@/lib/supabase/client', () => ({
  supabaseBrowser: () => ({
    rpc: rpcMock,
  }),
}));

const OPERATORS = [
  { id: 'op-1', full_name: 'Alice Santos', position: 'Senior Operator' },
  { id: 'op-2', full_name: 'Bob Reyes', position: 'Operator' },
];

const SHIFTS = [
  { id: 'shift-d1', code: 'D1', description: 'Day 1', background_color: '#dbeafe', text_color: '#1e3a8a', is_off: false },
  { id: 'shift-n1', code: 'N1', description: 'Night 1', background_color: '#e0e7ff', text_color: '#312e81', is_off: false },
];

const AREAS = [
  { id: 'area-pl', code: 'PL', name: 'Plant Ops', category: 'station', background_color: '#dcfce7', text_color: '#166534' },
];

function makeItem(overrides: Partial<ChangeRequestItem>): ChangeRequestItem {
  return {
    id: 'item-1',
    request_id: 'req-1',
    organization_id: 'org-1',
    target_table: 'schedule_assignments',
    action: 'upsert',
    operator_id: 'op-1',
    schedule_date: '2026-04-12',
    shift_type_id: 'shift-d1',
    area_code_id: 'area-pl',
    status: 'pending',
    original_state: { shift_type_id: null, area_code_id: null },
    created_at: '2026-04-10T01:00:00Z',
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ChangeRequest>): ChangeRequest {
  return {
    id: 'req-1',
    organization_id: 'org-1',
    requester_id: 'mgr-1',
    requester_name: 'Dept Head Mia',
    requester_role: 'manager',
    status: 'pending',
    submitted_at: '2026-04-10T02:00:00Z',
    created_at: '2026-04-10T01:00:00Z',
    updated_at: '2026-04-10T02:00:00Z',
    items: [makeItem({})],
    ...overrides,
  };
}

describe('ChangeRequests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockResolvedValue({
      data: { approved_count: 1, rejected_count: 0, conflict_count: 0 },
      error: null,
    });
  });

  it('inspects a conflict item and approves with force override', async () => {
    const user = userEvent.setup();
    const conflictReq = makeRequest({
      id: 'req-conflict',
      items: [
        makeItem({
          id: 'item-pending',
          request_id: 'req-conflict',
          operator_id: 'op-1',
          schedule_date: '2026-04-12',
          status: 'pending',
        }),
        makeItem({
          id: 'item-conflict',
          request_id: 'req-conflict',
          operator_id: 'op-2',
          schedule_date: '2026-04-14',
          shift_type_id: 'shift-n1',
          status: 'conflict',
          conflict_reason: 'changed',
          original_state: { shift_type_id: null, area_code_id: null },
          live_state: { shift_type_id: 'shift-d1', area_code_id: 'area-pl' },
        }),
      ],
    });

    render(
      <ChangeRequests
        requests={[conflictReq]}
        operators={OPERATORS}
        shifts={SHIFTS}
        areas={AREAS}
        canApprove
        isAdmin
        isManager={false}
        currentUserId="admin-1"
      />,
    );

    expect(screen.getByText(/1 in conflict/i)).toBeInTheDocument();
    expect(screen.getByText(/Changed since proposed/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Review & override…' }));

    const dialog = screen.getByRole('dialog', { name: 'Override live change?' });
    expect(within(dialog).getByText('When proposed')).toBeInTheDocument();
    expect(within(dialog).getByText('Now (live)')).toBeInTheDocument();
    expect(within(dialog).getByText('Will be applied')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Override & apply' }));

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('approve_change_request', {
        p_request_id: 'req-conflict',
        p_item_ids: ['item-conflict'],
        p_reject_item_ids: null,
        p_review_notes: null,
        p_force_conflicts: true,
        p_allow_self_override: false,
      });
    });
  });

  it('invokes approve_change_request when clicking Approve all', async () => {
    const user = userEvent.setup();
    const pendingReq = makeRequest({
      id: 'req-approve',
      items: [makeItem({ id: 'item-1', request_id: 'req-approve' })],
    });

    render(
      <ChangeRequests
        requests={[pendingReq]}
        operators={OPERATORS}
        shifts={SHIFTS}
        areas={AREAS}
        canApprove
        isAdmin
        isManager={false}
        currentUserId="admin-1"
      />,
    );

    await user.type(screen.getByLabelText('Approver note (optional)'), 'Looks good');
    await user.click(screen.getByRole('button', { name: 'Approve all (1)' }));

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('approve_change_request', {
        p_request_id: 'req-approve',
        p_item_ids: ['item-1'],
        p_reject_item_ids: null,
        p_review_notes: 'Looks good',
        p_force_conflicts: false,
        p_allow_self_override: false,
      });
    });
    expect(screen.getByText('1 applied')).toBeInTheDocument();
  });

  it('opens the rejection modal and invokes reject_change_request with the entered reason', async () => {
    const user = userEvent.setup();
    const pendingReq = makeRequest({
      id: 'req-reject',
      items: [makeItem({ id: 'item-1', request_id: 'req-reject' })],
    });

    render(
      <ChangeRequests
        requests={[pendingReq]}
        operators={OPERATORS}
        shifts={SHIFTS}
        areas={AREAS}
        canApprove
        isAdmin
        isManager={false}
        currentUserId="admin-1"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Reject all (1)…' }));

    const dialog = screen.getByRole('dialog', { name: 'Reject 1 open item' });
    await user.type(within(dialog).getByLabelText('Reason for rejection'), 'Payroll already locked');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm rejection' }));

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('reject_change_request', {
        p_request_id: 'req-reject',
        p_reason: 'Payroll already locked',
      });
    });
  });

  it('blocks non-admin self-approval and sends p_allow_self_override: true for admin self-override', async () => {
    const user = userEvent.setup();
    const selfReq = makeRequest({
      id: 'req-self',
      requester_id: 'user-self',
      requester_name: 'Self Requester',
      items: [makeItem({ id: 'item-self', request_id: 'req-self' })],
    });

    // Guard for non-admin approver viewing their own request
    const { rerender } = render(
      <ChangeRequests
        requests={[selfReq]}
        operators={OPERATORS}
        shifts={SHIFTS}
        areas={AREAS}
        canApprove
        isAdmin={false}
        isManager={false}
        currentUserId="user-self"
      />,
    );

    expect(screen.getByText('Submitted by you — requires another approver')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();

    // Admin self-override on their own request
    rerender(
      <ChangeRequests
        requests={[selfReq]}
        operators={OPERATORS}
        shifts={SHIFTS}
        areas={AREAS}
        canApprove
        isAdmin
        isManager={false}
        currentUserId="user-self"
      />,
    );

    const overrideBtn = screen.getByRole('button', { name: 'Admin override: approve all (1)' });
    await user.click(overrideBtn);

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('approve_change_request', {
        p_request_id: 'req-self',
        p_item_ids: ['item-self'],
        p_reject_item_ids: null,
        p_review_notes: 'Admin self-override',
        p_force_conflicts: false,
        p_allow_self_override: true,
      });
    });
  });
});
