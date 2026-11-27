'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { reportClientTelemetry } from '@/lib/client-telemetry';
import { classifySyncError } from '@/lib/error-utils';
import {
  flushOfflineMutations,
  flushOfflineQueue,
  flushOfflineReports,
  getOfflineMutations,
  getOfflineQueue,
  getOfflineReports,
  removeOfflineItem,
  removeOfflineMutation,
  removeOfflineReport,
  retrySingleOfflineActivity,
  retrySingleOfflineMutation,
  retrySingleOfflineReport,
  type PendingOfflineActivity,
  type PendingOfflineMutation,
  type PendingOfflineReport,
} from '@/lib/offline-queue';
import { describeQueuedActivity, describeQueuedMutation, describeQueuedReport } from '@/lib/offline-sync-core';

export default function OfflineSyncBanner({ userId }: { userId?: string }) {
  const [online, setOnline] = useState<boolean>(true);
  const [acts, setActs] = useState<PendingOfflineActivity[]>([]);
  const [reps, setReps] = useState<PendingOfflineReport[]>([]);
  const [muts, setMuts] = useState<PendingOfflineMutation[]>([]);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [confirmDiscardId, setConfirmDiscardId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState<boolean>(false);
  const [statusNote, setStatusNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const didAutoSyncOnMountRef = useRef<boolean>(false);
  const totalQueuedRef = useRef<number>(0);
  const syncingRef = useRef<boolean>(false);

  const refreshQueue = useCallback(async () => {
    const [nextActs, nextReps, nextMuts] = await Promise.all([
      getOfflineQueue(userId),
      getOfflineReports(userId),
      getOfflineMutations(userId),
    ]);
    setActs(nextActs);
    setReps(nextReps);
    setMuts(nextMuts);
    const total = nextActs.length + nextReps.length + nextMuts.length;
    if (total === 0) {
      setDetailsOpen(false);
      setConfirmDiscardId(null);
    }
    return total;
  }, [userId]);

  const syncAll = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    setSyncing(true);
    setStatusNote(null);
    const sb = supabaseBrowser();
    const [actRes, repRes, mutRes] = await Promise.all([
      flushOfflineQueue(sb, userId),
      flushOfflineReports(sb, userId),
      flushOfflineMutations(sb, userId),
    ]);
    await refreshQueue();
    setSyncing(false);

    const totalSynced = actRes.synced.length + repRes.synced + mutRes.synced;
    const totalFailed = actRes.failed + repRes.failed + mutRes.failed;
    if (totalFailed > 0) {
      const firstErr =
        actRes.errors[0]?.message ?? repRes.errors[0]?.message ?? mutRes.errors[0]?.message ?? 'Sync failed';
      const errKind = classifySyncError(firstErr);
      reportClientTelemetry({
        event: 'offline_sync_failed',
        category: errKind,
        failedCount: totalFailed,
        syncedCount: totalSynced,
        route: typeof window !== 'undefined' ? window.location.pathname : undefined,
        message: firstErr,
      });
      if (errKind === 'auth') {
        setStatusNote({
          kind: 'err',
          text: `Session expired — sign in again to sync ${totalFailed} queued item${totalFailed === 1 ? '' : 's'}. Your unsent work is safe on this device.`,
        });
        setDetailsOpen(true);
      } else if (errKind === 'network') {
        setStatusNote({
          kind: 'err',
          text:
            totalSynced > 0
              ? `Synced ${totalSynced} item(s); connection is weak so ${totalFailed} remaining item(s) will retry automatically.`
              : `Connection is weak — ${totalFailed} queued item${totalFailed === 1 ? '' : 's'} will retry automatically.`,
        });
      } else {
        setStatusNote({
          kind: 'err',
          text:
            totalSynced > 0
              ? `Synced ${totalSynced} item(s), but ${totalFailed} failed: ${firstErr}`
              : `${totalFailed} queued item${totalFailed === 1 ? '' : 's'} failed to sync: ${firstErr}`,
        });
        setDetailsOpen(true);
      }
    } else if (totalSynced > 0) {
      setStatusNote({
        kind: 'ok',
        text: `Synced ${totalSynced} queued item${totalSynced === 1 ? '' : 's'}.`,
      });
      setTimeout(() => setStatusNote(null), 4000);
    }
  }, [refreshQueue, userId]);

  useEffect(() => {
    totalQueuedRef.current = acts.length + reps.length + muts.length;
  }, [acts.length, reps.length, muts.length]);

  useEffect(() => {
    syncingRef.current = syncing;
  }, [syncing]);

  useEffect(() => {
    const isNowOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    setOnline(isNowOnline);
    void refreshQueue().then((total) => {
      if (isNowOnline && total > 0 && !didAutoSyncOnMountRef.current) {
        didAutoSyncOnMountRef.current = true;
        void syncAll();
      }
    });

    const onOnline = () => {
      setOnline(true);
      void syncAll();
    };
    const onOffline = () => setOnline(false);
    const onQueueChanged = () => void refreshQueue();
    const tryForegroundSync = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (totalQueuedRef.current > 0 && !syncingRef.current) {
        void syncAll();
      }
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('bpwi-offline-queue-changed', onQueueChanged);
    window.addEventListener('focus', tryForegroundSync);
    document.addEventListener('visibilitychange', tryForegroundSync);
    const retryInterval = setInterval(tryForegroundSync, 120_000);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('bpwi-offline-queue-changed', onQueueChanged);
      window.removeEventListener('focus', tryForegroundSync);
      document.removeEventListener('visibilitychange', tryForegroundSync);
      clearInterval(retryInterval);
    };
  }, [refreshQueue, syncAll]);

  const actCount = acts.length;
  const repCount = reps.length;
  const mutCount = muts.length;
  const totalQueued = actCount + repCount + mutCount;
  const failedCount =
    acts.filter((a) => Boolean(a.lastError)).length +
    reps.filter((r) => Boolean(r.lastError)).length +
    muts.filter((m) => Boolean(m.lastError)).length;

  if (online && totalQueued === 0 && !statusNote) return null;

  const tone = !online
    ? { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)', border: 'var(--warn-border)' }
    : failedCount > 0 || statusNote?.kind === 'err'
      ? { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)', border: 'var(--danger-border)' }
      : totalQueued > 0
        ? { bg: 'var(--info-bg)', fg: 'var(--info-fg)', border: 'var(--info-border)' }
        : { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)', border: 'var(--ok-border)' };

  async function retryActivity(item: PendingOfflineActivity) {
    setBusyItemId(item.queueId);
    const res = await retrySingleOfflineActivity(supabaseBrowser(), item);
    await refreshQueue();
    setBusyItemId(null);
    if (res.row) {
      setStatusNote({ kind: 'ok', text: 'Synced queued activity.' });
      setTimeout(() => setStatusNote(null), 3500);
    } else if (res.error) {
      setStatusNote({ kind: 'err', text: `Retry failed: ${res.error}` });
    }
  }

  async function retryReport(item: PendingOfflineReport) {
    setBusyItemId(item.queueId);
    const res = await retrySingleOfflineReport(supabaseBrowser(), item);
    await refreshQueue();
    setBusyItemId(null);
    if (res.ok) {
      setStatusNote({ kind: 'ok', text: 'Synced queued report.' });
      setTimeout(() => setStatusNote(null), 3500);
    } else if (res.error) {
      setStatusNote({ kind: 'err', text: `Retry failed: ${res.error}` });
    }
  }

  async function retryMutation(item: PendingOfflineMutation) {
    setBusyItemId(item.queueId);
    const res = await retrySingleOfflineMutation(supabaseBrowser(), item);
    await refreshQueue();
    setBusyItemId(null);
    if (res.ok) {
      setStatusNote({ kind: 'ok', text: 'Synced queued update.' });
      setTimeout(() => setStatusNote(null), 3500);
    } else if (res.error) {
      setStatusNote({ kind: 'err', text: `Retry failed: ${res.error}` });
    }
  }

  async function discardItem(kind: 'activity' | 'report' | 'mutation', queueId: string) {
    setBusyItemId(queueId);
    if (kind === 'activity') await removeOfflineItem(queueId);
    else if (kind === 'report') await removeOfflineReport(queueId);
    else await removeOfflineMutation(queueId);
    setConfirmDiscardId(null);
    await refreshQueue();
    setBusyItemId(null);
  }

  return (
    <div
      className="no-print"
      role={failedCount > 0 || statusNote?.kind === 'err' ? 'alert' : 'status'}
      style={{
        background: tone.bg,
        color: tone.fg,
        borderBottom: `1px solid ${tone.border}`,
        padding: '7px 14px',
        fontSize: 12.5,
      }}
    >
      <div style={{ maxWidth: 1440, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <span>
          {!online ? (
            <>
              <strong>Offline Mode:</strong> No internet signal. Field logs, reports, PM updates &amp; handovers will queue on this device
              {totalQueued > 0 ? ` (${totalQueued} waiting)` : ''}.
            </>
          ) : failedCount > 0 ? (
            <>
              <strong>
                {failedCount} queued item{failedCount === 1 ? '' : 's'} need attention
              </strong>
              {totalQueued > failedCount ? ` (${totalQueued} total queued)` : ''}.
              {statusNote?.kind === 'err' ? ` ${statusNote.text}` : ' Inspect details to retry or discard.'}
            </>
          ) : totalQueued > 0 ? (
            <>
              <strong>{totalQueued} queued offline</strong>
              {actCount > 0 ? ` · ${actCount} activit${actCount === 1 ? 'y' : 'ies'}` : ''}
              {repCount > 0 ? ` · ${repCount} report${repCount === 1 ? '' : 's'}` : ''}
              {mutCount > 0 ? ` · ${mutCount} field update${mutCount === 1 ? '' : 's'}` : ''} ready to sync.
            </>
          ) : (
            <strong>{statusNote?.text}</strong>
          )}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {totalQueued > 0 && (
            <button
              type="button"
              className="btn"
              aria-expanded={detailsOpen}
              style={{ padding: '3px 10px', minHeight: 36, fontSize: 12 }}
              onClick={() => setDetailsOpen((o) => !o)}
            >
              {detailsOpen ? 'Hide Queue' : `Inspect Queue (${totalQueued})`}
            </button>
          )}
          {online && totalQueued > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={syncing}
              style={{ padding: '3px 10px', minHeight: 36, fontSize: 12 }}
              onClick={() => void syncAll()}
            >
              {syncing ? 'Syncing…' : `Sync Now (${totalQueued})`}
            </button>
          )}
        </div>
      </div>

      {detailsOpen && totalQueued > 0 && (
        <div
          style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: `1px solid ${tone.border}`,
            display: 'grid',
            gap: 6,
          }}
        >
          {acts.map((item) => {
            const meta = describeQueuedActivity(item.payload, item.editingId);
            const busy = syncing || busyItemId === item.queueId;
            return (
              <div
                key={item.queueId}
                style={{
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  border: `1px solid ${item.lastError ? 'var(--danger-border)' : 'var(--border-light)'}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'grid', gap: 2, minWidth: 0, flex: '1 1 220px' }}>
                  <div style={{ fontWeight: 700, fontSize: 12.5 }}>
                    Activity · {meta.title}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{meta.subtitle}</div>
                  {item.lastError && (
                    <div style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>
                      Sync error{item.attempts ? ` (attempt ${item.attempts})` : ''}: {item.lastError}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {online && (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      style={{ minHeight: 36, padding: '3px 9px', fontSize: 12 }}
                      onClick={() => void retryActivity(item)}
                    >
                      {busyItemId === item.queueId ? 'Retrying…' : 'Retry'}
                    </button>
                  )}
                  {confirmDiscardId === item.queueId ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-danger-soft"
                        disabled={busy}
                        style={{
                          minHeight: 36,
                          padding: '3px 9px',
                          fontSize: 12,
                        }}
                        onClick={() => void discardItem('activity', item.queueId)}
                      >
                        Confirm discard
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        style={{ minHeight: 36, padding: '3px 9px', fontSize: 12 }}
                        onClick={() => setConfirmDiscardId(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      style={{ minHeight: 36, padding: '3px 9px', fontSize: 12, color: 'var(--danger)' }}
                      onClick={() => setConfirmDiscardId(item.queueId)}
                    >
                      Discard
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {reps.map((item) => {
            const meta = describeQueuedReport(item.payload, item.editingId);
            const busy = syncing || busyItemId === item.queueId;
            return (
              <div
                key={item.queueId}
                style={{
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  border: `1px solid ${item.lastError ? 'var(--danger-border)' : 'var(--border-light)'}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'grid', gap: 2, minWidth: 0, flex: '1 1 220px' }}>
                  <div style={{ fontWeight: 700, fontSize: 12.5 }}>{meta.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{meta.subtitle}</div>
                  {item.lastError && (
                    <div style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>
                      Sync error{item.attempts ? ` (attempt ${item.attempts})` : ''}: {item.lastError}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {online && (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      style={{ minHeight: 36, padding: '3px 9px', fontSize: 12 }}
                      onClick={() => void retryReport(item)}
                    >
                      {busyItemId === item.queueId ? 'Retrying…' : 'Retry'}
                    </button>
                  )}
                  {confirmDiscardId === item.queueId ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-danger-soft"
                        disabled={busy}
                        style={{
                          minHeight: 36,
                          padding: '3px 9px',
                          fontSize: 12,
                        }}
                        onClick={() => void discardItem('report', item.queueId)}
                      >
                        Confirm discard
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        style={{ minHeight: 36, padding: '3px 9px', fontSize: 12 }}
                        onClick={() => setConfirmDiscardId(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      style={{ minHeight: 36, padding: '3px 9px', fontSize: 12, color: 'var(--danger)' }}
                      onClick={() => setConfirmDiscardId(item.queueId)}
                    >
                      Discard
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {muts.map((item) => {
            const meta = describeQueuedMutation(item.kind, item.payload);
            const busy = syncing || busyItemId === item.queueId;
            return (
              <div
                key={item.queueId}
                style={{
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  border: `1px solid ${item.lastError ? 'var(--danger-border)' : 'var(--border-light)'}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'grid', gap: 2, minWidth: 0, flex: '1 1 220px' }}>
                  <div style={{ fontWeight: 700, fontSize: 12.5 }}>{meta.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{meta.subtitle}</div>
                  {item.lastError && (
                    <div style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>
                      Sync error{item.attempts ? ` (attempt ${item.attempts})` : ''}: {item.lastError}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {online && (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      style={{ minHeight: 36, padding: '3px 9px', fontSize: 12 }}
                      onClick={() => void retryMutation(item)}
                    >
                      {busyItemId === item.queueId ? 'Retrying…' : 'Retry'}
                    </button>
                  )}
                  {confirmDiscardId === item.queueId ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-danger-soft"
                        disabled={busy}
                        style={{ minHeight: 36, padding: '3px 9px', fontSize: 12 }}
                        onClick={() => void discardItem('mutation', item.queueId)}
                      >
                        Confirm discard
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        style={{ minHeight: 36, padding: '3px 9px', fontSize: 12 }}
                        onClick={() => setConfirmDiscardId(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      style={{ minHeight: 36, padding: '3px 9px', fontSize: 12, color: 'var(--danger)' }}
                      onClick={() => setConfirmDiscardId(item.queueId)}
                    >
                      Discard
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
