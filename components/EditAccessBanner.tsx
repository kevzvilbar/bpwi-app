'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDateOnly, formatManila } from '@/lib/date';
import { supabaseBrowser } from '@/lib/supabase/client';
import { subscribeVisibilityAwareChannel } from '@/lib/supabase/realtime';

type Grant = { starts_at: string; ends_at: string; date_from: string | null; date_to: string | null; note: string | null };

function grantSignature(g: Grant | null | undefined): string {
  return g ? `${g.starts_at}|${g.ends_at}|${g.date_from ?? ''}|${g.date_to ?? ''}` : 'none';
}

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
export default function EditAccessBanner(p: { active: Grant | null; next: Grant | null; userId?: string }) {
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

    const activeSig = grantSignature(p.active);
    const checkGrantFreshness = async () => {
      if (!p.userId) return;
      const nowIso = new Date().toISOString();
      const { data } = await supabaseBrowser()
        .from('edit_grants')
        .select('starts_at, ends_at, date_from, date_to, note')
        .eq('user_id', p.userId)
        .is('revoked_at', null)
        .lte('starts_at', nowIso)
        .gt('ends_at', nowIso)
        .order('ends_at', { ascending: false })
        .limit(1);
      const live = ((data ?? [])[0] as Grant | undefined) ?? null;
      if (grantSignature(live) !== activeSig) {
        router.refresh();
      }
    };

    const onVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') void checkGrantFreshness();
    };
    window.addEventListener('focus', onVisibilityOrFocus);
    document.addEventListener('visibilitychange', onVisibilityOrFocus);

    const unsubscribeRealtime = p.userId
      ? subscribeVisibilityAwareChannel({
          sb: supabaseBrowser(),
          channelName: `edit-grants-${p.userId}`,
          listeners: [{ table: 'edit_grants', onEvent: () => router.refresh() }],
        })
      : undefined;

    return () => {
      clearInterval(tick);
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', onVisibilityOrFocus);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
      unsubscribeRealtime?.();
    };
  }, [p.active, p.next, p.userId, router]);

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <div>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--ok-fg)', marginRight: 6 }} />
            Edit window open until {formatManila(p.active.ends_at)} ({remaining(Date.parse(p.active.ends_at) - now)}) · Dates: {rangeText(p.active)}
            {p.active.note ? ` · ${p.active.note}` : ''} · Changes save directly.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <div>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--status-pending)', marginRight: 6 }} />
            <strong>Propose mode:</strong> Outside an edit window, changes queue as pending requests for admin review.
            {p.next ? ` Next window: ${formatManila(p.next.starts_at)} – ${formatManila(p.next.ends_at)} (${rangeText(p.next)}).` : ''}
          </div>
          <a
            href="/requests"
            style={{
              color: 'inherit',
              textDecoration: 'underline',
              fontWeight: 700,
              fontSize: 12,
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: 36,
            }}
          >
            View Change Requests →
          </a>
        </div>
      )}
    </div>
  );
}
