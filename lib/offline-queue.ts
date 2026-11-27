import type { SupabaseClient } from '@supabase/supabase-js';
import type { DailyActivityRow } from './activity-types';
import { uploadBlobPhoto, uploadDataUrlPhoto } from './image-compress';
import { getErrorMessage } from './error-utils';
import {
  extractOfflineBlobId,
  isOwnedByUser,
  newClientId,
  syncQueuedActivity,
  syncQueuedJobOrderStatus,
  syncQueuedPmTaskStatus,
  syncQueuedReport,
  syncQueuedShiftHandover,
  type OfflineMutationKind,
  type PhotoUploader,
} from './offline-sync-core';
import {
  deleteOfflinePhotoBlobs,
  DRAFT_STORE_NAME,
  extractBlobIdsFromPhotoUrls,
  FIELD_LAST_USER_KEY,
  getOfflinePhotoBlob,
  MUTATION_STORE_NAME,
  notifyActivitySynced,
  notifyQueueChanged,
  openSyncDb,
  PHOTO_BLOB_STORE,
  putRecord,
  REF_SNAPSHOT_STORE,
  REPORT_STORE_NAME,
  requestPersistentStorage,
  STORE_NAME,
  type ActivityFormDraft,
  type FieldReferenceSnapshot,
  type StoredPhotoBlobRecord,
} from './offline-storage';

export {
  buildActivityDraftKey,
  deleteActivityDraft,
  deleteOfflinePhotoBlobs,
  FIELD_LAST_USER_KEY,
  getOfflinePhotoBlob,
  loadActivityDraft,
  loadFieldReferenceSnapshot,
  saveActivityDraft,
  saveFieldReferenceSnapshot,
  saveOfflinePhotoBlob,
  type ActivityFormDraft,
  type FieldReferenceSnapshot,
  type FieldSnapshotActType,
  type FieldSnapshotArea,
  type FieldSnapshotAssignment,
  type FieldSnapshotOperator,
  type FieldSnapshotShift,
  type FieldSnapshotStandby,
  type FieldSnapshotTask,
  type StoredPhotoBlobRecord,
} from './offline-storage';

export type EnqueueOfflineOptions = {
  editingId?: string | null;
  expectedUpdatedAt?: string | null;
};

export type PendingOfflineActivity = {
  queueId: string;
  queuedAt: string;
  ownerUserId?: string | null;
  attempts?: number;
  lastError?: string | null;
  lastAttemptAt?: string | null;
  editingId?: string | null;
  expectedUpdatedAt?: string | null;
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
  expectedUpdatedAt?: string | null;
  payload: Record<string, unknown>;
};

export type OfflineSyncFailure = {
  queueId: string;
  message: string;
};

export type PendingOfflineMutation = {
  queueId: string;
  kind: OfflineMutationKind;
  targetId: string;
  queuedAt: string;
  ownerUserId?: string | null;
  attempts?: number;
  lastError?: string | null;
  lastAttemptAt?: string | null;
  expectedUpdatedAt?: string | null;
  expectedStatus?: string | null;
  payload: Record<string, unknown>;
};

export async function enqueueOfflineActivity(
  payload: Record<string, unknown>,
  ownerUserId?: string | null,
  opts?: EnqueueOfflineOptions,
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
    expectedUpdatedAt: opts?.expectedUpdatedAt ?? null,
    // Client-generated primary key makes a retried insert sync idempotent (see offline-sync-core.ts)
    payload: nextPayload,
  };
  requestPersistentStorage();
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
    const existing = await new Promise<PendingOfflineActivity | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(queueId);
      req.onsuccess = () => resolve(req.result as PendingOfflineActivity | undefined);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(queueId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    const blobIds = extractBlobIdsFromPhotoUrls(existing?.payload?.photo_urls);
    if (blobIds.length > 0) {
      await deleteOfflinePhotoBlobs(blobIds);
    }
    notifyQueueChanged();
  } catch {
    /* ignore */
  }
}

const uploadQueuedPhoto: PhotoUploader = async (sb, orgId, raw, opts) => {
  const blobId = extractOfflineBlobId(raw);
  if (blobId) {
    const blob = await getOfflinePhotoBlob(blobId);
    if (!blob) {
      throw new Error('Queued photo file is missing from device storage. Remove or re-attach the photo to sync.');
    }
    return uploadBlobPhoto(sb, orgId, blob, opts);
  }
  return uploadDataUrlPhoto(sb, orgId, raw, opts);
};

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
      uploadQueuedPhoto,
      item.editingId ?? null,
      item.expectedUpdatedAt ?? null,
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
  opts?: { expectedUpdatedAt?: string | null },
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
    expectedUpdatedAt: opts?.expectedUpdatedAt ?? null,
    payload: nextPayload,
  };
  requestPersistentStorage();
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
    await syncQueuedReport(sb, item.editingId, item.payload, item.expectedUpdatedAt ?? null);
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

export async function enqueueOfflineMutation(opts: {
  kind: OfflineMutationKind;
  targetId: string;
  payload: Record<string, unknown>;
  ownerUserId?: string | null;
  expectedUpdatedAt?: string | null;
  expectedStatus?: string | null;
}): Promise<PendingOfflineMutation> {
  const item: PendingOfflineMutation = {
    queueId: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: opts.kind,
    targetId: opts.targetId,
    queuedAt: new Date().toISOString(),
    ownerUserId: opts.ownerUserId?.trim() || null,
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
    expectedUpdatedAt: opts.expectedUpdatedAt ?? null,
    expectedStatus: opts.expectedStatus ?? null,
    payload: { ...opts.payload },
  };
  requestPersistentStorage();
  await putRecord(MUTATION_STORE_NAME, item);
  notifyQueueChanged();
  return item;
}

export async function getOfflineMutations(ownerUserId?: string | null): Promise<PendingOfflineMutation[]> {
  try {
    const db = await openSyncDb();
    const list = await new Promise<PendingOfflineMutation[]>((resolve, reject) => {
      const tx = db.transaction(MUTATION_STORE_NAME, 'readonly');
      const req = tx.objectStore(MUTATION_STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as PendingOfflineMutation[]);
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

export async function removeOfflineMutation(queueId: string): Promise<void> {
  try {
    const db = await openSyncDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(MUTATION_STORE_NAME, 'readwrite');
      tx.objectStore(MUTATION_STORE_NAME).delete(queueId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    notifyQueueChanged();
  } catch {
    /* ignore */
  }
}

async function recordMutationError(item: PendingOfflineMutation, message: string): Promise<void> {
  try {
    await putRecord(MUTATION_STORE_NAME, {
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

export async function retrySingleOfflineMutation(
  sb: SupabaseClient,
  item: PendingOfflineMutation,
): Promise<{ ok: boolean; error: string | null }> {
  try {
    if (item.kind === 'pm_task_status') {
      await syncQueuedPmTaskStatus(sb, item.targetId, item.payload, item.expectedStatus ?? null);
    } else if (item.kind === 'shift_handover') {
      await syncQueuedShiftHandover(sb, item.payload);
    } else {
      await syncQueuedJobOrderStatus(sb, item.targetId, item.payload, item.expectedUpdatedAt ?? null);
    }
    await removeOfflineMutation(item.queueId);
    return { ok: true, error: null };
  } catch (err: unknown) {
    const msg = getErrorMessage(err, 'Failed to sync offline change');
    await recordMutationError(item, msg);
    return { ok: false, error: msg };
  }
}

let mutationFlush: Promise<{ synced: number; failed: number; errors: OfflineSyncFailure[] }> | null = null;

export function flushOfflineMutations(
  sb: SupabaseClient,
  ownerUserId?: string | null,
): Promise<{ synced: number; failed: number; errors: OfflineSyncFailure[] }> {
  if (mutationFlush) return mutationFlush;
  mutationFlush = runMutationFlush(sb, ownerUserId).finally(() => {
    mutationFlush = null;
  });
  return mutationFlush;
}

async function runMutationFlush(
  sb: SupabaseClient,
  ownerUserId?: string | null,
): Promise<{ synced: number; failed: number; errors: OfflineSyncFailure[] }> {
  const items = await getOfflineMutations(ownerUserId);
  let synced = 0;
  const errors: OfflineSyncFailure[] = [];

  for (const item of items) {
    const res = await retrySingleOfflineMutation(sb, item);
    if (res.ok) {
      synced += 1;
    } else if (res.error) {
      errors.push({ queueId: item.queueId, message: res.error });
    }
  }

  return { synced, failed: errors.length, errors };
}

/**
 * Counts all queued offline activities, reports, and field mutations belonging to the specified user
 * (or across the device when ownerUserId is omitted).
 */
export async function countOfflineItems(ownerUserId?: string | null): Promise<number> {
  const [acts, reps, muts] = await Promise.all([
    getOfflineQueue(ownerUserId),
    getOfflineReports(ownerUserId),
    getOfflineMutations(ownerUserId),
  ]);
  return acts.length + reps.length + muts.length;
}

/**
 * Clears queued offline items, saved form drafts, reference snapshots, and stored photo blobs for the
 * specified user (or all items if ownerUserId is omitted).
 * Called on sign-out so queued logs/photos from one account do not linger on shared devices.
 */
export async function clearOfflineQueues(ownerUserId?: string | null): Promise<void> {
  try {
    const [acts, reps, muts] = await Promise.all([
      getOfflineQueue(ownerUserId),
      getOfflineReports(ownerUserId),
      getOfflineMutations(ownerUserId),
    ]);
    const db = await openSyncDb();
    const [allBlobs, allDrafts, allSnapshots] = await Promise.all([
      new Promise<StoredPhotoBlobRecord[]>((resolve, reject) => {
        const tx = db.transaction(PHOTO_BLOB_STORE, 'readonly');
        const req = tx.objectStore(PHOTO_BLOB_STORE).getAll();
        req.onsuccess = () => resolve((req.result ?? []) as StoredPhotoBlobRecord[]);
        req.onerror = () => reject(req.error);
      }),
      new Promise<ActivityFormDraft[]>((resolve, reject) => {
        const tx = db.transaction(DRAFT_STORE_NAME, 'readonly');
        const req = tx.objectStore(DRAFT_STORE_NAME).getAll();
        req.onsuccess = () => resolve((req.result ?? []) as ActivityFormDraft[]);
        req.onerror = () => reject(req.error);
      }),
      new Promise<FieldReferenceSnapshot[]>((resolve, reject) => {
        const tx = db.transaction(REF_SNAPSHOT_STORE, 'readonly');
        const req = tx.objectStore(REF_SNAPSHOT_STORE).getAll();
        req.onsuccess = () => resolve((req.result ?? []) as FieldReferenceSnapshot[]);
        req.onerror = () => reject(req.error);
      }),
    ]);

    const cleanOwner = ownerUserId?.trim() || '';
    const blobsToDelete = allBlobs.filter((b) => !cleanOwner || b.ownerUserId === cleanOwner);
    const draftsToDelete = allDrafts.filter((d) => !cleanOwner || d.ownerUserId === cleanOwner);
    const snapshotsToDelete = allSnapshots.filter((s) => !cleanOwner || s.userId === cleanOwner);

    if (typeof window !== 'undefined') {
      try {
        const lastUser = window.localStorage.getItem(FIELD_LAST_USER_KEY)?.trim() ?? '';
        if (!cleanOwner || lastUser === cleanOwner) {
          window.localStorage.removeItem(FIELD_LAST_USER_KEY);
        }
      } catch {
        /* ignore */
      }
    }

    if (
      acts.length === 0 &&
      reps.length === 0 &&
      muts.length === 0 &&
      blobsToDelete.length === 0 &&
      draftsToDelete.length === 0 &&
      snapshotsToDelete.length === 0
    ) {
      db.close();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        [STORE_NAME, REPORT_STORE_NAME, MUTATION_STORE_NAME, PHOTO_BLOB_STORE, DRAFT_STORE_NAME, REF_SNAPSHOT_STORE],
        'readwrite',
      );
      const actStore = tx.objectStore(STORE_NAME);
      const repStore = tx.objectStore(REPORT_STORE_NAME);
      const mutStore = tx.objectStore(MUTATION_STORE_NAME);
      const blobStore = tx.objectStore(PHOTO_BLOB_STORE);
      const draftStore = tx.objectStore(DRAFT_STORE_NAME);
      const snapStore = tx.objectStore(REF_SNAPSHOT_STORE);
      for (const a of acts) actStore.delete(a.queueId);
      for (const r of reps) repStore.delete(r.queueId);
      for (const m of muts) mutStore.delete(m.queueId);
      for (const b of blobsToDelete) blobStore.delete(b.blobId);
      for (const d of draftsToDelete) draftStore.delete(d.draftKey);
      for (const s of snapshotsToDelete) snapStore.delete(s.userId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    notifyQueueChanged();
  } catch {
    /* ignore */
  }
}
