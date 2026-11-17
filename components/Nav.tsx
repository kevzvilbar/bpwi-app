'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Attendance Roster' },
  { href: '/pm', label: 'PM Calendar' },
  { href: '/leave', label: 'Leave Summary' },
  { href: '/generate', label: 'Generate Schedule' },
  { href: '/operators', label: 'Operators & Setup' },
];

export default function Nav() {
  const path = usePathname();
  if (path.startsWith('/login')) return null;

  return (
    <nav
      className="no-print"
      style={{
        background: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
        padding: '6px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 28,
            height: 28,
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
          <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a', lineHeight: 1.15 }}>
            Operations &amp; Plant Schedule
          </div>
          <div style={{ fontSize: 10.5, color: '#64748b', lineHeight: 1.15 }}>
            BP Waterworks, Inc. · Duty, Standby &amp; Preventive Maintenance
          </div>
        </div>
      </div>

      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: 3,
          padding: 3,
          background: '#f1f5f9',
          borderRadius: 8,
          flexWrap: 'wrap',
        }}
      >
        {LINKS.map((l) => {
          const on = l.href === '/' ? path === '/' : path.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              role="tab"
              aria-selected={on}
              style={{
                padding: '5px 11px',
                borderRadius: 6,
                fontSize: 12.5,
                fontWeight: 600,
                textDecoration: 'none',
                background: on ? '#ffffff' : 'transparent',
                color: on ? '#0f172a' : '#64748b',
                boxShadow: on ? '0 1px 2px rgba(15, 23, 42, 0.08)' : 'none',
                transition: 'background-color 0.12s, color 0.12s',
              }}
            >
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
