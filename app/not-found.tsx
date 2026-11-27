import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{ padding: 24, maxWidth: 520, margin: '48px auto' }}>
      <div className="card" style={{ padding: 24, display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--accent)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          404 · Page not found
        </div>
        <h1 className="page-title" style={{ fontSize: 20 }}>
          We couldn&apos;t find that page
        </h1>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          The link may have moved or been mistyped. Jump back to the monthly roster or open your daily tasks.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          <Link href="/" className="btn btn-primary" style={{ textDecoration: 'none' }}>
            Back to Schedule
          </Link>
          <Link href="/field" className="btn" style={{ textDecoration: 'none' }}>
            Open Tasks
          </Link>
        </div>
      </div>
    </div>
  );
}
