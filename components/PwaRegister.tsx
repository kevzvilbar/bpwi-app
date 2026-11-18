'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

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
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
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
      Offline mode — showing cached copy{cachedAt ? ` from ${cachedAt}` : ''}. Changes require a connection.
    </div>
  );
}
