import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FieldOfflineShell from '@/components/FieldOfflineShell';
import type { FieldReferenceSnapshot } from '@/lib/offline-queue';

const loadSnapshotMock = vi.fn<() => Promise<FieldReferenceSnapshot | null>>();
const saveSnapshotMock = vi.fn<() => Promise<boolean>>();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabaseBrowser: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    channel: () => {
      const ch = {
        on: () => ch,
        subscribe: () => ch,
      };
      return ch;
    },
    removeChannel: vi.fn(),
  }),
}));

vi.mock('@/lib/offline-queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/offline-queue')>();
  return {
    ...actual,
    loadFieldReferenceSnapshot: () => loadSnapshotMock(),
    saveFieldReferenceSnapshot: () => saveSnapshotMock(),
  };
});

describe('FieldOfflineShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  });

  it('shows empty-state guidance when offline without any cached snapshot', async () => {
    loadSnapshotMock.mockResolvedValue(null);
    render(<FieldOfflineShell />);
    await waitFor(() => {
      expect(screen.getByText('No offline field snapshot saved yet')).toBeInTheDocument();
    });
  });

  it('renders cached reference data when offline with snapshot metadata and no SSR dependency', async () => {
    loadSnapshotMock.mockResolvedValue({
      userId: 'u-op-1',
      orgId: 'org-1',
      role: 'operator',
      operatorId: 'op-1',
      canClosePm: true,
      canLogActivity: true,
      canLogSampleActivity: false,
      canVerifyActivity: false,
      savedAt: '2026-11-26T08:00:00.000Z',
      snapshotDate: '2026-11-26',
      operators: [
        { id: 'op-1', full_name: 'Juan Dela Cruz', position: 'Operator', phone_number: null, default_station: 'PL' },
      ],
      shifts: [],
      areas: [{ id: 'a-1', code: 'PL', name: 'Plant', category: 'station' }],
      assignments: [],
      yesterdayAssignments: [],
      standby: [],
      tasks: [
        {
          id: 'pm-1',
          activity_type: 'FLUSH',
          title: 'Flush Line 1',
          locations: ['Well 4 BAR'],
          asset: 'Well 4',
          assigned_operator_ids: ['op-1'],
          completed_by_operator_ids: [],
          scheduled_date: '2026-11-27',
          status: 'planned',
          completed_at: null,
          remarks: null,
        },
      ],
      activityTypes: [{ code: 'FLUSH', label: 'Line Flushing', short_label: 'Flush', color: '#0284c7' }],
      recentActivities: [],
    });

    render(<FieldOfflineShell />);

    await waitFor(() => {
      expect(screen.getByText('Offline Snapshot')).toBeInTheDocument();
    });
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument();
    expect(screen.getAllByText('Well 4 BAR').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Juan Dela Cruz/).length).toBeGreaterThan(0);
  });
});
