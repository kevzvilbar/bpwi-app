'use client';

import { useEffect, useState } from 'react';

export default function PwaRegister() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setOffline(!navigator.onLine);
    const onOffline = () => setOffline(true);
    const onOnline = () => setOffline(false);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  if (!offline) return null;
  return (
    <div
      role="status"
      className="no-print"
      style={{
        background: '#fef3c7',
        color: '#92400e',
        borderBottom: '1px solid #fde68a',
        padding: '6px 14px',
        fontSize: 12.5,
        fontWeight: 600,
        textAlign: 'center',
      }}
    >
      Offline mode — showing cached schedule data. Changes will require a connection.
    </div>
  );
}
