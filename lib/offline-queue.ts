import type { SupabaseClient } from '@supabase/supabase-js';
import type { DailyActivityRow } from './activity-types';

const DB_NAME = 'bpwi-field-sync-db';
const DB_VERSION = 1;
const STORE_NAME = 'pending_activities';

export type PendingOfflineActivity = {
  queueId: string;
  queuedAt: string;
  payload: Record<string, any>;
};

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
      const { data, error } = await sb
        .from('daily_activities')
        .insert(item.payload)
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
