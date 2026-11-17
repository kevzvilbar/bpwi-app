export default function Loading() {
  return (
    <div style={{ padding: 20, display: 'grid', gap: 12 }} aria-busy="true" aria-live="polite">
      <div
        style={{
          height: 44,
          background: 'var(--surface-muted)',
          borderRadius: 10,
          animation: 'pulse 1.5s ease-in-out infinite',
        }}
      />
      <div
        className="card"
        style={{
          height: 360,
          display: 'grid',
          placeItems: 'center',
          color: 'var(--text-secondary)',
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        Loading schedule data…
      </div>
    </div>
  );
}
