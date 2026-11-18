'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDateOnly, formatManila } from '@/lib/date';

type Grant = { starts_at: string; ends_at: string; date_from: string | null; date_to: string | null; note: string | null };

function rangeText(g: Grant) {
  if (g.date_from && g.date_to) return `${formatDateOnly(g.date_from)} – ${formatDateOnly(g.date_to)}`;
  if (g.date_from) return `from ${formatDateOnly(g.date_from)}`;
  if (g.date_to) return `up to ${formatDateOnly(g.date_to)}`;
  return 'any date';
}

function remaining(ms: number) {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins >= 24 * 60) return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h left`;
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m left`;
  return `${mins}m left`;
}

/**
 * Shown to department heads only. They are read-only unless an admin has opened an edit window.
 * The database enforces the window; this banner explains it and refreshes the page when a window
 * starts or ends so the editing controls appear and disappear on time.
 */
export default function EditAccessBanner(p: { active: Grant | null; next: Grant | null }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const edge = p.active ? Date.parse(p.active.ends_at) : p.next ? Date.parse(p.next.starts_at) : null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (edge !== null) {
      const wait = Math.min(Math.max(edge - Date.now(), 0) + 500, 2_000_000_000);
      timer = setTimeout(() => router.refresh(), wait);
    }
    return () => {
      clearInterval(tick);
      if (timer) clearTimeout(timer);
    };
  }, [p.active, p.next, router]);

  const open = p.active !== null;
  return (
    <div
      role="status"
      className="no-print"
      style={{
        background: open ? 'var(--ok-bg)' : 'var(--info-bg)',
        color: open ? 'var(--ok-fg)' : 'var(--info-fg)',
        borderBottom: '1px solid var(--border)',
        padding: '6px 14px',
        fontSize: 12.5,
        fontWeight: 600,
      }}
    >
      {p.active ? (
        <>
          Edit window open until {formatManila(p.active.ends_at)} ({remaining(Date.parse(p.active.ends_at) - now)}) · Dates: {rangeText(p.active)}
          {p.active.note ? ` · ${p.active.note}` : ''}
        </>
      ) : (
        <>
          Read-only. Department heads can edit during a window granted by an admin.
          {p.next ? ` Next window: ${formatManila(p.next.starts_at)} – ${formatManila(p.next.ends_at)} (${rangeText(p.next)}).` : ''}
        </>
      )}
    </div>
  );
}
