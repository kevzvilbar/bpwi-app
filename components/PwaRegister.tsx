'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

// Each warm-up server-renders /mobile, so do not repeat it on every in-app navigation.
const WARM_INTERVAL_MS = 10 * 60 * 1000;
let lastWarmAt = 0;

function warmOfflineLogger(force = false) {
  if (!('serviceWorker' in navigator) || !navigator.onLine) return;
  if (!force && Date.now() - lastWarmAt < WARM_INTERVAL_MS) return;
  lastWarmAt = Date.now();
  navigator.serviceWorker.ready
    .then((registration) => registration.active?.postMessage('CACHE_OFFLINE_PAGE'))
    .catch(() => {});
}

export default function PwaRegister() {
  const pathname = usePathname();
  const [offline, setOffline] = useState(false);
  const [cachedAt, setCachedAt] = useState('');

  useEffect(() => {
    const key = `bpwi-sync-${pathname}`;
    const syncStamp = () => {
      const now = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date());
      localStorage.setItem(key, now);
      localStorage.setItem('bpwi-last-sync', now);
      setCachedAt(now);
    };

    const readStamp = () => localStorage.getItem(key) ?? localStorage.getItem('bpwi-last-sync') ?? '';

    const isOff = !navigator.onLine;
    setOffline(isOff);
    if (!isOff) syncStamp();
    else setCachedAt(readStamp());

    const onOffline = () => {
      setOffline(true);
      setCachedAt(readStamp());
    };
    const onOnline = () => {
      setOffline(false);
      syncStamp();
      if (pathname !== '/login') warmOfflineLogger(true);
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    // Signing in again after /login must save a fresh copy straight away.
    if (pathname === '/login') lastWarmAt = 0;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
      // Keep the offline field logger saved while online. Signed-out requests are redirected and ignored.
      if (pathname !== '/login') warmOfflineLogger();
    }

    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [pathname]);

  if (!offline) return null;
  return (
    <div
      role="status"
      className="no-print"
      style={{
        background: 'var(--warn-bg)',
        color: 'var(--warn-fg)',
        borderBottom: '1px solid var(--warn-border)',
        padding: '6px 14px',
        fontSize: 12.5,
        fontWeight: 600,
        textAlign: 'center',
      }}
    >
      Offline mode — showing cached copy{cachedAt ? ` from ${cachedAt}` : ''}. Field logs, reports, PM updates &amp; handovers queue on this device; approvals, deletes &amp; setup require a connection.
    </div>
  );
}
