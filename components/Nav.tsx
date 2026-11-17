'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function Nav(p: { role: string; userName: string; canEdit: boolean; isAdmin: boolean }) {
  const path = usePathname();
  if (path.startsWith('/login')) return null;

  const links = [
    { href: '/', label: 'Attendance Roster', show: true },
    { href: '/pm', label: 'PM Calendar', show: true },
    { href: '/leave', label: 'Leave Summary', show: true },
    { href: '/call-sheet', label: 'Call Sheet', show: true },
    { href: '/generate', label: 'Generate Schedule', show: p.canEdit },
    { href: '/operators', label: 'Operators & Setup', show: p.isAdmin },
  ].filter((l) => l.show);

  return (
    <header
      className="no-print"
      style={{
        background: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
        padding: '7px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          aria-hidden="true"
          style={{
            width: 30,
            height: 30,
            borderRadius: 7,
            background: 'linear-gradient(135deg, #1d4ed8, #0f766e)',
            color: '#ffffff',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 800,
            fontSize: 12,
            letterSpacing: '-0.02em',
          }}
        >
          BP
        </div>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a', lineHeight: 1.2 }}>
            Operations &amp; Plant Schedule
          </div>
          <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.2 }}>
            BP Waterworks, Inc. · Duty, Standby &amp; Preventive Maintenance
          </div>
        </div>
      </div>

      <nav
        aria-label="Main navigation"
        style={{
          display: 'flex',
          gap: 3,
          padding: 3,
          background: '#f1f5f9',
          borderRadius: 8,
          flexWrap: 'wrap',
        }}
      >
        {links.map((l) => {
          const on = l.href === '/' ? path === '/' : path.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={on ? 'page' : undefined}
              style={{
                padding: '5px 11px',
                borderRadius: 6,
                fontSize: 12.5,
                fontWeight: 600,
                textDecoration: 'none',
                background: on ? '#ffffff' : 'transparent',
                color: on ? '#0f172a' : '#475569',
                boxShadow: on ? '0 1px 2px rgba(15, 23, 42, 0.08)' : 'none',
                transition: 'background-color 0.12s, color 0.12s',
              }}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 999,
            background: p.canEdit ? '#dbeafe' : '#f1f5f9',
            color: p.canEdit ? '#1e40af' : '#475569',
            textTransform: 'uppercase',
          }}
        >
          {p.role}
        </span>
        {p.userName && <span style={{ fontSize: 12, color: '#475569' }}>{p.userName}</span>}
        <button
          className="btn"
          onClick={async () => {
            await supabaseBrowser().auth.signOut();
            window.location.href = '/login';
          }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
