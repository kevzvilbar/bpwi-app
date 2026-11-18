export default function ReportsLoading() {
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '12px 16px', display: 'grid', gap: 12 }} aria-busy="true" aria-live="polite" aria-label="Loading reports">
      <div className="card" style={{ padding: 12, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <div className="skeleton" style={{ width: 200, height: 26 }} />
        <div className="skeleton" style={{ width: 160, height: 34 }} />
      </div>
      <div className="card" style={{ padding: 14, display: 'grid', gap: 8 }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 34 }} />
        ))}
      </div>
    </div>
  );
}
