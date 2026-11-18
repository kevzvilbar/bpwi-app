export default function RequestsLoading() {
  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: '12px 16px', display: 'grid', gap: 12 }} aria-busy="true" aria-live="polite" aria-label="Loading change requests">
      <div className="card" style={{ padding: 12, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <div className="skeleton" style={{ width: 220, height: 26 }} />
        <div style={{ display: 'flex', gap: 6 }}>
          <div className="skeleton" style={{ width: 80, height: 32 }} />
          <div className="skeleton" style={{ width: 80, height: 32 }} />
        </div>
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
          <div className="skeleton" style={{ width: 260, height: 20 }} />
          <div className="skeleton" style={{ height: 70 }} />
        </div>
      ))}
    </div>
  );
}
