'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

function Icon({ name }: { name: 'schedule' | 'tasks' | 'pm' | 'standby' | 'reports' | 'menu' | 'close' | 'sun' | 'moon' }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (name) {
    case 'schedule':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    case 'tasks':
      return (
        <svg {...common}>
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      );
    case 'pm':
      return (
        <svg {...common}>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      );
    case 'standby':
      return (
        <svg {...common}>
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      );
    case 'reports':
      return (
        <svg {...common}>
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      );
    case 'menu':
      return (
        <svg {...common}>
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      );
    case 'close':
      return (
        <svg {...common}>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      );
    case 'sun':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      );
    case 'moon':
      return (
        <svg {...common}>
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      );
  }
}

export default function Nav(p: {
  role: string;
  userName: string;
  orgId: string;
  orgName: string;
  appTitle: string;
  canEdit: boolean;
  isAdmin: boolean;
  pendingUsersCount?: number;
}) {
  const path = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [appTitle, setAppTitle] = useState(p.appTitle);
  const [orgName, setOrgName] = useState(p.orgName);
  const [editingTitle, setEditingTitle] = useState(false);
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleErr, setTitleErr] = useState('');
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setAppTitle(p.appTitle);
    setOrgName(p.orgName);
  }, [p.appTitle, p.orgName]);

  useEffect(() => {
    document.title = `${orgName} · ${appTitle}`;
  }, [appTitle, orgName]);

  useEffect(() => {
    const savedTheme = localStorage.getItem('bpwi-theme');
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const isDark = savedTheme ? savedTheme === 'dark' : prefersDark;
    const isHc = localStorage.getItem('bpwi-hc') === '1';
    setDark(isDark);
    setHighContrast(isHc);
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    document.documentElement.dataset.contrast = isHc ? 'high' : 'normal';
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [path]);

  useEffect(() => {
    if (!drawerOpen) return;
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawerOpen(false);
        menuBtnRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  if (path.startsWith('/login')) return null;

  function toggleDark() {
    const next = !dark;
    setDark(next);
    localStorage.setItem('bpwi-theme', next ? 'dark' : 'light');
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
  }

  function toggleContrast() {
    const next = !highContrast;
    setHighContrast(next);
    localStorage.setItem('bpwi-hc', next ? '1' : '0');
    document.documentElement.dataset.contrast = next ? 'high' : 'normal';
  }

  const primaryLinks = [
    { href: '/', label: 'Schedule', icon: 'schedule' as const },
    { href: '/mobile', label: 'Tasks', icon: 'tasks' as const },
    { href: '/pm', label: 'PM Plan', icon: 'pm' as const },
    { href: '/call-sheet', label: 'Standby', icon: 'standby' as const },
    { href: '/leave', label: 'Reports', icon: 'reports' as const },
  ];

  async function saveBranding(e: React.FormEvent) {
    e.preventDefault();
    if (!p.orgId) return;
    setSavingTitle(true);
    setTitleErr('');
    const nextTitle = appTitle.trim() || 'Operations & Plant Schedule';
    const nextOrg = orgName.trim() || 'BP Waterworks, Inc.';
    const { error } = await supabaseBrowser()
      .from('organizations')
      .update({ app_title: nextTitle, name: nextOrg })
      .eq('id', p.orgId);
    setSavingTitle(false);
    if (error) {
      setTitleErr('Could not save title. Run 005_org_title.sql if not applied yet.');
      return;
    }
    setAppTitle(nextTitle);
    setOrgName(nextOrg);
    setEditingTitle(false);
  }

  return (
    <>
      <header className="app-topbar no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img
            src="/bpwi-logo.svg"
            alt="BP Waterworks, Inc."
            style={{
              width: 42,
              height: 32,
              objectFit: 'contain',
              flexShrink: 0,
            }}
          />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.2 }}>{appTitle}</span>
              {p.isAdmin && p.orgId && (
                <button
                  type="button"
                  onClick={() => {
                    setTitleErr('');
                    setEditingTitle(true);
                  }}
                  aria-label="Edit app title and company name"
                  title="Edit title"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: '2px 4px',
                    borderRadius: 4,
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </button>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.2 }}>{orgName}</div>
          </div>
        </div>

        <nav aria-label="Main navigation" className="desktop-nav">
          {primaryLinks.map((l) => {
            const on = l.href === '/' ? path === '/' : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={on ? 'page' : undefined}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: on ? 700 : 600,
                  textDecoration: 'none',
                  background: on ? 'var(--primary)' : 'transparent',
                  color: on ? 'var(--primary-fg)' : 'var(--text-secondary)',
                  transition: 'background-color 0.12s, color 0.12s',
                }}
              >
                <Icon name={l.icon} />
                <span>{l.label}</span>
              </Link>
            );
          })}
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            className="desktop-only"
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 999,
              background: p.canEdit ? '#dbeafe' : 'var(--surface-muted)',
              color: p.canEdit ? '#1e40af' : 'var(--text-secondary)',
              textTransform: 'uppercase',
            }}
          >
            {p.role}
          </span>
          <button
            className="btn desktop-only"
            onClick={toggleDark}
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={dark ? 'Light mode' : 'Dark mode'}
          >
            <Icon name={dark ? 'sun' : 'moon'} />
          </button>
          <button
            ref={menuBtnRef}
            className="btn"
            onClick={() => setDrawerOpen(true)}
            aria-label={p.isAdmin && (p.pendingUsersCount ?? 0) > 0 ? `Open menu (${p.pendingUsersCount} pending approvals)` : 'Open menu'}
            aria-expanded={drawerOpen}
          >
            <Icon name="menu" />
            <span>Menu</span>
            {p.isAdmin && (p.pendingUsersCount ?? 0) > 0 && (
              <span
                style={{
                  background: '#dc2626',
                  color: '#ffffff',
                  borderRadius: 999,
                  padding: '1px 6px',
                  fontSize: 10.5,
                  fontWeight: 800,
                  lineHeight: 1.3,
                }}
              >
                {p.pendingUsersCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Bottom Navigation Bar (Mobile & Tablet <= 1024px) */}
      <nav aria-label="Bottom navigation" className="bottom-nav no-print">
        {primaryLinks.map((l) => {
          const on = l.href === '/' ? path === '/' : path.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} aria-current={on ? 'page' : undefined}>
              <Icon name={l.icon} />
              <span>{l.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Slide-out Secondary & Admin Actions Drawer */}
      {drawerOpen && (
        <div
          className="drawer-overlay no-print"
          onClick={() => {
            setDrawerOpen(false);
            menuBtnRef.current?.focus();
          }}
        >
          <aside
            className="drawer-panel"
            role="dialog"
            aria-modal="true"
            aria-label="App menu"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid var(--border-light)',
                paddingBottom: 10,
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{p.userName || 'BPWI User'}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Role: {p.role}
                </div>
              </div>
              <button
                ref={closeBtnRef}
                className="btn"
                onClick={() => {
                  setDrawerOpen(false);
                  menuBtnRef.current?.focus();
                }}
                aria-label="Close menu"
              >
                <Icon name="close" />
              </button>
            </div>

            {(p.canEdit || p.isAdmin) && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Administration
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {p.canEdit && (
                    <Link href="/generate" className="btn" style={{ justifyContent: 'flex-start', textDecoration: 'none' }}>
                      Generate Schedule
                    </Link>
                  )}
                  {p.isAdmin && (
                    <Link href="/operators" className="btn" style={{ justifyContent: 'space-between', textDecoration: 'none' }}>
                      <span>Operators, Users &amp; Setup</span>
                      {(p.pendingUsersCount ?? 0) > 0 && (
                        <span
                          style={{
                            background: 'var(--warn-bg)',
                            color: 'var(--warn-fg)',
                            border: '1px solid var(--warn-border)',
                            borderRadius: 999,
                            padding: '1px 7px',
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          {p.pendingUsersCount} pending
                        </span>
                      )}
                    </Link>
                  )}
                </div>
              </>
            )}

            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: 6 }}>
              Appearance
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <button className="btn" style={{ justifyContent: 'space-between' }} onClick={toggleDark}>
                <span>Dark Mode</span>
                <b>{dark ? 'ON' : 'OFF'}</b>
              </button>
              <button className="btn" style={{ justifyContent: 'space-between' }} onClick={toggleContrast}>
                <span>High Contrast</span>
                <b>{highContrast ? 'ON' : 'OFF'}</b>
              </button>
            </div>

            <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-light)', paddingTop: 12 }}>
              <button
                className="btn"
                style={{ width: '100%', color: 'var(--danger)' }}
                onClick={async () => {
                  await supabaseBrowser().auth.signOut();
                  localStorage.removeItem('bpwi-last-sync');
                  if ('caches' in window) {
                    const keys = await caches.keys();
                    await Promise.all(keys.map((k) => caches.delete(k)));
                  }
                  window.location.href = '/login';
                }}
              >
                Sign out
              </button>
            </div>
          </aside>
        </div>
      )}

      {editingTitle && (
        <div className="modal-overlay no-print" role="dialog" aria-modal="true" aria-labelledby="brand-dialog-title" onClick={() => !savingTitle && setEditingTitle(false)}>
          <form className="modal-sheet" onClick={(e) => e.stopPropagation()} onSubmit={saveBranding} style={{ maxWidth: 420, display: 'grid', gap: 12 }}>
            <h2 id="brand-dialog-title" style={{ margin: 0, fontSize: 17 }}>
              Edit App Title &amp; Organization
            </h2>
            <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>
              App Title
              <input className="input" value={appTitle} onChange={(e) => setAppTitle(e.target.value)} required disabled={savingTitle} />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>
              Organization Name
              <input className="input" value={orgName} onChange={(e) => setOrgName(e.target.value)} required disabled={savingTitle} />
            </label>
            {titleErr && (
              <p role="alert" style={{ margin: 0, fontSize: 12.5, color: 'var(--danger)' }}>
                {titleErr}
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setEditingTitle(false)} disabled={savingTitle}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={savingTitle}>
                {savingTitle ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
