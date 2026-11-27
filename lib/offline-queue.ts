import type { SupabaseClient } from '@supabase/supabase-js';
import type { DailyActivityRow } from './activity-types';
import type { ActivityDetailFieldsState } from './activity-logger-details';
import type { GpsSource } from './gps-accuracy';
import { uploadBlobPhoto, uploadDataUrlPhoto } from './image-compress';
import { getErrorMessage } from './error-utils';
import {
  extractOfflineBlobId,
  isOwnedByUser,
  newClientId,
  OFFLINE_BLOB_PREFIX,
  syncQueuedActivity,
  syncQueuedJobOrderStatus,
  syncQueuedPmTaskStatus,
  syncQueuedReport,
  syncQueuedShiftHandover,
  type OfflineMutationKind,
  type PhotoUploader,
} from './offline-sync-core';

const DB_NAME = 'bpwi-field-sync-db';
const DB_VERSION = 5;
const STORE_NAME = 'pending_activities';
const REPORT_STORE_NAME = 'pending_reports';
const PHOTO_BLOB_STORE = 'photo_blobs';
const DRAFT_STORE_NAME = 'activity_drafts';
const REF_SNAPSHOT_STORE = 'reference_snapshots';
const MUTATION_STORE_NAME = 'pending_mutations';
const DEFAULT_DRAFT_TTL_MS = 48 * 60 * 60 * 1000;
export const FIELD_LAST_USER_KEY = 'bpwi-field-last-user';

export interface FieldSnapshotOperator {
  id: string;
  full_name: string;
  position: string | null;
  phone_number: string | null;
  default_station: string | null;
}

export interface FieldSnapshotShift {
  id: string;
  code: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  background_color: string;
  text_color: string;
  is_off: boolean;
}

export interface FieldSnapshotArea {
  id: string;
  code: string;
  name: string | null;
  category: string;
  sub_sites?: string[];
}

export interface FieldSnapshotAssignment {
  operator_id: string;
  shift_type_id: string | null;
  area_code_id: string | null;
}

export interface FieldSnapshotStandby {
  operator_id: string;
  standby_type: string;
}

export interface FieldSnapshotTask {
  id: string;
  activity_type: string;
  title: string;
  locations: string[];
  asset: string | null;
  assigned_operator_ids: string[];
  completed_by_operator_ids?: string[];
  scheduled_date: string;
  status: 'planned' | 'done' | 'postponed';
  completed_at: string | null;
  remarks: string | null;
}

export interface FieldSnapshotActType {
  code: string;
  label: string;
  short_label: string;
  color: string;
}

export interface FieldReferenceSnapshot {
  userId: string;
  orgId: string;
  role: string;
  operatorId: string | null;
  canClosePm: boolean;
  canLogActivity: boolean;
  canLogSampleActivity: boolean;
  canVerifyActivity: boolean;
  savedAt: string;
  snapshotDate: string;
  operators: FieldSnapshotOperator[];
  shifts: FieldSnapshotShift[];
  areas: FieldSnapshotArea[];
  assignments: FieldSnapshotAssignment[];
  yesterdayAssignments: FieldSnapshotAssignment[];
  standby: FieldSnapshotStandby[];
  tasks: FieldSnapshotTask[];
  activityTypes: FieldSnapshotActType[];
  recentActivities: DailyActivityRow[];
}

export interface StoredPhotoBlobRecord {
  blobId: string;
  ownerUserId: string | null;
  blob: Blob;
  mimeType: string;
  createdAt: string;
}

export interface ActivityFormDraft {
  draftKey: string;
  ownerUserId: string;
  savedAt: string;
  newLogId: string | null;
  activityType: string;
  leadOpId: string;
  crewOpIds: string[];
  shiftTypeId: string;
  areaCodeId: string;
  siteOrWell: string;
  blockLot: string;
  startedHHMM: string;
  completedHHMM: string;
  notes: string;
  gpsLat: number | null;
  gpsLng: number | null;
  gpsAccuracyM: number | null;
  gpsSource: GpsSource | null;
  photos: Array<{ url: string; storagePath: string | null }>;
  details: ActivityDetailFieldsState;
  joTatJustification: string;
  isSample: boolean;
}

export function buildActivityDraftKey(opts: {
  userId: string;
  editingId?: string | null;
  linkedPmTaskId?: string | null;
  linkedJobOrderId?: string | null;
}): string {
  const scope = opts.editingId?.trim()
    ? `edit:${opts.editingId.trim()}`
    : opts.linkedPmTaskId?.trim()
      ? `pm:${opts.linkedPmTaskId.trim()}`
      : opts.linkedJobOrderId?.trim()
        ? `jo:${opts.linkedJobOrderId.trim()}`
        : 'new';
  return `act-draft:${opts.userId.trim() || 'anon'}:${scope}`;
}

let persistentStorageRequested = false;

function requestPersistentStorage(): void {
  if (persistentStorageRequested || typeof navigator === 'undefined') return;
  persistentStorageRequested = true;
  navigator.storage?.persist?.().catch(() => {});
}

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
      if (!db.objectStoreNames.contains(PHOTO_BLOB_STORE)) {
        db.createObjectStore(PHOTO_BLOB_STORE, { keyPath: 'blobId' });
      }
      if (!db.objectStoreNames.contains(DRAFT_STORE_NAME)) {
        db.createObjectStore(DRAFT_STORE_NAME, { keyPath: 'draftKey' });
      }
      if (!db.objectStoreNames.contains(REF_SNAPSHOT_STORE)) {
        db.createObjectStore(REF_SNAPSHOT_STORE, { keyPath: 'userId' });
      }
      if (!db.objectStoreNames.contains(MUTATION_STORE_NAME)) {
        db.createObjectStore(MUTATION_STORE_NAME, { keyPath: 'queueId' });
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

function extractBlobIdsFromPhotoUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  return urls
    .filter((u): u is string => typeof u === 'string')
    .map(extractOfflineBlobId)
    .filter((id): id is string => Boolean(id));
}

/** Stores a compressed image Blob natively in IndexedDB and returns its `offline-blob://<id>` reference. */
export async function saveOfflinePhotoBlob(blob: Blob, ownerUserId?: string | null): Promise<string | null> {
  try {
    requestPersistentStorage();
    const blobId = newClientId();
    const record: StoredPhotoBlobRecord = {
      blobId,
      ownerUserId: ownerUserId?.trim() || null,
      blob,
      mimeType: blob.type || 'image/jpeg',
      createdAt: new Date().toISOString(),
    };
    await putRecord(PHOTO_BLOB_STORE, record);
    return `${OFFLINE_BLOB_PREFIX}${blobId}`;
  } catch {
    return null;
  }
}

/** Retrieves a locally stored photo Blob from IndexedDB, or `null` if unavailable/missing. */
export async function getOfflinePhotoBlob(blobId: string): Promise<Blob | null> {
  try {
    const db = await openSyncDb();
    const rec = await new Promise<StoredPhotoBlobRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(PHOTO_BLOB_STORE, 'readonly');
      const req = tx.objectStore(PHOTO_BLOB_STORE).get(blobId);
      req.onsuccess = () => resolve(req.result as StoredPhotoBlobRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rec?.blob ?? null;
  } catch {
    return null;
  }
}

/** Deletes stored photo Blobs from IndexedDB after upload completion or explicit discard. */
export async function deleteOfflinePhotoBlobs(blobIds: string[]): Promise<void> {
  const unique = [...new Set(blobIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return;
  try {
    const db = await openSyncDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PHOTO_BLOB_STORE, 'readwrite');
      const store = tx.objectStore(PHOTO_BLOB_STORE);
      for (const id of unique) store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* ignore */
  }
}

export async function saveActivityDraft(draft: ActivityFormDraft): Promise<boolean> {
  try {
    requestPersistentStorage();
    await putRecord(DRAFT_STORE_NAME, draft);
    return true;
  } catch {
    return false;
  }
}

export async function loadActivityDraft(
  draftKey: string,
  ownerUserId: string,
  maxAgeMs = DEFAULT_DRAFT_TTL_MS,
): Promise<ActivityFormDraft | null> {
  if (!draftKey || !ownerUserId.trim()) return null;
  try {
    const db = await openSyncDb();
    const rec = await new Promise<ActivityFormDraft | undefined>((resolve, reject) => {
      const tx = db.transaction(DRAFT_STORE_NAME, 'readonly');
      const req = tx.objectStore(DRAFT_STORE_NAME).get(draftKey);
      req.onsuccess = () => resolve(req.result as ActivityFormDraft | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!rec || rec.ownerUserId !== ownerUserId) return null;
    const savedMs = Date.parse(rec.savedAt);
    if (Number.isFinite(savedMs) && Date.now() - savedMs > maxAgeMs) {
      await deleteActivityDraft(draftKey);
      await deleteOfflinePhotoBlobs(extractBlobIdsFromPhotoUrls(rec.photos?.map((ph) => ph.url)));
      return null;
    }
    return rec;
  } catch {
    return null;
  }
}

export async function deleteActivityDraft(draftKey: string): Promise<void> {
  if (!draftKey) return;
  try {
    const db = await openSyncDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DRAFT_STORE_NAME, 'readwrite');
      tx.objectStore(DRAFT_STORE_NAME).delete(draftKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* ignore */
  }
}

function redactSnapshotPhoneNumbers(snapshot: FieldReferenceSnapshot): FieldReferenceSnapshot {
  return {
    ...snapshot,
    operators: Array.isArray(snapshot.operators)
      ? snapshot.operators.map((op) => ({ ...op, phone_number: null }))
      : [],
  };
}

/** Saves per-user field reference data (roster, tasks, areas, recent activities) in IndexedDB without phone numbers. */
export async function saveFieldReferenceSnapshot(snapshot: FieldReferenceSnapshot): Promise<boolean> {
  const userId = snapshot.userId.trim();
  if (!userId || !snapshot.orgId.trim()) return false;
  try {
    requestPersistentStorage();
    await putRecord(REF_SNAPSHOT_STORE, redactSnapshotPhoneNumbers({ ...snapshot, userId }));
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(FIELD_LAST_USER_KEY, userId);
      } catch {
        /* ignore storage quota or private mode restrictions */
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Loads cached per-user field reference data, resolving the active user or last signed-in device user. */
export async function loadFieldReferenceSnapshot(userId?: string | null): Promise<FieldReferenceSnapshot | null> {
  let targetUser = userId?.trim() || '';
  if (!targetUser && typeof window !== 'undefined') {
    try {
      targetUser = window.localStorage.getItem(FIELD_LAST_USER_KEY)?.trim() ?? '';
    } catch {
      targetUser = '';
    }
  }
  if (!targetUser) return null;
  try {
    const db = await openSyncDb();
    const rec = await new Promise<FieldReferenceSnapshot | undefined>((resolve, reject) => {
      const tx = db.transaction(REF_SNAPSHOT_STORE, 'readonly');
      const req = tx.objectStore(REF_SNAPSHOT_STORE).get(targetUser);
      req.onsuccess = () => resolve(req.result as FieldReferenceSnapshot | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rec ? redactSnapshotPhoneNumbers(rec) : null;
  } catch {
    return null;
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
