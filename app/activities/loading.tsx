export default function ActivitiesLoading() {
  return (
    <div style={{ maxWidth: 1440, margin: '0 auto', padding: '12px 16px 40px', display: 'grid', gap: 12 }} aria-busy="true" aria-live="polite" aria-label="Loading daily activities">
      {/* Top Bar */}
      <div className="card" style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <div className="skeleton" style={{ width: 240, height: 22 }} />
          <div className="skeleton" style={{ width: 300, height: 14 }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="skeleton" style={{ width: 150, height: 36 }} />
          <div className="skeleton" style={{ width: 120, height: 36 }} />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ width: 150, height: 38 }} />
        ))}
      </div>

      {/* Duty Matrix Skeleton */}
      <div className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
        <div className="skeleton" style={{ width: 260, height: 18 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(255px, 1fr))', gap: 8 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 76 }} />
          ))}
        </div>
      </div>

      {/* Activity Cards Skeleton */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card" style={{ padding: 14, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div className="skeleton" style={{ width: 130, height: 22, borderRadius: 999 }} />
              <div className="skeleton" style={{ width: 70, height: 20, borderRadius: 999 }} />
            </div>
            <div className="skeleton" style={{ width: '75%', height: 18 }} />
            <div className="skeleton" style={{ width: '100%', height: 46 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
