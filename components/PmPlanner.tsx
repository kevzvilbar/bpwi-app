'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

type Task = {
  id: string; legacy_key: string | null; activity_type: string; title: string; locations: string[]; asset: string | null;
  assigned_operator_ids: string[]; scheduled_date: string; status: 'planned' | 'done' | 'postponed'; completed_at: string | null; remarks: string | null;
};
type Op = { id: string; full_name: string };

const PRESETS: Record<string, string> = {
  FLUSH: 'Line Flushing', TANK: 'Tank Cleaning', PULL: 'Deep Well Pump & Motor Pull-out', THERM: 'Thermal Scanning', LEVEL: 'Water Level Monitoring',
};
const STATUS_COLOR = { planned: ['#dbeafe', '#1e40af'], done: ['#dcfce7', '#166534'], postponed: ['#fef3c7', '#92400e'] } as const;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const addDays = (d: string, n: number) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const addMonths = (d: string, n: number) => {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const max = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, max));
  return t.toISOString().slice(0, 10);
};

type Draft = {
  id?: string; legacy_key?: string | null; typeKey: string; custom: string; locations: string; asset: string; assignees: string[];
  date: string; status: Task['status']; remarks: string; repeat: 'none' | 'weekly' | 'monthly'; count: number;
};

export default function PmPlanner(p: { month: string; today: string; tasks: Task[]; operators: Op[]; orgId: string; canEdit: boolean; error: string }) {
  const router = useRouter();
  const [tasks, setTasks] = useState(p.tasks);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [msg, setMsg] = useState(p.error);
  const [busy, setBusy] = useState(false);
  useEffect(() => setTasks(p.tasks), [p.tasks]);

  const [y, mo] = p.month.split('-').map(Number);
  const opName = useMemo(() => new Map(p.operators.map((o) => [o.id, o.full_name])), [p.operators]);
  const types = useMemo(() => Array.from(new Set([...Object.keys(PRESETS), ...tasks.map((t) => t.activity_type)])), [tasks]);
  const label = (t: string) => PRESETS[t] ?? tasks.find((x) => x.activity_type === t)?.title ?? t;

  const visible = tasks.filter((t) => (!typeFilter || t.activity_type === typeFilter) && (!statusFilter || t.status === statusFilter));
  const byDate = useMemo(() => { const m = new Map<string, Task[]>(); visible.forEach((t) => m.set(t.scheduled_date, [...(m.get(t.scheduled_date) ?? []), t])); return m; }, [visible]);

  const startDow = new Date(y, mo - 1, 1).getDay();
  const dim = new Date(y, mo, 0).getDate();
  const cells: (string | null)[] = [...Array(startDow).fill(null), ...Array.from({ length: dim }, (_, i) => `${p.month}-${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);

  const go = (d: number) => { const t = new Date(y, mo - 1 + d, 1); router.push(`/pm?m=${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`); };
  const blank = (date: string): Draft => ({ typeKey: 'FLUSH', custom: '', locations: '', asset: '', assignees: [], date, status: 'planned', remarks: '', repeat: 'none', count: 4 });
  const edit = (t: Task): Draft => ({
    id: t.id, legacy_key: t.legacy_key, typeKey: PRESETS[t.activity_type] ? t.activity_type : '__custom', custom: PRESETS[t.activity_type] ? '' : t.title,
    locations: t.locations.join(', '), asset: t.asset ?? '', assignees: t.assigned_operator_ids, date: t.scheduled_date, status: t.status,
    remarks: t.remarks ?? '', repeat: 'none', count: 1,
  });

  async function save() {
    if (!draft) return;
    const isCustom = draft.typeKey === '__custom';
    if (isCustom && !draft.custom.trim()) { setMsg('Enter a name for the custom activity.'); return; }
    const activity_type = isCustom ? draft.custom.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30) : draft.typeKey;
    const title = isCustom ? draft.custom.trim() : PRESETS[draft.typeKey];
    const base = {
      organization_id: p.orgId, activity_type, title,
      locations: draft.locations.split(',').map((s) => s.trim()).filter(Boolean), asset: draft.asset.trim() || null,
      assigned_operator_ids: draft.assignees, status: draft.status, remarks: draft.remarks.trim() || null,
      completed_at: draft.status === 'done' ? p.today : null,
    };
    setBusy(true); setMsg('');
    const sb = supabaseBrowser();
    let error;
    if (draft.id) {
      ({ error } = await sb.from('pm_tasks').update({ ...base, scheduled_date: draft.date }).eq('id', draft.id));
    } else {
      const series = `S${Date.now().toString(36)}`;
      const n = draft.repeat === 'none' ? 1 : Math.min(Math.max(draft.count, 1), 60);
      const rows = Array.from({ length: n }, (_, i) => ({
        ...base, legacy_key: `${series}-${i}`,
        scheduled_date: draft.repeat === 'weekly' ? addDays(draft.date, 7 * i) : draft.repeat === 'monthly' ? addMonths(draft.date, i) : draft.date,
      }));
      ({ error } = await sb.from('pm_tasks').insert(rows));
    }
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setDraft(null); router.refresh();
  }

  async function remove(scope: 'one' | 'series' | 'following') {
    if (!draft?.id) return;
    if (!confirm(scope === 'one' ? 'Delete this task?' : scope === 'series' ? 'Delete the whole series?' : 'Delete this and following tasks in the series?')) return;
    const sb = supabaseBrowser();
    const series = draft.legacy_key?.split('-')[0];
    let q = sb.from('pm_tasks').delete();
    if (scope === 'one' || !series) q = q.eq('id', draft.id);
    else { q = q.like('legacy_key', `${series}-%`); if (scope === 'following') q = q.gte('scheduled_date', draft.date); }
    const { error } = await q;
    if (error) { setMsg(error.message); return; }
    setDraft(null); router.refresh();
  }

  async function quickStatus(t: Task, status: Task['status']) {
    setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, status } : x)));
    const { error } = await supabaseBrowser().from('pm_tasks').update({ status, completed_at: status === 'done' ? p.today : null }).eq('id', t.id);
    if (error) { setMsg(error.message); router.refresh(); }
  }

  const counts = { planned: 0, done: 0, postponed: 0 };
  visible.forEach((t) => counts[t.status]++);
  const overdue = visible.filter((t) => t.status === 'planned' && t.scheduled_date < p.today).length;

  return (
    <div style={{ padding: 14 }}>
      <div className="no-print" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', marginBottom: 10 }}>
        <strong>Preventive Maintenance</strong>
        <button className="btn" onClick={() => go(-1)}>‹</button>
        <input type="month" value={p.month} onChange={(e) => e.target.value && router.push(`/pm?m=${e.target.value}`)} style={{ padding: '5px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontWeight: 600 }} />
        <button className="btn" onClick={() => go(1)}>›</button>
        <button className="btn" onClick={() => router.push(`/pm?m=${p.today.slice(0, 7)}`)}>Today</button>
        <select className="btn" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All activities</option>{types.map((t) => <option key={t} value={t}>{label(t)}</option>)}
        </select>
        <select className="btn" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option><option value="planned">Planned</option><option value="done">Done</option><option value="postponed">Postponed</option>
        </select>
        <span style={{ fontSize: 12, color: '#475569' }}>Planned {counts.planned} · Done {counts.done} · Postponed {counts.postponed}{overdue > 0 && <b style={{ color: '#b91c1c' }}> · Overdue {overdue}</b>}</span>
        {msg && <span role="alert" style={{ color: '#b91c1c', fontSize: 12 }}>{msg}</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {p.canEdit && <button className="btn btn-primary" onClick={() => setDraft(blank(p.today.startsWith(p.month) ? p.today : `${p.month}-01`))}>+ New task</button>}
          <button className="btn" onClick={() => window.print()}>Print</button>
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 1, background: '#e2e8f0', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
        {WD.map((d) => <div key={d} style={{ background: '#0f172a', color: '#fff', textAlign: 'center', padding: 5, fontSize: 12, fontWeight: 600 }}>{d}</div>)}
        {cells.map((d, i) => (
          <div key={i} onClick={() => d && p.canEdit && setDraft(blank(d))}
            style={{ background: d ? (d === p.today ? '#eff6ff' : '#fff') : '#f8fafc', minHeight: 96, padding: 4, cursor: d && p.canEdit ? 'pointer' : 'default', outline: d === p.today ? '2px solid #3b82f6' : 'none', outlineOffset: -2 }}>
            {d && <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>{+d.slice(8)}</div>}
            {d && (byDate.get(d) ?? []).map((t) => {
              const [bg, fg] = STATUS_COLOR[t.status];
              return (
                <div key={t.id} onClick={(e) => { e.stopPropagation(); if (p.canEdit) setDraft(edit(t)); }}
                  title={`${t.title}\n${t.locations.join(', ')}${t.asset ? '\n' + t.asset : ''}\n${t.assigned_operator_ids.map((id) => opName.get(id)).filter(Boolean).join(', ')}\n${t.remarks ?? ''}`}
                  style={{ background: bg, color: fg, borderRadius: 4, padding: '2px 4px', margin: '2px 0', fontSize: 10.5, lineHeight: 1.25, cursor: p.canEdit ? 'pointer' : 'default', borderLeft: `3px solid ${fg}`, textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>
                  <b>{t.title}</b>
                  {t.locations.length > 0 && <div style={{ opacity: 0.85 }}>{t.locations.join(', ')}</div>}
                  {p.canEdit && t.status !== 'done' && <button onClick={(e) => { e.stopPropagation(); quickStatus(t, 'done'); }} className="no-print" style={{ fontSize: 9, marginTop: 1, border: 'none', background: 'rgba(255,255,255,.7)', borderRadius: 3, cursor: 'pointer' }}>✓ done</button>}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {draft && (
        <div className="no-print" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'grid', placeItems: 'center', padding: 16, zIndex: 50, overflow: 'auto' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, width: '100%', maxWidth: 480, display: 'grid', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 17 }}>{draft.id ? 'Edit task' : 'New task'}</h2>
            <label style={{ fontSize: 13 }}>Activity
              <select className="input" value={draft.typeKey} onChange={(e) => setDraft({ ...draft, typeKey: e.target.value })}>
                {Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="__custom">+ Custom activity…</option>
              </select></label>
            {draft.typeKey === '__custom' && <input className="input" placeholder="Custom activity name" value={draft.custom} onChange={(e) => setDraft({ ...draft, custom: e.target.value })} />}
            <label style={{ fontSize: 13 }}>Locations / sites (comma-separated)
              <input className="input" value={draft.locations} onChange={(e) => setDraft({ ...draft, locations: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}>Asset <input className="input" value={draft.asset} onChange={(e) => setDraft({ ...draft, asset: e.target.value })} /></label>
            <div style={{ display: 'flex', gap: 8 }}>
              <label style={{ fontSize: 13, flex: 1 }}>Date <input type="date" className="input" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></label>
              <label style={{ fontSize: 13, flex: 1 }}>Status
                <select className="input" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Task['status'] })}>
                  <option value="planned">Planned</option><option value="done">Done</option><option value="postponed">Postponed</option></select></label>
            </div>
            <fieldset style={{ border: '1px solid #e2e8f0', borderRadius: 8, maxHeight: 120, overflow: 'auto', fontSize: 12 }}>
              <legend>Assignees</legend>
              {p.operators.map((o) => (
                <label key={o.id} style={{ display: 'inline-flex', gap: 4, margin: '2px 10px 2px 0' }}>
                  <input type="checkbox" checked={draft.assignees.includes(o.id)} onChange={(e) => setDraft({ ...draft, assignees: e.target.checked ? [...draft.assignees, o.id] : draft.assignees.filter((x) => x !== o.id) })} />{o.full_name}
                </label>))}
            </fieldset>
            <label style={{ fontSize: 13 }}>Remarks <input className="input" value={draft.remarks} onChange={(e) => setDraft({ ...draft, remarks: e.target.value })} /></label>
            {!draft.id && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
                <label style={{ fontSize: 13, flex: 1 }}>Repeat
                  <select className="input" value={draft.repeat} onChange={(e) => setDraft({ ...draft, repeat: e.target.value as Draft['repeat'] })}>
                    <option value="none">Once</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
                {draft.repeat !== 'none' && <label style={{ fontSize: 13, width: 120 }}>Occurrences
                  <input type="number" min={2} max={60} className="input" value={draft.count} onChange={(e) => setDraft({ ...draft, count: +e.target.value })} /></label>}
              </div>)}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {draft.id && <button className="btn" style={{ color: '#b91c1c' }} onClick={() => remove('one')}>Delete</button>}
                {draft.id && draft.legacy_key?.startsWith('S') && <>
                  <button className="btn" style={{ color: '#b91c1c' }} onClick={() => remove('following')}>Delete this &amp; following</button>
                  <button className="btn" style={{ color: '#b91c1c' }} onClick={() => remove('series')}>Delete series</button></>}
              </span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button className="btn" onClick={() => setDraft(null)} disabled={busy}>Cancel</button>
                <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
