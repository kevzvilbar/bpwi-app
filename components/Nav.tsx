'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function Nav(p: { role: string; userName: string; canEdit: boolean; isAdmin: boolean }) {
  const path = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [highContrast, setHighContrast] = useState(false);

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

  const desktopLinks = [
    { href: '/', label: 'Schedule', show: true },
    { href: '/mobile', label: 'Attendance & My Tasks', show: true },
    { href: '/pm', label: 'PM Tasks', show: true },
    { href: '/call-sheet', label: 'Standby', show: true },
    { href: '/leave', label: 'Reports', show: true },
    { href: '/generate', label: 'Generate', show: p.canEdit },
    { href: '/operators', label: 'Setup', show: p.isAdmin },
  ].filter((l) => l.show);

  const bottomLinks = [
    { href: '/', label: 'Schedule', icon: '📅' },
    { href: '/mobile', label: 'Attendance', icon: '✓' },
    { href: '/pm', label: 'PM Tasks', icon: '🔧' },
    { href: '/call-sheet', label: 'Standby', icon: '⚡' },
    { href: '/leave', label: 'Reports', icon: '📊' },
  ];

  return (
    <>
      <header className="app-topbar no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            aria-hidden="true"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #1d4ed8, #0f766e)',
              color: '#ffffff',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 800,
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            BP
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.2 }}>Operations &amp; Plant Schedule</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.2 }}>
              BP Waterworks, Inc.
            </div>
          </div>
        </div>

        <nav aria-label="Main navigation" className="desktop-nav">
          {desktopLinks.map((l) => {
            const on = l.href === '/' ? path === '/' : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={on ? 'page' : undefined}
                style={{
                  padding: '5px 10px',
                  borderRadius: 6,
                  fontSize: 12.5,
                  fontWeight: 600,
                  textDecoration: 'none',
                  background: on ? 'var(--surface)' : 'transparent',
                  color: on ? 'var(--text)' : 'var(--text-secondary)',
                  boxShadow: on ? '0 1px 2px rgba(15, 23, 42, 0.08)' : 'none',
                }}
              >
                {l.label}
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
            {dark ? '☀' : '☾'}
          </button>
          <button
            className="btn"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
          >
            ☰ Menu
          </button>
        </div>
      </header>

      {/* Bottom Navigation Bar (Mobile & Tablet <= 1024px) */}
      <nav aria-label="Bottom navigation" className="bottom-nav no-print">
        {bottomLinks.map((l) => {
          const on = l.href === '/' ? path === '/' : path.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} aria-current={on ? 'page' : undefined}>
              <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1 }}>
                {l.icon}
              </span>
              <span>{l.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Slide-out Secondary Actions Drawer */}
      {drawerOpen && (
        <div className="drawer-overlay no-print" onClick={() => setDrawerOpen(false)}>
          <aside
            className="drawer-panel"
            role="dialog"
            aria-modal="true"
            aria-label="App menu"
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-light)', paddingBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{p.userName || 'BPWI User'}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Role: {p.role}
                </div>
              </div>
              <button className="btn" onClick={() => setDrawerOpen(false)} aria-label="Close menu">
                ✕
              </button>
            </div>

            <div style={{ display: 'grid', gap: 6 }}>
              <Link href="/" className="btn" style={{ justifyContent: 'flex-start', textDecoration: 'none' }}>
                Schedule
              </Link>
              <Link href="/mobile" className="btn" style={{ justifyContent: 'flex-start', textDecoration: 'none' }}>
                Attendance &amp; My Tasks
              </Link>
              <Link href="/pm" className="btn" style={{ justifyContent: 'flex-start', textDecoration: 'none' }}>
                PM Tasks
              </Link>
              <Link href="/call-sheet" className="btn" style={{ justifyContent: 'flex-start', textDecoration: 'none' }}>
                Emergency Standby
              </Link>
              <Link href="/leave" className="btn" style={{ justifyContent: 'flex-start', textDecoration: 'none' }}>
                Leave Reports
              </Link>
              {p.canEdit && (
                <Link href="/generate" className="btn" style={{ justifyContent: 'flex-start', textDecoration: 'none' }}>
                  Generate Schedule
                </Link>
              )}
              {p.isAdmin && (
                <Link href="/operators" className="btn" style={{ justifyContent: 'flex-start', textDecoration: 'none' }}>
                  Operators, Users &amp; Setup
                </Link>
              )}
            </div>

            <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 10, display: 'grid', gap: 8 }}>
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
                  window.location.href = '/login';
                }}
              >
                Sign out
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
