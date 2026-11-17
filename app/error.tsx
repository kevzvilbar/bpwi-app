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
        style={{
          background: '#ffffff',
          border: '1px solid #fecaca',
          borderRadius: 12,
          padding: 20,
          display: 'grid',
          gap: 10,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 17, color: '#991b1b' }}>Unable to load this page</h2>
        <p style={{ margin: 0, fontSize: 13.5, color: '#475569' }}>
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
