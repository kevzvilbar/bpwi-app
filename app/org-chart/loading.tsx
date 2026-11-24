export default function OrgChartLoading() {
  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '12px 16px', display: 'grid', gap: 12 }} aria-busy="true" aria-live="polite" aria-label="Loading organization chart">
      <div className="card" style={{ padding: 12, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <div className="skeleton" style={{ width: 230, height: 26 }} />
        <div style={{ display: 'flex', gap: 6 }}>
          <div className="skeleton" style={{ width: 88, height: 34 }} />
          <div className="skeleton" style={{ width: 88, height: 34 }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card" style={{ padding: 14, display: 'grid', gap: 8 }}>
            <div className="skeleton" style={{ width: 160, height: 18 }} />
            <div className="skeleton" style={{ height: 64 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
