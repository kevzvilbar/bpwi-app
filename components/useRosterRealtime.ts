'use client';

import {
  useEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  type TransitionStartFunction,
} from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { subscribeVisibilityAwareChannel } from '@/lib/supabase/realtime';
import type { EditGrant } from '@/lib/profile';
import type { Row, Standby } from '@/lib/roster-helpers';

export interface UseRosterRealtimeOptions {
  month: string;
  role: string;
  editGrant?: EditGrant | null;
  routerRef: MutableRefObject<{ refresh: () => void }>;
  startTransition: TransitionStartFunction;
  setRows: Dispatch<SetStateAction<Row[]>>;
  setStandby: Dispatch<SetStateAction<Standby[]>>;
}

/**
 * Tracks manager edit-grant expiration countdown and subscribes to visibility-aware
 * Supabase Realtime updates for schedule and standby assignments in the active month.
 */
export function useRosterRealtime({
  month,
  role,
  editGrant,
  routerRef,
  startTransition,
  setRows,
  setStandby,
}: UseRosterRealtimeOptions): boolean {
  const [grantExpired, setGrantExpired] = useState(false);

  useEffect(() => {
    setGrantExpired(false);
    if (role !== 'manager' || !editGrant) return;
    const ms = Date.parse(editGrant.ends_at) - Date.now();
    if (ms <= 0) {
      setGrantExpired(true);
      return;
    }
    const timer = setTimeout(() => setGrantExpired(true), Math.min(ms + 250, 2_000_000_000));
    return () => clearTimeout(timer);
  }, [role, editGrant]);

  useEffect(() => {
    const sb = supabaseBrowser();
    return subscribeVisibilityAwareChannel({
      sb,
      channelName: `roster-sync-${month}`,
      onReconnect: () => startTransition(() => routerRef.current.refresh()),
      listeners: [
        {
          table: 'schedule_assignments',
          onEvent: (payload) => {
            const rec = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Partial<Row> | undefined;
            if (!rec?.operator_id || !rec?.schedule_date || !rec.schedule_date.startsWith(month)) return;
            if (payload.eventType === 'DELETE') {
              setRows((r) =>
                r.filter((x) => !(x.operator_id === rec.operator_id && x.schedule_date === rec.schedule_date)),
              );
            } else {
              const nextRow: Row = {
                operator_id: rec.operator_id,
                schedule_date: rec.schedule_date,
                shift_type_id: rec.shift_type_id ?? null,
                area_code_id: rec.area_code_id ?? null,
              };
              setRows((r) => [
                ...r.filter((x) => !(x.operator_id === nextRow.operator_id && x.schedule_date === nextRow.schedule_date)),
                nextRow,
              ]);
            }
          },
        },
        {
          table: 'standby_assignments',
          onEvent: (payload) => {
            const rec = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Partial<Standby> | undefined;
            if (!rec?.operator_id || !rec?.schedule_date || !rec.schedule_date.startsWith(month)) return;
            if (payload.eventType === 'DELETE') {
              setStandby((s) =>
                s.filter((x) => !(x.operator_id === rec.operator_id && x.schedule_date === rec.schedule_date)),
              );
            } else {
              const nextSb: Standby = {
                operator_id: rec.operator_id,
                schedule_date: rec.schedule_date,
                standby_type: rec.standby_type ?? 'OC',
              };
              setStandby((s) => [
                ...s.filter((x) => !(x.operator_id === nextSb.operator_id && x.schedule_date === nextSb.schedule_date)),
                nextSb,
              ]);
            }
          },
        },
      ],
    });
  }, [month, routerRef, setRows, setStandby, startTransition]);

  return grantExpired;
}
