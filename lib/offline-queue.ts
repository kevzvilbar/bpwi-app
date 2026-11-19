import type { SupabaseClient } from '@supabase/supabase-js';
import type { DailyActivityRow } from './activity-types';
import { uploadDataUrlPhoto } from './image-compress';

const DB_NAME = 'bpwi-field-sync-db';
const DB_VERSION = 2;
const STORE_NAME = 'pending_activities';
const REPORT_STORE_NAME = 'pending_reports';

export type PendingOfflineActivity = {
  queueId: string;
  queuedAt: string;
  payload: Record<string, any>;
};

export type PendingOfflineReport = {
  queueId: string;
  queuedAt: string;
  editingId: string | null;
  payload: Record<string, any>;
};

function notifyQueueChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('bpwi-offline-queue-changed'));
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

export async function enqueueOfflineActivity(payload: Record<string, any>): Promise<PendingOfflineActivity> {
  const item: PendingOfflineActivity = {
    queueId: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    queuedAt: new Date().toISOString(),
    payload,
  };
  const db = await openSyncDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to write offline item'));
  });
  db.close();
  notifyQueueChanged();
  return item;
}

export async function getOfflineQueue(): Promise<PendingOfflineActivity[]> {
  try {
    const db = await openSyncDb();
    const list = await new Promise<PendingOfflineActivity[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as PendingOfflineActivity[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return list.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
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

export async function flushOfflineQueue(sb: SupabaseClient): Promise<{
  synced: DailyActivityRow[];
  failed: number;
}> {
  const items = await getOfflineQueue();
  const synced: DailyActivityRow[] = [];
  let failed = 0;

  for (const item of items) {
    try {
      const payloadToInsert = { ...item.payload };
      if (
        Array.isArray(payloadToInsert.photo_urls) &&
        payloadToInsert.photo_urls.length > 0 &&
        payloadToInsert.organization_id
      ) {
        const uploadedUrls: string[] = [];
        const uploadedPaths: string[] = Array.isArray(payloadToInsert.photo_storage_paths)
          ? [...payloadToInsert.photo_storage_paths]
          : [];
        for (const rawUrl of payloadToInsert.photo_urls) {
          if (typeof rawUrl === 'string' && rawUrl.startsWith('data:image/')) {
            const up = await uploadDataUrlPhoto(sb, payloadToInsert.organization_id, rawUrl);
            uploadedUrls.push(up.url);
            if (up.storagePath) uploadedPaths.push(up.storagePath);
          } else if (typeof rawUrl === 'string') {
            uploadedUrls.push(rawUrl);
          }
        }
        payloadToInsert.photo_urls = uploadedUrls;
        payloadToInsert.photo_storage_paths = uploadedPaths;
      }

      const { data, error } = await sb
        .from('daily_activities')
        .insert(payloadToInsert)
        .select('*')
        .single();
      if (error || !data) {
        failed += 1;
        continue;
      }

      if (item.payload.pm_task_id) {
        await sb
          .from('pm_tasks')
          .update({
            status: 'done',
            completed_at: item.payload.activity_date,
            remarks: item.payload.notes || `Synced from offline activity (${item.payload.activity_type})`,
          })
          .eq('id', item.payload.pm_task_id);
      }

      if (item.payload.job_order_id) {
        await sb
          .from('job_orders')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('id', item.payload.job_order_id);
      }

      await removeOfflineItem(item.queueId);
      synced.push(data as DailyActivityRow);
    } catch {
      failed += 1;
    }
  }

  return { synced, failed };
}

export async function enqueueOfflineReport(
  editingId: string | null,
  payload: Record<string, any>,
): Promise<PendingOfflineReport> {
  const item: PendingOfflineReport = {
    queueId: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    queuedAt: new Date().toISOString(),
    editingId,
    payload,
  };
  const db = await openSyncDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(REPORT_STORE_NAME, 'readwrite');
    tx.objectStore(REPORT_STORE_NAME).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to write offline report'));
  });
  db.close();
  notifyQueueChanged();
  return item;
}

export async function getOfflineReports(): Promise<PendingOfflineReport[]> {
  try {
    const db = await openSyncDb();
    const list = await new Promise<PendingOfflineReport[]>((resolve, reject) => {
      const tx = db.transaction(REPORT_STORE_NAME, 'readonly');
      const req = tx.objectStore(REPORT_STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as PendingOfflineReport[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return list.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
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

export async function flushOfflineReports(sb: SupabaseClient): Promise<{ synced: number; failed: number }> {
  const items = await getOfflineReports();
  let synced = 0;
  let failed = 0;

  for (const item of items) {
    try {
      const res = item.editingId
        ? await sb.from('accomplishment_reports').update(item.payload).eq('id', item.editingId).select('id').single()
        : await sb.from('accomplishment_reports').insert(item.payload).select('id').single();
      if (res.error || !res.data) {
        failed += 1;
        continue;
      }
      await removeOfflineReport(item.queueId);
      synced += 1;
    } catch {
      failed += 1;
    }
  }

  return { synced, failed };
}
