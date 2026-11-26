'use client';

import { useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { formatDateOnly, formatManila, manilaInputToIso, toManilaInput } from '@/lib/date';
import { AlertBanner, Badge } from '@/components/ui';

export type Person = {
  id: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  phone_number: string | null;
  job_title: string | null;
  can_approve: boolean | null;
};
export type Grant = {
  id: string;
  user_id: string;
  starts_at: string;
  ends_at: string;
  date_from: string | null;
  date_to: string | null;
  note: string | null;
  revoked_at: string | null;
  created_at: string;
};

const PERSON_COLS = 'id, full_name, role, is_active, phone_number, job_title, can_approve';
const GRANT_COLS = 'id, user_id, starts_at, ends_at, date_from, date_to, note, revoked_at, created_at';
const DAY = 24 * 60 * 60 * 1000;

type Draft = { userId: string; start: string; end: string; from: string; to: string; note: string };

function grantStatus(g: Grant, nowMs: number): 'Active' | 'Upcoming' | 'Ended' | 'Revoked' {
  if (g.revoked_at) return 'Revoked';
  if (Date.parse(g.ends_at) <= nowMs) return 'Ended';
  if (Date.parse(g.starts_at) <= nowMs) return 'Active';
  return 'Upcoming';
}

function rangeText(g: Grant) {
  if (g.date_from && g.date_to) return `${formatDateOnly(g.date_from)} – ${formatDateOnly(g.date_to)}`;
  if (g.date_from) return `from ${formatDateOnly(g.date_from)}`;
  if (g.date_to) return `up to ${formatDateOnly(g.date_to)}`;
  return 'Any date';
}

export default function DepartmentHeads(p: { people: Person[]; grants: Grant[]; orgId: string; error: string }) {
  const [people, setPeople] = useState<Person[]>(p.people);
  const [grants, setGrants] = useState<Grant[]>(p.grants);
  const [edits, setEdits] = useState<Record<string, { job_title: string; phone_number: string }>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState('');

  const nowMs = Date.now();
  const heads = useMemo(() => people.filter((x) => x.role === 'manager'), [people]);
  const nameOf = useMemo(() => new Map(people.map((x) => [x.id, x.full_name || x.id.slice(0, 8)])), [people]);
  const approverCandidates = useMemo(() => people.filter((x) => x.is_active && x.role !== 'viewer'), [people]);

  const field = (id: string, key: 'job_title' | 'phone_number') => {
    const person = people.find((x) => x.id === id);
    return edits[id]?.[key] ?? person?.[key] ?? '';
  };
  const setField = (id: string, key: 'job_title' | 'phone_number', value: string) =>
    setEdits((e) => ({
      ...e,
      [id]: { job_title: field(id, 'job_title'), phone_number: field(id, 'phone_number'), [key]: value },
    }));

  function flash(text: string) {
    setOk(text);
    setTimeout(() => setOk((cur) => (cur === text ? '' : cur)), 2500);
  }

  async function saveContact(id: string) {
    setBusy(`c${id}`);
    setMsg('');
    const { data, error } = await supabaseBrowser()
      .from('user_profiles')
      .update({ job_title: field(id, 'job_title').trim() || null, phone_number: field(id, 'phone_number').trim() || null })
      .eq('id', id)
      .select(PERSON_COLS)
      .single();
    setBusy('');
    if (error) return setMsg(error.message);
    setPeople((list) => list.map((x) => (x.id === id ? (data as Person) : x)));
    setEdits((e) => {
      const { [id]: _drop, ...rest } = e;
      return rest;
    });
    flash('Contact details saved');
  }

  async function setApprover(id: string, value: boolean) {
    setBusy(`a${id}`);
    setMsg('');
    const { data, error } = await supabaseBrowser().from('user_profiles').update({ can_approve: value }).eq('id', id).select(PERSON_COLS).single();
    setBusy('');
    if (error) return setMsg(error.message);
    setPeople((list) => list.map((x) => (x.id === id ? (data as Person) : x)));
    flash(value ? 'Approver added' : 'Approver removed');
  }

  function openDraft(userId: string) {
    const now = new Date();
    setMsg('');
    setDraft({ userId, start: toManilaInput(now), end: toManilaInput(new Date(now.getTime() + 8 * 60 * 60 * 1000)), from: '', to: '', note: '' });
  }

  function preset(kind: 'hours' | 'today' | 'week') {
    setDraft((d) => {
      if (!d) return d;
      const now = new Date();
      const end =
        kind === 'hours'
          ? toManilaInput(new Date(now.getTime() + 8 * 60 * 60 * 1000))
          : kind === 'today'
            ? `${toManilaInput(now).slice(0, 10)}T23:59`
            : toManilaInput(new Date(now.getTime() + 7 * DAY));
      return { ...d, start: toManilaInput(now), end };
    });
  }

  async function submitDraft() {
    if (!draft) return;
    setMsg('');
    if (!draft.start || !draft.end) return setMsg('Choose when the window opens and closes.');
    const startMs = Date.parse(manilaInputToIso(draft.start));
    const endMs = Date.parse(manilaInputToIso(draft.end));
    if (endMs <= startMs) return setMsg('The window must close after it opens.');
    if (endMs <= Date.now()) return setMsg('The window would already be over. Pick a later closing time.');
    if (endMs - startMs > 14 * DAY) return setMsg('A window can last at most 14 days.');
    if (draft.from && draft.to && draft.to < draft.from) return setMsg('The last editable date must not be before the first.');

    setBusy('grant');
    const { data, error } = await supabaseBrowser()
      .from('edit_grants')
      .insert({
        organization_id: p.orgId,
        user_id: draft.userId,
        starts_at: new Date(startMs).toISOString(),
        ends_at: new Date(endMs).toISOString(),
        date_from: draft.from || null,
        date_to: draft.to || null,
        note: draft.note.trim() || null,
      })
      .select(GRANT_COLS)
      .single();
    setBusy('');
    if (error) return setMsg(error.message);
    setGrants((g) => [data as Grant, ...g]);
    setDraft(null);
    flash('Edit window created');
  }

  async function revoke(g: Grant) {
    setBusy(`r${g.id}`);
    setMsg('');
    const sb = supabaseBrowser();
    const { data: auth } = await sb.auth.getUser();
    const { data, error } = await sb
      .from('edit_grants')
      .update({ revoked_at: new Date().toISOString(), revoked_by: auth.user?.id ?? null })
      .eq('id', g.id)
      .select(GRANT_COLS)
      .single();
    setBusy('');
    if (error) return setMsg(error.message);
    setGrants((list) => list.map((x) => (x.id === g.id ? (data as Grant) : x)));
    flash('Edit window revoked');
  }

  const liveFor = (userId: string) => grants.find((g) => g.user_id === userId && grantStatus(g, nowMs) === 'Active');
  const draftHead = draft ? heads.find((h) => h.id === draft.userId) : undefined;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {p.error && (
        <AlertBanner tone="warn">
          Could not load department head data: {p.error}. If this is a fresh update, run migrations 007 and then 008 in Supabase.
        </AlertBanner>
      )}
      {(msg || ok) && (
        <div aria-live="polite" style={{ fontSize: 12.5 }}>
          {msg && (
            <span role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
              {msg}
            </span>
          )}
          {!msg && ok && <span style={{ color: 'var(--ok-fg)', fontWeight: 600 }}>{ok}</span>}
        </div>
      )}

      <section className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>Department heads ({heads.length})</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-secondary)' }}>
            Department heads are not on the roster. They are read-only until you open an edit window for them, and they appear on the Call Sheet as
            escalation contacts. To add one, set their role to <b>department head</b> under Users &amp; roles and activate the account.
          </p>
        </div>
        {heads.length === 0 && <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>No department heads yet.</p>}
        {heads.map((h) => {
          const live = liveFor(h.id);
          const dirty = edits[h.id] !== undefined;
          return (
            <div key={h.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>{h.full_name || 'Unnamed user'}</strong>
                {!h.is_active && <Badge size="sm" tone="warn">Pending approval</Badge>}
                {live ? (
                  <Badge size="sm" tone="ok">Can edit until {formatManila(live.ends_at)}</Badge>
                ) : (
                  <Badge size="sm" tone="neutral">Read-only</Badge>
                )}
              </div>
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                <label style={{ fontSize: 12 }}>
                  Job title
                  <input
                    className="input"
                    placeholder="e.g. Operations Department Head"
                    value={field(h.id, 'job_title')}
                    onChange={(e) => setField(h.id, 'job_title', e.target.value)}
                  />
                </label>
                <label style={{ fontSize: 12 }}>
                  Phone (shown on the Call Sheet)
                  <input
                    className="input"
                    type="tel"
                    inputMode="tel"
                    placeholder="09xx xxx xxxx"
                    value={field(h.id, 'phone_number')}
                    onChange={(e) => setField(h.id, 'phone_number', e.target.value)}
                  />
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" disabled={!dirty || busy === `c${h.id}`} onClick={() => saveContact(h.id)}>
                  {busy === `c${h.id}` ? 'Saving…' : 'Save details'}
                </button>
                <button className="btn" disabled={!h.is_active} onClick={() => openDraft(h.id)}>
                  Grant edit window…
                </button>
              </div>
            </div>
          );
        })}
      </section>

      {draft && (
        <section className="card" style={{ padding: 14, display: 'grid', gap: 10 }} aria-label="New edit window">
          <h2 style={{ margin: 0, fontSize: 16 }}>New edit window for {draftHead?.full_name || 'department head'}</h2>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-secondary)' }}>
            Times are Manila time. Inside the window they can change schedule, standby, leave and PM tasks directly, without approval. The server ends the
            window automatically, and you can revoke it at any time.
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => preset('hours')}>Next 8 hours</button>
            <button className="btn" onClick={() => preset('today')}>Rest of today</button>
            <button className="btn" onClick={() => preset('week')}>Next 7 days</button>
          </div>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <label style={{ fontSize: 12 }}>
              Opens
              <input className="input" type="datetime-local" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
            </label>
            <label style={{ fontSize: 12 }}>
              Closes
              <input className="input" type="datetime-local" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
            </label>
            <label style={{ fontSize: 12 }}>
              Editable dates from (optional)
              <input className="input" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
            </label>
            <label style={{ fontSize: 12 }}>
              Editable dates to (optional)
              <input className="input" type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
            </label>
          </div>
          <label style={{ fontSize: 12 }}>
            Note (optional)
            <input className="input" placeholder="e.g. Covering December roster while scheduler is on leave" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" disabled={busy === 'grant'} onClick={submitDraft}>
              {busy === 'grant' ? 'Creating…' : 'Create edit window'}
            </button>
            <button className="btn" onClick={() => { setDraft(null); setMsg(''); }}>Cancel</button>
          </div>
        </section>
      )}

      <section className="card" style={{ padding: 14, display: 'grid', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Edit windows</h2>
        {grants.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>No edit windows yet.</p>
        ) : (
          <>
            <div className="responsive-table-wrap scroll-x">
              <table className="data-table data-table-sticky">
                <thead>
                  <tr>
                    {['Department head', 'Window (Manila)', 'Editable dates', 'Note', 'Status', ''].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '6px 8px', background: 'var(--surface-muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grants.map((g) => {
                    const st = grantStatus(g, nowMs);
                    const live = st === 'Active' || st === 'Upcoming';
                    return (
                      <tr key={g.id}>
                        <td style={{ padding: '6px 8px' }}>{nameOf.get(g.user_id)}</td>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                          {formatManila(g.starts_at)} → {formatManila(g.ends_at)}
                        </td>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{rangeText(g)}</td>
                        <td style={{ padding: '6px 8px' }}>{g.note ?? '—'}</td>
                        <td style={{ padding: '6px 8px' }}>
                          <Badge size="sm" tone={st === 'Active' ? 'ok' : st === 'Upcoming' ? 'info' : 'neutral'}>
                            {st}
                          </Badge>
                        </td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-light)', whiteSpace: 'nowrap', textAlign: 'right' }}>
                          {live && (
                            <button className="btn btn-sm" disabled={busy === `r${g.id}`} onClick={() => revoke(g)}>
                              {busy === `r${g.id}` ? 'Revoking…' : 'Revoke'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="responsive-cards">
              {grants.map((g) => {
                const st = grantStatus(g, nowMs);
                const live = st === 'Active' || st === 'Upcoming';
                return (
                  <div
                    key={`m-${g.id}`}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      padding: 12,
                      display: 'grid',
                      gap: 6,
                      background: 'var(--surface-muted)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 13.5 }}>{nameOf.get(g.user_id)}</strong>
                      <Badge size="sm" tone={st === 'Active' ? 'ok' : st === 'Upcoming' ? 'info' : 'neutral'}>
                        {st}
                      </Badge>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text)' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Window (Manila): </span>
                      {formatManila(g.starts_at)} → {formatManila(g.ends_at)}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text)' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Editable dates: </span>
                      {rangeText(g)}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                      Note: {g.note ?? '—'}
                    </div>
                    {live && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 2 }}>
                        <button type="button" className="btn" disabled={busy === `r${g.id}`} onClick={() => revoke(g)}>
                          {busy === `r${g.id}` ? 'Revoking…' : 'Revoke'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
          Everything a department head changes is recorded in the Activity log under their name.
        </p>
      </section>

      <section className="card" style={{ padding: 14, display: 'grid', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>Delegated approvers</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-secondary)' }}>
            Admins always approve. Tick anyone else who may also approve department-head changes. This takes effect with the upcoming approval queue; only
            admins can grant edit windows.
          </p>
        </div>
        {approverCandidates.map((u) => (
          <label key={u.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, minHeight: 32 }}>
            <input
              type="checkbox"
              checked={u.role === 'admin' ? true : u.can_approve === true}
              disabled={u.role === 'admin' || busy === `a${u.id}`}
              onChange={(e) => setApprover(u.id, e.target.checked)}
            />
            <span>
              {u.full_name || u.id.slice(0, 8)} <span style={{ color: 'var(--text-secondary)' }}>· {u.role === 'manager' ? 'department head' : u.role}</span>
              {u.role === 'admin' && <span style={{ color: 'var(--text-secondary)' }}> · always</span>}
            </span>
          </label>
        ))}
      </section>
    </div>
  );
}
