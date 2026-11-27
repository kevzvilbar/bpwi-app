import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ActivityFeedCard from '@/components/ActivityFeedCard';
import { canDeleteActivity, canEditActivity, type DailyActivityRow } from '@/lib/activity-types';

const BASE_ACT: DailyActivityRow = {
  id: 'act-1',
  organization_id: 'org-1',
  activity_date: '2026-11-27',
  logged_by: 'op-1',
  lead_operator_id: null,
  crew_operator_ids: [],
  shift_type_id: null,
  area_code_id: null,
  site_or_well: 'Well 4 BAR',
  block_lot: null,
  activity_type: 'pump_monitoring',
  pm_task_id: null,
  status: 'submitted',
  started_at: null,
  completed_at: null,
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
  created_at: '2026-11-27T01:00:00Z',
  updated_at: '2026-11-27T01:00:00Z',
};

describe('ActivityFeedCard Edit/Delete visibility', () => {
  it('shows Edit but hides Delete on reviewed logs for non-admins, and hides Delete on resubmitted previously-flagged logs', () => {
    const flaggedAct: DailyActivityRow = {
      ...BASE_ACT,
      status: 'flagged',
      verified_at: '2026-11-27T02:00:00Z',
      review_note: 'Fix pressure',
    };

    const { rerender } = render(
      <ActivityFeedCard
        act={flaggedAct}
        crewNames={[]}
        canVerifyActivity={false}
        canEdit={canEditActivity(flaggedAct, 'op-1', false)}
        canDelete={canDeleteActivity(flaggedAct, 'op-1', false)}
        isFlagging={false}
        flagReason=""
        onFlagReasonChange={vi.fn()}
        onToggleFlag={vi.fn()}
        onVerify={vi.fn()}
        onConfirmFlag={vi.fn()}
        onPrint={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();

    const resubmittedAct: DailyActivityRow = {
      ...flaggedAct,
      status: 'submitted',
    };

    rerender(
      <ActivityFeedCard
        act={resubmittedAct}
        crewNames={[]}
        canVerifyActivity={false}
        canEdit={canEditActivity(resubmittedAct, 'op-1', false)}
        canDelete={canDeleteActivity(resubmittedAct, 'op-1', false)}
        isFlagging={false}
        flagReason=""
        onFlagReasonChange={vi.fn()}
        onToggleFlag={vi.fn()}
        onVerify={vi.fn()}
        onConfirmFlag={vi.fn()}
        onPrint={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();

    rerender(
      <ActivityFeedCard
        act={BASE_ACT}
        crewNames={[]}
        canVerifyActivity={false}
        canEdit={canEditActivity(BASE_ACT, 'op-1', false)}
        canDelete={canDeleteActivity(BASE_ACT, 'op-1', false)}
        isFlagging={false}
        flagReason=""
        onFlagReasonChange={vi.fn()}
        onToggleFlag={vi.fn()}
        onVerify={vi.fn()}
        onConfirmFlag={vi.fn()}
        onPrint={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });
});
