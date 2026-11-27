import type { DailyActivityRow } from './activity-types';
import type { ActivityDetailFieldsState } from './activity-logger-details';
import type { GpsSource } from './gps-accuracy';
import { extractOfflineBlobId, newClientId, OFFLINE_BLOB_PREFIX } from './offline-sync-core';

export const DB_NAME = 'bpwi-field-sync-db';
export const DB_VERSION = 5;
export const STORE_NAME = 'pending_activities';
export const REPORT_STORE_NAME = 'pending_reports';
export const PHOTO_BLOB_STORE = 'photo_blobs';
export const DRAFT_STORE_NAME = 'activity_drafts';
export const REF_SNAPSHOT_STORE = 'reference_snapshots';
export const MUTATION_STORE_NAME = 'pending_mutations';
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

export function requestPersistentStorage(): void {
  if (persistentStorageRequested || typeof navigator === 'undefined') return;
  persistentStorageRequested = true;
  navigator.storage?.persist?.().catch(() => {});
}

export function notifyQueueChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('bpwi-offline-queue-changed'));
  }
}

export function notifyActivitySynced(rows: DailyActivityRow[]) {
  if (typeof window !== 'undefined' && rows.length > 0) {
    window.dispatchEvent(new CustomEvent('bpwi-offline-activity-synced', { detail: { rows } }));
  }
}

export function openSyncDb(): Promise<IDBDatabase> {
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

export async function putRecord<T>(storeName: string, value: T): Promise<void> {
  const db = await openSyncDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`Failed to write to ${storeName}`));
  });
  db.close();
}

export function extractBlobIdsFromPhotoUrls(urls: unknown): string[] {
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
