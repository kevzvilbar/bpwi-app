export default function PmLoading() {
  return (
    <div style={{ maxWidth: 1440, margin: '0 auto', padding: '12px 16px', display: 'grid', gap: 12 }} aria-busy="true" aria-live="polite" aria-label="Loading PM planner">
      <div className="card" style={{ padding: 12, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <div className="skeleton" style={{ width: 220, height: 28 }} />
        <div className="skeleton" style={{ width: 140, height: 34 }} />
      </div>
      <div className="pm-layout">
        <div className="card" style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
          {Array.from({ length: 28 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 76 }} />
          ))}
        </div>
        <div className="card" style={{ padding: 12, display: 'grid', gap: 10 }}>
          <div className="skeleton" style={{ width: 160, height: 20 }} />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 60 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
