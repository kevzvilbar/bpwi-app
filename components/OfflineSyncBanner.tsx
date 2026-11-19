'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import {
  flushOfflineQueue,
  flushOfflineReports,
  getOfflineQueue,
  getOfflineReports,
} from '@/lib/offline-queue';

export default function OfflineSyncBanner() {
  const [online, setOnline] = useState<boolean>(true);
  const [actCount, setActCount] = useState<number>(0);
  const [repCount, setRepCount] = useState<number>(0);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [statusNote, setStatusNote] = useState<string>('');

  const refreshCounts = useCallback(async () => {
    const [acts, reps] = await Promise.all([getOfflineQueue(), getOfflineReports()]);
    setActCount(acts.length);
    setRepCount(reps.length);
  }, []);

  const syncAll = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    setSyncing(true);
    setStatusNote('');
    const sb = supabaseBrowser();
    const [actRes, repRes] = await Promise.all([flushOfflineQueue(sb), flushOfflineReports(sb)]);
    await refreshCounts();
    setSyncing(false);
    const totalSynced = actRes.synced.length + repRes.synced;
    if (totalSynced > 0) {
      setStatusNote(`Synced ${totalSynced} queued item${totalSynced === 1 ? '' : 's'}.`);
      setTimeout(() => setStatusNote(''), 4000);
    }
  }, [refreshCounts]);

  useEffect(() => {
    setOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    void refreshCounts();

    const onOnline = () => {
      setOnline(true);
      void syncAll();
    };
    const onOffline = () => setOnline(false);
    const onQueueChanged = () => void refreshCounts();

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('bpwi-offline-queue-changed', onQueueChanged);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('bpwi-offline-queue-changed', onQueueChanged);
    };
  }, [refreshCounts, syncAll]);

  const totalQueued = actCount + repCount;
  if (online && totalQueued === 0 && !statusNote) return null;

  return (
    <div
      className="no-print"
      role="status"
      style={{
        background: !online ? '#fef3c7' : totalQueued > 0 ? '#e0f2fe' : '#dcfce7',
        color: !online ? '#92400e' : totalQueued > 0 ? '#075985' : '#166534',
        borderBottom: '1px solid rgba(15,23,42,0.1)',
        padding: '6px 14px',
        fontSize: 12.5,
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
            <strong>Offline Mode:</strong> No internet signal. Field logs &amp; reports will queue on this device
            {totalQueued > 0 ? ` (${totalQueued} waiting)` : ''}.
          </>
        ) : totalQueued > 0 ? (
          <>
            <strong>{totalQueued} queued offline</strong>
            {actCount > 0 ? ` · ${actCount} activit${actCount === 1 ? 'y' : 'ies'}` : ''}
            {repCount > 0 ? ` · ${repCount} report${repCount === 1 ? '' : 's'}` : ''} ready to sync.
          </>
        ) : (
          <strong>{statusNote}</strong>
        )}
      </span>

      {online && totalQueued > 0 && (
        <button
          type="button"
          className="btn btn-primary"
          disabled={syncing}
          style={{ padding: '3px 10px', fontSize: 12 }}
          onClick={() => void syncAll()}
        >
          {syncing ? 'Syncing…' : `Sync Now (${totalQueued})`}
        </button>
      )}
    </div>
  );
}
