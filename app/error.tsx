'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ padding: 24, maxWidth: 520, margin: '40px auto' }}>
      <div
        role="alert"
        className="card"
        style={{
          border: '1px solid var(--danger)',
          padding: 20,
          display: 'grid',
          gap: 10,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 17, color: 'var(--danger)' }}>Unable to load this page</h2>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)' }}>
          {error.message || 'An unexpected error occurred while fetching schedule data.'}
        </p>
        <div>
          <button className="btn btn-primary" onClick={reset}>
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
