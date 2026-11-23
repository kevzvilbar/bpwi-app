export type EscalationContact = { id: string; full_name: string | null; job_title: string | null; phone_number: string | null };

/**
 * Department heads and managers who are not on the shift roster but must be reachable.
 * Always shown (they are not filtered by the search box or the standby toggle).
 */
export default function EscalationContacts({ contacts }: { contacts: EscalationContact[] }) {
  if (contacts.length === 0) return null;
  return (
    <section className="card" style={{ padding: 12, marginBottom: 10, display: 'grid', gap: 8 }} aria-label="Management escalation contacts">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 14 }}>Management escalation</strong>
        <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Not on the shift roster · reachable any time</span>
      </div>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {contacts.map((c) => (
          <div
            key={c.id}
            style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, display: 'grid', gap: 6, background: 'var(--surface-muted)' }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{c.full_name || 'Unnamed'}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{c.job_title || 'Department Head'}</div>
            </div>
            {c.phone_number ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
                <a
                  href={`tel:${c.phone_number}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 44,
                    padding: '5px 10px',
                    borderRadius: 7,
                    background: 'var(--primary)',
                    color: 'var(--primary-fg)',
                    textDecoration: 'none',
                    fontWeight: 700,
                    fontSize: 12.5,
                    fontFamily: 'ui-monospace, monospace',
                  }}
                >
                  Call {c.phone_number}
                </a>
                <a href={`sms:${c.phone_number}`} className="btn" style={{ textDecoration: 'none', fontWeight: 700 }}>
                  SMS
                </a>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No phone number on file.</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
