'use client';

import { useMemo, useState, type Dispatch, type SetStateAction, type TransitionStartFunction } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { ChangeRequestItem } from '@/lib/profile';
import { getErrorMessage } from '@/lib/error-utils';
import {
  cellKey,
  clearDraftItemsForCells,
  friendlyError,
  replaceProposedDraftItems,
  type ProposedChangeInput,
  type Row,
  type ShiftHistoryItem,
  type Standby,
} from '@/lib/roster-helpers';

export interface UseRosterDraftsOptions {
  orgId: string;
  userId?: string;
  month: string;
  role: string;
  initialDraftRequestId?: string | null;
  initialDraftItems?: ChangeRequestItem[];
  shouldProposeDate: (date: string) => boolean;
  setSaveState: Dispatch<SetStateAction<'idle' | 'saving' | 'saved' | 'error'>>;
  setMsg: Dispatch<SetStateAction<string>>;
  startTransition: TransitionStartFunction;
  router: { refresh: () => void };
}

export interface SyncProposedHistoryInput {
  shiftUpserts: Row[];
  shiftDeletes: { opId: string; date: string }[];
  shiftRollback: { opId: string; date: string; prev: Row | null }[];
  sbUpserts: Standby[];
  sbDeletes: { opId: string; date: string }[];
  sbRollback: { opId: string; date: string; prev: Standby | null }[];
  baseRowByKey: ReadonlyMap<string, Row>;
  baseStandbyByKey: ReadonlyMap<string, Standby>;
  rollbackShiftKeys: (keys: { opId: string; date: string; prev: Row | null }[]) => void;
  rollbackStandbyKeys: (keys: { opId: string; date: string; prev: Standby | null }[]) => void;
}

export function buildShiftProposalInput(e: ShiftHistoryItem): ProposedChangeInput {
  return {
    target_table: 'schedule_assignments',
    action: e.next ? 'upsert' : 'delete',
    operator_id: e.opId,
    schedule_date: e.date,
    ...(e.next ? { shift_type_id: e.next.shift_type_id, area_code_id: e.next.area_code_id } : {}),
    original_state: e.prev
      ? { shift_type_id: e.prev.shift_type_id, area_code_id: e.prev.area_code_id }
      : { shift_type_id: null, area_code_id: null },
  };
}

/**
 * Manages draft change-request state, overlap clearing, proposal saving,
 * batch submission, and discard flows for department-head Propose Mode.
 */
export function useRosterDrafts({
  orgId,
  userId,
  month,
  role,
  initialDraftRequestId,
  initialDraftItems,
  shouldProposeDate,
  setSaveState,
  setMsg,
  startTransition,
  router,
}: UseRosterDraftsOptions) {
  const [draftReqId, setDraftReqId] = useState<string | null>(initialDraftRequestId ?? null);
  const [draftItems, setDraftItems] = useState<ChangeRequestItem[]>(initialDraftItems ?? []);
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [submitNote, setSubmitNote] = useState('');
  const [isSubmittingDraft, setIsSubmittingDraft] = useState(false);

  const proposedDraftItems = useMemo(
    () => draftItems.filter((item) => !item.schedule_date || shouldProposeDate(item.schedule_date)),
    [draftItems, shouldProposeDate],
  );

  async function ensureDraftRequestId(): Promise<string> {
    if (draftReqId) return draftReqId;
    if (!userId) throw new Error('User session required to create draft request');
    const sb = supabaseBrowser();
    const { data, error } = await sb
      .from('change_requests')
      .insert({
        organization_id: orgId,
        requester_id: userId,
        status: 'draft',
        title: `Schedule Proposal for ${month}`,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Could not create draft request');
    setDraftReqId(data.id);
    return data.id;
  }

  function mergeDraftItems(inserted: ChangeRequestItem[]) {
    if (inserted.length === 0) return;
    const keys = new Set(inserted.map((x) => `${x.target_table}:${x.operator_id ?? ''}:${x.schedule_date ?? ''}`));
    setDraftItems((prev) => [
      ...prev.filter((x) => !keys.has(`${x.target_table}:${x.operator_id ?? ''}:${x.schedule_date ?? ''}`)),
      ...inserted,
    ]);
  }

  async function clearDraftOverlap(
    cells: { opId: string; date: string }[],
    targetTable?: 'schedule_assignments' | 'standby_assignments',
  ) {
    if (!draftReqId || draftItems.length === 0 || cells.length === 0) return;
    const scoped = targetTable ? draftItems.filter((x) => x.target_table === targetTable) : draftItems;
    if (scoped.length === 0) return;
    const nextDraft = await clearDraftItemsForCells(supabaseBrowser(), draftReqId, scoped, cells);
    if (nextDraft !== scoped) {
      const kept = new Set(nextDraft.map((x) => x.id));
      const dropped = new Set(scoped.filter((x) => !kept.has(x.id)).map((x) => x.id));
      setDraftItems((prev) => prev.filter((x) => !dropped.has(x.id)));
    }
  }

  async function saveDraftProposal(items: ProposedChangeInput[], onErrorRollback: () => void) {
    try {
      const reqId = await ensureDraftRequestId();
      const inserted = await replaceProposedDraftItems(supabaseBrowser(), reqId, orgId, items);
      mergeDraftItems(inserted);
    } catch (err: unknown) {
      onErrorRollback();
      setSaveState('error');
      setMsg(friendlyError(getErrorMessage(err), role));
    }
  }

  async function syncProposedHistoryChanges({
    shiftUpserts,
    shiftDeletes,
    shiftRollback,
    sbUpserts,
    sbDeletes,
    sbRollback,
    baseRowByKey,
    baseStandbyByKey,
    rollbackShiftKeys,
    rollbackStandbyKeys,
  }: SyncProposedHistoryInput) {
    const shiftTargetByKey = new Map<string, { opId: string; date: string; target: Row | null }>();
    for (const u of shiftUpserts) {
      shiftTargetByKey.set(cellKey(u.operator_id, u.schedule_date), { opId: u.operator_id, date: u.schedule_date, target: u });
    }
    for (const d of shiftDeletes) {
      shiftTargetByKey.set(cellKey(d.opId, d.date), { opId: d.opId, date: d.date, target: null });
    }

    const sbTargetByKey = new Map<string, { opId: string; date: string; target: Standby | null }>();
    for (const u of sbUpserts) {
      sbTargetByKey.set(cellKey(u.operator_id, u.schedule_date), { opId: u.operator_id, date: u.schedule_date, target: u });
    }
    for (const d of sbDeletes) {
      sbTargetByKey.set(cellKey(d.opId, d.date), { opId: d.opId, date: d.date, target: null });
    }

    const proposedShiftClearCells: { opId: string; date: string }[] = [];
    const proposedSbClearCells: { opId: string; date: string }[] = [];
    const proposedItemsToSave: ProposedChangeInput[] = [];
    const saveShiftKeys = new Set<string>();
    const saveSbKeys = new Set<string>();

    for (const [k, item] of shiftTargetByKey) {
      if (!shouldProposeDate(item.date)) continue;
      const baseRow = baseRowByKey.get(k) ?? null;
      const matchesBase =
        (item.target?.shift_type_id ?? null) === (baseRow?.shift_type_id ?? null) &&
        (item.target?.area_code_id ?? null) === (baseRow?.area_code_id ?? null);
      if (matchesBase) {
        proposedShiftClearCells.push({ opId: item.opId, date: item.date });
      } else {
        saveShiftKeys.add(k);
        proposedItemsToSave.push(buildShiftProposalInput({ kind: 'shift', opId: item.opId, date: item.date, prev: baseRow, next: item.target }));
      }
    }

    for (const [k, item] of sbTargetByKey) {
      if (!shouldProposeDate(item.date)) continue;
      const baseSb = baseStandbyByKey.get(k) ?? null;
      if ((item.target?.standby_type ?? null) === (baseSb?.standby_type ?? null)) {
        proposedSbClearCells.push({ opId: item.opId, date: item.date });
      } else {
        saveSbKeys.add(k);
        proposedItemsToSave.push({
          target_table: 'standby_assignments',
          action: item.target ? 'upsert' : 'delete',
          operator_id: item.opId,
          schedule_date: item.date,
          standby_type: item.target ? item.target.standby_type : null,
          original_state: baseSb ? { standby_type: baseSb.standby_type } : { standby_type: null },
        });
      }
    }

    if (proposedShiftClearCells.length > 0) {
      const clearKeys = new Set(proposedShiftClearCells.map((c) => cellKey(c.opId, c.date)));
      try {
        await clearDraftOverlap(proposedShiftClearCells, 'schedule_assignments');
      } catch (err: unknown) {
        rollbackShiftKeys(shiftRollback.filter((r) => clearKeys.has(cellKey(r.opId, r.date))));
        setSaveState('error');
        setMsg(friendlyError(getErrorMessage(err), role));
      }
    }

    if (proposedSbClearCells.length > 0) {
      const clearKeys = new Set(proposedSbClearCells.map((c) => cellKey(c.opId, c.date)));
      try {
        await clearDraftOverlap(proposedSbClearCells, 'standby_assignments');
      } catch (err: unknown) {
        rollbackStandbyKeys(sbRollback.filter((r) => clearKeys.has(cellKey(r.opId, r.date))));
        setSaveState('error');
        setMsg(friendlyError(getErrorMessage(err), role));
      }
    }

    if (proposedItemsToSave.length > 0) {
      await saveDraftProposal(proposedItemsToSave, () => {
        const shiftRb = shiftRollback.filter((r) => saveShiftKeys.has(cellKey(r.opId, r.date)));
        const sbRb = sbRollback.filter((r) => saveSbKeys.has(cellKey(r.opId, r.date)));
        if (shiftRb.length > 0) rollbackShiftKeys(shiftRb);
        if (sbRb.length > 0) rollbackStandbyKeys(sbRb);
      });
    }
  }

  async function submitDraftBatch() {
    if (!draftReqId || draftItems.length === 0) return;
    setIsSubmittingDraft(true);
    setMsg('');
    const sb = supabaseBrowser();

    try {
      const { error } = await sb.rpc('submit_change_request', {
        p_request_id: draftReqId,
        p_note: submitNote.trim() || null,
      });

      if (error) {
        setMsg('Could not submit changes: ' + error.message);
      } else {
        const count = draftItems.length;
        setDraftReqId(null);
        setDraftItems([]);
        setSubmitModalOpen(false);
        setSubmitNote('');
        setMsg(`✓ Successfully submitted ${count} change(s) for admin approval.`);
        startTransition(() => router.refresh());
      }
    } catch (e: unknown) {
      setMsg(getErrorMessage(e, 'Network error while submitting changes'));
    } finally {
      setIsSubmittingDraft(false);
    }
  }

  async function discardDraftBatch() {
    if (!draftReqId) {
      setDraftItems([]);
      return;
    }
    const sb = supabaseBrowser();
    await sb.from('change_requests').delete().eq('id', draftReqId);
    setDraftReqId(null);
    setDraftItems([]);
    setMsg('Draft proposal discarded.');
    startTransition(() => router.refresh());
  }

  return {
    draftReqId,
    setDraftReqId,
    draftItems,
    setDraftItems,
    proposedDraftItems,
    submitModalOpen,
    setSubmitModalOpen,
    submitNote,
    setSubmitNote,
    isSubmittingDraft,
    ensureDraftRequestId,
    mergeDraftItems,
    clearDraftOverlap,
    saveDraftProposal,
    syncProposedHistoryChanges,
    submitDraftBatch,
    discardDraftBatch,
  };
}
