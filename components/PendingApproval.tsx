'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { clearOfflineQueues, countOfflineItems } from '@/lib/offline-queue';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui';

export default function PendingApproval({
  pending,
  userId,
  userName,
  userEmail,
  children,
}: {
  pending: boolean;
  userId: string;
  userName: string;
  userEmail: string;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const [confirmDiscardCount, setConfirmDiscardCount] = useState(0);
  const [signingOut, setSigningOut] = useState(false);

  if (!pending || path.startsWith('/login')) {
    return <>{children}</>;
  }

  async function executeSignOut() {
    setSigningOut(true);
    try {
      if (userId) {
        await clearOfflineQueues(userId);
      }
      await supabaseBrowser().auth.signOut();
      localStorage.removeItem('bpwi-last-sync');
      navigator.serviceWorker?.controller?.postMessage('CLEAR_CACHE');
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      window.location.href = '/login';
    } catch {
      setSigningOut(false);
    }
  }

  async function handleSignOutClick() {
    if (userId) {
      const queued = await countOfflineItems(userId);
      if (queued > 0) {
        setConfirmDiscardCount(queued);
        return;
      }
    }
    await executeSignOut();
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
        <div>
          <Badge tone="warn">Pending Approval</Badge>
        </div>
        <h1 className="page-title" style={{ fontSize: 19 }}>Account waiting for administrator approval</h1>
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
          <button type="button" className="btn" disabled={signingOut} onClick={() => void handleSignOutClick()}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDiscardCount > 0}
        title="Discard unsent offline work?"
        description={`You still have ${confirmDiscardCount} unsent offline item${confirmDiscardCount === 1 ? '' : 's'} saved for this account. Signing out will permanently delete your queued logs on this device.`}
        confirmLabel={signingOut ? 'Signing out…' : 'Sign out & discard'}
        tone="danger"
        busy={signingOut}
        onCancel={() => setConfirmDiscardCount(0)}
        onConfirm={() => void executeSignOut()}
      />
    </div>
  );
}
