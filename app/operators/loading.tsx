export default function OperatorsLoading() {
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '12px 16px', display: 'grid', gap: 12 }} aria-busy="true" aria-live="polite" aria-label="Loading setup">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ width: 120, height: 36 }} />
        ))}
      </div>
      <div className="card" style={{ padding: 14, display: 'grid', gap: 8 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 38 }} />
        ))}
      </div>
    </div>
  );
}
