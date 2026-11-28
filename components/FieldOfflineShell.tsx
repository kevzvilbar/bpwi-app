'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { addIsoDays, fmtTimeManila, manilaNowMinutes, manilaToday } from '@/lib/date';
import { computePermissions } from '@/lib/permissions';
import { isMissingCompletedByColumnError } from '@/lib/pm-credit';
import {
  buildOwnActivityOrFilter,
  DAILY_ACTIVITY_LIST_COLUMNS,
  PM_TASK_COLUMNS,
  PM_TASK_COLUMNS_LEGACY,
} from '@/lib/query-columns';
import { getErrorMessage } from '@/lib/error-utils';
import type { DailyActivityRow } from '@/lib/activity-types';
import {
  loadFieldReferenceSnapshot,
  saveFieldReferenceSnapshot,
  type FieldReferenceSnapshot,
  type FieldSnapshotArea,
  type FieldSnapshotTask,
} from '@/lib/offline-queue';
import MobileView from '@/components/MobileView';
import { Badge, EmptyState } from '@/components/ui';

/**
 * Offline-first app shell for `/field`.
 * Renders immediately from per-user IndexedDB reference data and refreshes quietly from Supabase when online,
 * using the device's live Manila date rather than an SSR-cached date.
 */
export default function FieldOfflineShell() {
  const router = useRouter();
  const [liveToday, setLiveToday] = useState<string>(() => manilaToday());
  const [nowMinutes, setNowMinutes] = useState<number>(() => manilaNowMinutes());
  const [online, setOnline] = useState<boolean>(true);
  const [snapshot, setSnapshot] = useState<FieldReferenceSnapshot | null>(null);
  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [syncError, setSyncError] = useState<string>('');

  const refreshOnlineData = useCallback(
    async (targetDate: string) => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      setRefreshing(true);
      setSyncError('');
      try {
        const sb = supabaseBrowser();
        const {
          data: { user },
        } = await sb.auth.getUser();
        if (!user) {
          router.replace('/login');
          return;
        }

        const cachedForUser = await loadFieldReferenceSnapshot(user.id);
        if (cachedForUser) {
          setSnapshot((prev) => prev ?? cachedForUser);
          setLoadingInitial(false);
        }

        const { data: prof } = await sb
          .from('user_profiles')
          .select('organization_id, role, is_active, operator_id, can_approve')
          .eq('id', user.id)
          .maybeSingle();

        if (!prof || prof.is_active === false || !prof.organization_id) {
          setSyncError('Your account is inactive or missing an organization.');
          return;
        }

        const role = String(prof.role ?? 'viewer');
        const isActive = true;
        let hasLiveEditGrant = false;
        if (role === 'manager') {
          const nowIso = new Date().toISOString();
          const { data: grantRows } = await sb
            .from('edit_grants')
            .select('id')
            .eq('user_id', user.id)
            .is('revoked_at', null)
            .lte('starts_at', nowIso)
            .gt('ends_at', nowIso)
            .limit(1);
          hasLiveEditGrant = Boolean(grantRows && grantRows.length > 0);
        }

        const perms = computePermissions({
          role,
          isActive,
          canApproveFlag: prof.can_approve === true,
          hasLiveEditGrant,
        });

        const operatorId = (prof.operator_id ?? null) as string | null;
        const orgId = String(prof.organization_id);
        const prevDate = addIsoDays(targetDate, -1);
        const pmFrom = addIsoDays(targetDate, -14);
        const pmTo = addIsoDays(targetDate, 30);
        const ownActFilter = !perms.canVerifyActivity ? buildOwnActivityOrFilter(user.id, operatorId) : null;

        const [areasPrimary, ops, shifts, allAsg, standby, tasksPrimary, actTypes, dailyActs] = await Promise.all([
          sb.from('area_codes').select('id, code, name, category, sub_sites'),
          sb
            .from('operators')
            .select('id, full_name, position, default_station')
            .eq('is_active', true)
            .order('sort_order'),
          sb
            .from('shift_types')
            .select('id, code, description, start_time, end_time, background_color, text_color, is_off')
            .order('code'),
          sb
            .from('schedule_assignments')
            .select('operator_id, schedule_date, shift_type_id, area_code_id')
            .in('schedule_date', [targetDate, prevDate]),
          sb.from('standby_assignments').select('operator_id, standby_type').eq('schedule_date', targetDate),
          sb
            .from('pm_tasks')
            .select(PM_TASK_COLUMNS)
            .gte('scheduled_date', pmFrom)
            .lte('scheduled_date', pmTo)
            .order('scheduled_date'),
          sb.from('pm_activity_types').select('code, label, short_label, color'),
          (() => {
            let q = sb
              .from('daily_activities')
              .select(DAILY_ACTIVITY_LIST_COLUMNS)
              .eq('activity_date', targetDate)
              .order('created_at', { ascending: false });
            if (ownActFilter) q = q.or(ownActFilter);
            return q;
          })(),
        ]);

        let tasksData = (tasksPrimary.data ?? []) as FieldSnapshotTask[];
        let tasksError = tasksPrimary.error;
        if (isMissingCompletedByColumnError(tasksPrimary.error)) {
          const legacyRes = await sb
            .from('pm_tasks')
            .select(PM_TASK_COLUMNS_LEGACY)
            .gte('scheduled_date', pmFrom)
            .lte('scheduled_date', pmTo)
            .order('scheduled_date');
          tasksData = ((legacyRes.data ?? []) as FieldSnapshotTask[]).map((t) => ({
            ...t,
            completed_by_operator_ids: [],
          }));
          tasksError = legacyRes.error;
        }

        const areasRes = areasPrimary.error
          ? await sb.from('area_codes').select('id, code, name, category')
          : areasPrimary;

        const err =
          ops.error?.message ||
          shifts.error?.message ||
          areasRes.error?.message ||
          allAsg.error?.message ||
          standby.error?.message ||
          tasksError?.message ||
          '';
        if (err) {
          setSyncError(err);
          return;
        }

        const partialWarnings = [
          actTypes.error ? `activity types (${actTypes.error.message})` : '',
          dailyActs.error ? `recent activities (${dailyActs.error.message})` : '',
        ].filter(Boolean);
        if (partialWarnings.length > 0) {
          setSyncError(`Could not refresh all field data: ${partialWarnings.join(' · ')}`);
        }

        const asgRows = (allAsg.data ?? []) as Array<{
          operator_id: string;
          schedule_date: string;
          shift_type_id: string | null;
          area_code_id: string | null;
        }>;
        const nextSnapshot: FieldReferenceSnapshot = {
          userId: user.id,
          orgId,
          role,
          operatorId,
          canClosePm: perms.canClosePm,
          canLogActivity: perms.canLogActivity,
          canLogSampleActivity: perms.canLogSampleActivity,
          canVerifyActivity: perms.canVerifyActivity,
          savedAt: new Date().toISOString(),
          snapshotDate: targetDate,
          operators: ((ops.data ?? []) as Array<{
            id: string;
            full_name: string;
            position: string | null;
            default_station: string | null;
          }>).map((o) => ({
            id: o.id,
            full_name: o.full_name,
            position: o.position,
            phone_number: null,
            default_station: o.default_station,
          })),
          shifts: (shifts.data ?? []) as FieldReferenceSnapshot['shifts'],
          areas: (areasRes.data ?? []) as FieldSnapshotArea[],
          assignments: asgRows
            .filter((r) => r.schedule_date === targetDate)
            .map(({ operator_id, shift_type_id, area_code_id }) => ({
              operator_id,
              shift_type_id,
              area_code_id,
            })),
          yesterdayAssignments: asgRows
            .filter((r) => r.schedule_date === prevDate)
            .map(({ operator_id, shift_type_id, area_code_id }) => ({
              operator_id,
              shift_type_id,
              area_code_id,
            })),
          standby: (standby.data ?? []) as FieldReferenceSnapshot['standby'],
          tasks: tasksData,
          activityTypes: actTypes.error
            ? (cachedForUser?.activityTypes ?? [])
            : ((actTypes.data ?? []) as FieldReferenceSnapshot['activityTypes']),
          recentActivities: dailyActs.error
            ? (cachedForUser?.recentActivities ?? [])
            : ((dailyActs.data ?? []) as DailyActivityRow[]),
        };

        await saveFieldReferenceSnapshot(nextSnapshot);
        setSnapshot(nextSnapshot);
      } catch (err: unknown) {
        setSyncError(getErrorMessage(err, 'Could not refresh field data'));
      } finally {
        setLoadingInitial(false);
        setRefreshing(false);
      }
    },
    [router],
  );

  useEffect(() => {
    let active = true;
    const isNowOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    const initialDate = manilaToday();
    setOnline(isNowOnline);
    setLiveToday(initialDate);
    setNowMinutes(manilaNowMinutes());

    void loadFieldReferenceSnapshot()
      .then((cached) => {
        if (!active) return;
        if (cached) setSnapshot(cached);
        setLoadingInitial(false);
        if (isNowOnline) {
          void refreshOnlineData(initialDate);
        }
      })
      .catch(() => {
        if (!active) return;
        setLoadingInitial(false);
        if (isNowOnline) void refreshOnlineData(initialDate);
      });

    const onOnline = () => {
      setOnline(true);
      const d = manilaToday();
      setLiveToday(d);
      setNowMinutes(manilaNowMinutes());
      void refreshOnlineData(d);
    };
    const onOffline = () => {
      setOnline(false);
      setLiveToday(manilaToday());
      setNowMinutes(manilaNowMinutes());
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const d = manilaToday();
      setLiveToday(d);
      setNowMinutes(manilaNowMinutes());
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        void refreshOnlineData(d);
      }
    };
    const timer = setInterval(() => {
      setLiveToday(manilaToday());
      setNowMinutes(manilaNowMinutes());
    }, 60_000);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshOnlineData]);

  if (loadingInitial && !snapshot) {
    return (
      <div className="tasks-shell stack-md">
        <div className="card card-pad-sm" role="status">
          Loading field workspace…
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="tasks-shell stack-md">
        <EmptyState
          title="No offline field snapshot saved yet"
          description={
            online
              ? syncError || 'Signing in or loading reference data is required before logging offline.'
              : 'Connect to the internet once and sign in to download today’s operators, areas, shifts, and PM tasks to this phone.'
          }
          action={
            online ? (
              <button type="button" className="btn btn-primary" onClick={() => void refreshOnlineData(liveToday)}>
                Retry Sync
              </button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const savedLabel = fmtTimeManila(snapshot.savedAt);
  const effectiveActivities =
    snapshot.snapshotDate === liveToday ? snapshot.recentActivities : ([] as DailyActivityRow[]);

  return (
    <div className="stack-sm">
      <div className="tasks-shell" style={{ paddingBottom: 0 }}>
        <div
          className="card card-pad-sm"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
            <Badge tone={online ? 'ok' : 'warn'}>{online ? 'Field Mode' : 'Offline Snapshot'}</Badge>
            <span style={{ color: 'var(--text-secondary)' }}>
              Last updated: <b>{snapshot.snapshotDate}</b> at <b>{savedLabel}</b>
            </span>
            {syncError && (
              <span style={{ color: 'var(--danger)' }}>· {syncError}</span>
            )}
          </div>
          {online && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={refreshing}
              onClick={() => void refreshOnlineData(liveToday)}
            >
              {refreshing ? 'Refreshing…' : 'Refresh Data'}
            </button>
          )}
        </div>
      </div>

      <MobileView
        key={`${liveToday}-${snapshot.savedAt}`}
        date={liveToday}
        today={liveToday}
        nowMinutes={nowMinutes}
        orgId={snapshot.orgId}
        userId={snapshot.userId}
        role={snapshot.role}
        operatorId={snapshot.operatorId}
        canClosePm={snapshot.canClosePm}
        canLogActivity={snapshot.canLogActivity}
        canLogSampleActivity={snapshot.canLogSampleActivity}
        canVerifyActivity={snapshot.canVerifyActivity}
        operators={snapshot.operators}
        shifts={snapshot.shifts}
        areas={snapshot.areas}
        assignments={snapshot.assignments}
        yesterdayAssignments={snapshot.yesterdayAssignments}
        standby={snapshot.standby}
        tasks={snapshot.tasks}
        activityTypes={snapshot.activityTypes}
        initialActivities={effectiveActivities}
        disableSnapshotSave={true}
        error={syncError && online ? syncError : ''}
      />
    </div>
  );
}
