'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Roster' },
  { href: '/pm', label: 'PM Planner' },
  { href: '/leave', label: 'Leave Summary' },
  { href: '/generate', label: 'Generate Schedule' },
  { href: '/operators', label: 'Operators & Setup' },
];

export default function Nav() {
  const path = usePathname();
  if (path.startsWith('/login')) return null;
  return (
    <nav className="no-print" style={{ display: 'flex', gap: 4, padding: '8px 14px 0', flexWrap: 'wrap' }}>
      {LINKS.map((l) => {
        const on = l.href === '/' ? path === '/' : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none',
              background: on ? '#0f172a' : '#e2e8f0', color: on ? '#fff' : '#334155',
            }}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
