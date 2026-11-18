'use client';

import { usePathname } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function PendingApproval({
  pending,
  userName,
  userEmail,
  children,
}: {
  pending: boolean;
  userName: string;
  userEmail: string;
  children: React.ReactNode;
}) {
  const path = usePathname();
  if (!pending || path.startsWith('/login')) {
    return <>{children}</>;
  }

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    localStorage.removeItem('bpwi-last-sync');
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    window.location.href = '/login';
  }

  return (
    <div style={{ minHeight: '72vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div
        className="card"
        role="status"
        style={{
          maxWidth: 460,
          width: '100%',
          padding: 24,
          display: 'grid',
          gap: 12,
          border: '1px solid var(--warn-border)',
        }}
      >
        <div
          style={{
            display: 'inline-block',
            width: 'fit-content',
            padding: '3px 10px',
            borderRadius: 999,
            background: 'var(--warn-bg)',
            color: 'var(--warn-fg)',
            fontSize: 11.5,
            fontWeight: 700,
            textTransform: 'uppercase',
          }}
        >
          Pending Approval
        </div>
        <h1 style={{ margin: 0, fontSize: 19, color: 'var(--text)' }}>Account waiting for administrator approval</h1>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Hi <b>{userName || userEmail || 'there'}</b>
          {userEmail && userName ? ` (${userEmail})` : ''}, your account has been created but has not been activated yet.
        </p>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Please ask a BP Waterworks administrator to open <b>Menu → Operators, Users &amp; Setup → Users &amp; roles</b> to link your operator profile and approve your account.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Check Approval Status
          </button>
          <button type="button" className="btn" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
