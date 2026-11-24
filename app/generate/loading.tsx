export default function GenerateLoading() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '12px 16px', display: 'grid', gap: 12 }} aria-busy="true" aria-live="polite" aria-label="Loading schedule generator">
      <div className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
        <div className="skeleton" style={{ width: 220, height: 26 }} />
        <div className="skeleton" style={{ height: 42 }} />
        <div className="skeleton" style={{ height: 180 }} />
      </div>
    </div>
  );
}
