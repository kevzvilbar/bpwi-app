export default function Loading() {
  return (
    <div style={{ padding: '12px 16px', display: 'grid', gap: 10 }} aria-busy="true" aria-live="polite" aria-label="Loading schedule">
      {/* Action & Filter Toolbar */}
      <div className="card" style={{ padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="skeleton" style={{ width: 34, height: 34 }} />
          <div className="skeleton" style={{ width: 140, height: 34 }} />
          <div className="skeleton" style={{ width: 34, height: 34 }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="skeleton" style={{ width: 96, height: 32, borderRadius: 999 }} />
          <div className="skeleton" style={{ width: 96, height: 32, borderRadius: 999 }} />
          <div className="skeleton" style={{ width: 96, height: 32, borderRadius: 999 }} />
        </div>
      </div>

      {/* Paint Palette Bar */}
      <div className="card desktop-only" style={{ padding: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <div className="skeleton" style={{ width: 110, height: 26, borderRadius: 999 }} />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ width: 44, height: 26, borderRadius: 6 }} />
        ))}
      </div>

      {/* Roster Grid Skeleton */}
      <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
        <div className="skeleton" style={{ height: 34, width: '100%' }} />
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 8 }}>
            <div className="skeleton" style={{ height: 26 }} />
            <div className="skeleton" style={{ height: 26 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
