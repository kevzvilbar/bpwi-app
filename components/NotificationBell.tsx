'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  is_read: boolean;
  created_at: string;
}

export default function NotificationBell({ hasUser }: { hasUser: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const loadNotifications = useCallback(async () => {
    if (!hasUser) return;
    setLoading(true);
    const sb = supabaseBrowser();
    const { data, error } = await sb
      .from('notifications')
      .select('id, kind, title, body, href, is_read, created_at')
      .order('created_at', { ascending: false })
      .limit(20);
    setLoading(false);
    if (!error && data) {
      setItems(data as NotificationRow[]);
    }
  }, [hasUser]);

  useEffect(() => {
    void loadNotifications();
    const onFocus = () => void loadNotifications();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadNotifications]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!hasUser) return null;

  const unreadCount = items.filter((n) => !n.is_read).length;

  async function markRead(n: NotificationRow) {
    if (!n.is_read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      await supabaseBrowser().from('notifications').update({ is_read: true }).eq('id', n.id);
    }
    setOpen(false);
    if (n.href) router.push(n.href);
  }

  async function markAllRead() {
    const unreadIds = items.filter((n) => !n.is_read).map((n) => n.id);
    if (!unreadIds.length) return;
    setItems((prev) => prev.map((x) => ({ ...x, is_read: true })));
    await supabaseBrowser().from('notifications').update({ is_read: true }).in('id', unreadIds);
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void loadNotifications();
        }}
        aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ''}`}
        title="Notifications"
        style={{ position: 'relative', padding: '6px 9px' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              background: '#dc2626',
              color: '#ffffff',
              borderRadius: 999,
              padding: '0 5px',
              fontSize: 10,
              fontWeight: 800,
              lineHeight: 1.4,
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 6px)',
            width: 310,
            maxWidth: '90vw',
            maxHeight: 380,
            overflowY: 'auto',
            zIndex: 60,
            padding: 10,
            boxShadow: '0 10px 25px rgba(15,23,42,0.2)',
            display: 'grid',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-light)', paddingBottom: 6 }}>
            <strong style={{ fontSize: 13 }}>Notifications</strong>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                style={{ border: 'none', background: 'transparent', color: 'var(--primary)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
              >
                Mark all read
              </button>
            )}
          </div>

          {loading && items.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: 10, textAlign: 'center' }}>
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: 12, textAlign: 'center' }}>
              No notifications yet.
            </div>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => void markRead(n)}
                style={{
                  textAlign: 'left',
                  padding: '8px 9px',
                  borderRadius: 6,
                  border: '1px solid var(--border-light)',
                  background: n.is_read ? 'var(--surface)' : 'rgba(2,132,199,0.08)',
                  cursor: 'pointer',
                  display: 'grid',
                  gap: 2,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: n.is_read ? 600 : 800, color: 'var(--text)' }}>
                    {n.title}
                  </span>
                  {!n.is_read && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#0284c7', flexShrink: 0 }} />}
                </div>
                {n.body && (
                  <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.3 }}>
                    {n.body}
                  </span>
                )}
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {new Date(n.created_at).toLocaleString('en-PH', {
                    timeZone: 'Asia/Manila',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
