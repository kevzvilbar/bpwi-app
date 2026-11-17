export default function Loading() {
  return (
    <div style={{ padding: 20, display: 'grid', gap: 12 }} aria-busy="true" aria-live="polite">
      <div
        style={{
          height: 44,
          background: '#e2e8f0',
          borderRadius: 10,
          animation: 'pulse 1.5s ease-in-out infinite',
        }}
      />
      <div
        style={{
          height: 360,
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          borderRadius: 10,
          display: 'grid',
          placeItems: 'center',
          color: '#475569',
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        Loading schedule data…
      </div>
    </div>
  );
}
