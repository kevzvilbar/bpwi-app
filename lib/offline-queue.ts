import type { SupabaseClient } from '@supabase/supabase-js';
import type { DailyActivityRow } from './activity-types';
import { uploadDataUrlPhoto } from './image-compress';
import { getErrorMessage } from './error-utils';
import { isOwnedByUser, newClientId, syncQueuedActivity, syncQueuedReport } from './offline-sync-core';

const DB_NAME = 'bpwi-field-sync-db';
const DB_VERSION = 2;
const STORE_NAME = 'pending_activities';
const REPORT_STORE_NAME = 'pending_reports';

export type PendingOfflineActivity = {
  queueId: string;
  queuedAt: string;
  ownerUserId?: string | null;
  attempts?: number;
  lastError?: string | null;
  lastAttemptAt?: string | null;
  editingId?: string | null;
  payload: Record<string, unknown>;
};

export type PendingOfflineReport = {
  queueId: string;
  queuedAt: string;
  ownerUserId?: string | null;
  attempts?: number;
  lastError?: string | null;
  lastAttemptAt?: string | null;
  editingId: string | null;
  payload: Record<string, unknown>;
};

export type OfflineSyncFailure = {
  queueId: string;
  message: string;
};

function notifyQueueChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('bpwi-offline-queue-changed'));
  }
}

function notifyActivitySynced(rows: DailyActivityRow[]) {
  if (typeof window !== 'undefined' && rows.length > 0) {
    window.dispatchEvent(new CustomEvent('bpwi-offline-activity-synced', { detail: { rows } }));
  }
}

function openSyncDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'queueId' });
      }
      if (!db.objectStoreNames.contains(REPORT_STORE_NAME)) {
        db.createObjectStore(REPORT_STORE_NAME, { keyPath: 'queueId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

async function putRecord<T>(storeName: string, value: T): Promise<void> {
  const db = await openSyncDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`Failed to write to ${storeName}`));
  });
  db.close();
}

export async function enqueueOfflineActivity(
  payload: Record<string, unknown>,
  ownerUserId?: string | null,
  opts?: { editingId?: string | null },
): Promise<PendingOfflineActivity> {
  const resolvedOwner =
    ownerUserId ?? (typeof payload.logged_by === 'string' && payload.logged_by ? payload.logged_by : null);
  const editingId = opts?.editingId?.trim() ? opts.editingId.trim() : null;
  const nextPayload = editingId
    ? { ...payload }
    : { ...payload, id: typeof payload.id === 'string' && payload.id ? payload.id : newClientId() };
  const item: PendingOfflineActivity = {
    queueId: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    queuedAt: new Date().toISOString(),
    ownerUserId: resolvedOwner,
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
    editingId,
    // Client-generated primary key makes a retried insert sync idempotent (see offline-sync-core.ts)
    payload: nextPayload,
  };
  await putRecord(STORE_NAME, item);
  notifyQueueChanged();
  return item;
}

export async function getOfflineQueue(ownerUserId?: string | null): Promise<PendingOfflineActivity[]> {
  try {
    const db = await openSyncDb();
    const list = await new Promise<PendingOfflineActivity[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as PendingOfflineActivity[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return list
      .filter((item) => isOwnedByUser(item, ownerUserId))
      .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  } catch {
    return [];
  }
}

export async function removeOfflineItem(queueId: string): Promise<void> {
  try {
    const db = await openSyncDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(queueId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    notifyQueueChanged();
  } catch {
    /* ignore */
  }
}

async function recordActivityError(item: PendingOfflineActivity, message: string): Promise<void> {
  try {
    await putRecord(STORE_NAME, {
      ...item,
      attempts: (item.attempts ?? 0) + 1,
      lastError: message,
      lastAttemptAt: new Date().toISOString(),
    });
    notifyQueueChanged();
  } catch {
    /* ignore */
  }
}

export async function retrySingleOfflineActivity(
  sb: SupabaseClient,
  item: PendingOfflineActivity,
): Promise<{ row: DailyActivityRow | null; error: string | null }> {
  try {
    const row = (await syncQueuedActivity(
      sb,
      item.queueId,
      item.payload,
      uploadDataUrlPhoto,
      item.editingId ?? null,
    )) as unknown as DailyActivityRow;
    await removeOfflineItem(item.queueId);
    notifyActivitySynced([row]);
    return { row, error: null };
  } catch (err: unknown) {
    const msg = getErrorMessage(err, 'Failed to sync activity');
    await recordActivityError(item, msg);
    return { row: null, error: msg };
  }
}

let activityFlush: Promise<{ synced: DailyActivityRow[]; failed: number; errors: OfflineSyncFailure[] }> | null = null;

/**
 * Several screens and the sync banner call this on reconnect. Concurrent runs would each push the
 * same queued item, so callers share one in-flight run.
 */
export function flushOfflineQueue(
  sb: SupabaseClient,
  ownerUserId?: string | null,
): Promise<{
  synced: DailyActivityRow[];
  failed: number;
  errors: OfflineSyncFailure[];
}> {
  if (activityFlush) return activityFlush;
  activityFlush = runActivityFlush(sb, ownerUserId).finally(() => {
    activityFlush = null;
  });
  return activityFlush;
}

async function runActivityFlush(
  sb: SupabaseClient,
  ownerUserId?: string | null,
): Promise<{ synced: DailyActivityRow[]; failed: number; errors: OfflineSyncFailure[] }> {
  const items = await getOfflineQueue(ownerUserId);
  const synced: DailyActivityRow[] = [];
  const errors: OfflineSyncFailure[] = [];

  for (const item of items) {
    const res = await retrySingleOfflineActivity(sb, item);
    if (res.row) {
      synced.push(res.row);
    } else if (res.error) {
      errors.push({ queueId: item.queueId, message: res.error });
    }
  }

  return { synced, failed: errors.length, errors };
}

export async function enqueueOfflineReport(
  editingId: string | null,
  payload: Record<string, unknown>,
  ownerUserId?: string | null,
): Promise<PendingOfflineReport> {
  const resolvedOwner =
    ownerUserId ?? (typeof payload.submitted_by === 'string' && payload.submitted_by ? payload.submitted_by : null);
  const nextPayload = editingId
    ? { ...payload }
    : { ...payload, id: typeof payload.id === 'string' && payload.id ? payload.id : newClientId() };
  const item: PendingOfflineReport = {
    queueId: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    queuedAt: new Date().toISOString(),
    ownerUserId: resolvedOwner,
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
    editingId,
    payload: nextPayload,
  };
  await putRecord(REPORT_STORE_NAME, item);
  notifyQueueChanged();
  return item;
}

export async function getOfflineReports(ownerUserId?: string | null): Promise<PendingOfflineReport[]> {
  try {
    const db = await openSyncDb();
    const list = await new Promise<PendingOfflineReport[]>((resolve, reject) => {
      const tx = db.transaction(REPORT_STORE_NAME, 'readonly');
      const req = tx.objectStore(REPORT_STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as PendingOfflineReport[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return list
      .filter((item) => isOwnedByUser(item, ownerUserId))
      .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  } catch {
    return [];
  }
}

export async function removeOfflineReport(queueId: string): Promise<void> {
  try {
    const db = await openSyncDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(REPORT_STORE_NAME, 'readwrite');
      tx.objectStore(REPORT_STORE_NAME).delete(queueId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    notifyQueueChanged();
  } catch {
    /* ignore */
  }
}

async function recordReportError(item: PendingOfflineReport, message: string): Promise<void> {
  try {
    await putRecord(REPORT_STORE_NAME, {
      ...item,
      attempts: (item.attempts ?? 0) + 1,
      lastError: message,
      lastAttemptAt: new Date().toISOString(),
    });
    notifyQueueChanged();
  } catch {
    /* ignore */
  }
}

export async function retrySingleOfflineReport(
  sb: SupabaseClient,
  item: PendingOfflineReport,
): Promise<{ ok: boolean; error: string | null }> {
  try {
    await syncQueuedReport(sb, item.editingId, item.payload);
    await removeOfflineReport(item.queueId);
    return { ok: true, error: null };
  } catch (err: unknown) {
    const msg = getErrorMessage(err, 'Failed to sync report');
    await recordReportError(item, msg);
    return { ok: false, error: msg };
  }
}

let reportFlush: Promise<{ synced: number; failed: number; errors: OfflineSyncFailure[] }> | null = null;

export function flushOfflineReports(
  sb: SupabaseClient,
  ownerUserId?: string | null,
): Promise<{ synced: number; failed: number; errors: OfflineSyncFailure[] }> {
  if (reportFlush) return reportFlush;
  reportFlush = runReportFlush(sb, ownerUserId).finally(() => {
    reportFlush = null;
  });
  return reportFlush;
}

async function runReportFlush(
  sb: SupabaseClient,
  ownerUserId?: string | null,
): Promise<{ synced: number; failed: number; errors: OfflineSyncFailure[] }> {
  const items = await getOfflineReports(ownerUserId);
  let synced = 0;
  const errors: OfflineSyncFailure[] = [];

  for (const item of items) {
    const res = await retrySingleOfflineReport(sb, item);
    if (res.ok) {
      synced += 1;
    } else if (res.error) {
      errors.push({ queueId: item.queueId, message: res.error });
    }
  }

  return { synced, failed: errors.length, errors };
}

/**
 * Counts all queued offline activities and reports belonging to the specified user
 * (or across the device when ownerUserId is omitted).
 */
export async function countOfflineItems(ownerUserId?: string | null): Promise<number> {
  const [acts, reps] = await Promise.all([getOfflineQueue(ownerUserId), getOfflineReports(ownerUserId)]);
  return acts.length + reps.length;
}

/**
 * Clears queued offline items for the specified user (or all items if ownerUserId is omitted).
 * Called on sign-out so queued logs/photos from one account do not linger on shared devices.
 */
export async function clearOfflineQueues(ownerUserId?: string | null): Promise<void> {
  try {
    const [acts, reps] = await Promise.all([getOfflineQueue(ownerUserId), getOfflineReports(ownerUserId)]);
    if (acts.length === 0 && reps.length === 0) return;
    const db = await openSyncDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, REPORT_STORE_NAME], 'readwrite');
      const actStore = tx.objectStore(STORE_NAME);
      const repStore = tx.objectStore(REPORT_STORE_NAME);
      for (const a of acts) actStore.delete(a.queueId);
      for (const r of reps) repStore.delete(r.queueId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    notifyQueueChanged();
  } catch {
    /* ignore */
  }
}
