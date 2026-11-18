export default function MobileLoading() {
  return (
    <div className="tasks-shell" aria-busy="true" aria-live="polite" aria-label="Loading tasks and logs">
      <div className="card" style={{ padding: 10, marginBottom: 12, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div className="skeleton" style={{ width: 280, height: 42, borderRadius: 10 }} />
        <div style={{ display: 'flex', gap: 8, flex: '1 1 220px', justifyContent: 'flex-end' }}>
          <div className="skeleton" style={{ flex: '1 1 160px', height: 38 }} />
          <div className="skeleton" style={{ width: 120, height: 38 }} />
        </div>
      </div>

      <div className="kanban-board desktop-only-kanban">
        {Array.from({ length: 3 }).map((_, col) => (
          <div key={col} className="kanban-col">
            <div className="skeleton" style={{ width: 140, height: 20 }} />
            {Array.from({ length: 3 }).map((_, row) => (
              <div key={row} className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
                <div className="skeleton" style={{ width: 110, height: 20, borderRadius: 999 }} />
                <div className="skeleton" style={{ width: '80%', height: 16 }} />
                <div className="skeleton" style={{ width: '100%', height: 36 }} />
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="mobile-only-block">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
            <div className="skeleton" style={{ width: 110, height: 20, borderRadius: 999 }} />
            <div className="skeleton" style={{ width: '80%', height: 16 }} />
            <div className="skeleton" style={{ width: '100%', height: 36 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
