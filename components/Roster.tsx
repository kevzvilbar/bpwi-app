'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

type Op = { id: string; full_name: string; position: string | null };
type Shift = {
  id: string;
  code: string;
  description: string | null;
  duration_hours: number;
  background_color: string;
  text_color: string;
  is_off: boolean;
};
type Area = {
  id: string;
  code: string;
  name: string | null;
  category: string;
  background_color: string;
  text_color: string;
};
type Row = {
  operator_id: string;
  schedule_date: string;
  shift_type_id: string | null;
  area_code_id: string | null;
};
type Standby = {
  operator_id: string;
  schedule_date: string;
  standby_type: string;
};

type ToolMode = 'paint' | 'erase' | 'standby';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function cellKey(opId: string, date: string) {
  return `${opId}:${date}`;
}

function csvEscape(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export default function Roster(p: {
  month: string;
  today: string;
  operators: Op[];
  shifts: Shift[];
  areas: Area[];
  rows: Row[];
  standby: Standby[];
  orgId: string;
  role: string;
  userName: string;
  canEdit: boolean;
  initialError?: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(p.rows);
  const [standby, setStandby] = useState<Standby[]>(p.standby);
  const [mode, setMode] = useState<ToolMode>('paint');
  const [shiftId, setShiftId] = useState<string | null>(p.shifts[0]?.id ?? null);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [savingCount, setSavingCount] = useState(0);
  const [msg, setMsg] = useState(p.initialError ?? '');
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState('');

  useEffect(() => {
    setRows(p.rows);
  }, [p.rows]);

  useEffect(() => {
    setStandby(p.standby);
  }, [p.standby]);

  const [y, mo] = p.month.split('-').map(Number);
  const dayCount = new Date(y, mo, 0).getDate();
  const days = useMemo(
    () =>
      Array.from({ length: dayCount }, (_, i) => {
        const date = `${p.month}-${String(i + 1).padStart(2, '0')}`;
        const dow = new Date(y, mo - 1, i + 1).getDay();
        return { date, dayNum: i + 1, dow, dowLabel: WEEKDAYS[dow], isWeekend: dow === 0 || dow === 6 };
      }),
    [dayCount, mo, p.month, y],
  );

  const cell = useMemo(() => new Map(rows.map((r) => [cellKey(r.operator_id, r.schedule_date), r])), [rows]);
  const standbyMap = useMemo(() => new Map(standby.map((s) => [cellKey(s.operator_id, s.schedule_date), s])), [standby]);
  const shiftBy = useMemo(() => new Map(p.shifts.map((s) => [s.id, s])), [p.shifts]);
  const areaBy = useMemo(() => new Map(p.areas.map((a) => [a.id, a])), [p.areas]);

  const filteredOperators = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return p.operators;
    return p.operators.filter(
      (o) => o.full_name.toLowerCase().includes(q) || (o.position ?? '').toLowerCase().includes(q),
    );
  }, [p.operators, search]);

  const go = (d: number) => {
    const t = new Date(y, mo - 1 + d, 1);
    router.push(`/?m=${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`);
  };

  async function handleCellClick(opId: string, date: string) {
    if (!p.canEdit) return;
    setMsg('');

    if (mode === 'standby') {
      const k = cellKey(opId, date);
      const existing = standbyMap.get(k);
      const prev = standby;
      if (existing) {
        setStandby((s) => s.filter((x) => cellKey(x.operator_id, x.schedule_date) !== k));
      } else {
        setStandby((s) => [...s, { operator_id: opId, schedule_date: date, standby_type: 'OC' }]);
      }
      setSavingCount((c) => c + 1);
      const query = existing
        ? supabaseBrowser().from('standby_assignments').delete().eq('operator_id', opId).eq('schedule_date', date)
        : supabaseBrowser()
            .from('standby_assignments')
            .upsert({ organization_id: p.orgId, operator_id: opId, schedule_date: date, standby_type: 'OC' }, { onConflict: 'operator_id,schedule_date' });
      const { error } = await query;
      setSavingCount((c) => c - 1);
      if (error) {
        setStandby(prev);
        setMsg(error.message);
      }
      return;
    }

    if (mode === 'erase') {
      const k = cellKey(opId, date);
      const prev = rows;
      setRows((r) => r.filter((x) => cellKey(x.operator_id, x.schedule_date) !== k));
      setSavingCount((c) => c + 1);
      const { error } = await supabaseBrowser()
        .from('schedule_assignments')
        .delete()
        .eq('operator_id', opId)
        .eq('schedule_date', date);
      setSavingCount((c) => c - 1);
      if (error) {
        setRows(prev);
        setMsg(error.message);
      }
      return;
    }

    if (!shiftId) return;
    const prev = rows;
    const row: Row = { operator_id: opId, schedule_date: date, shift_type_id: shiftId, area_code_id: areaId };
    setRows((r) => [...r.filter((x) => !(x.operator_id === opId && x.schedule_date === date)), row]);
    setSavingCount((c) => c + 1);
    const { error } = await supabaseBrowser()
      .from('schedule_assignments')
      .upsert({ ...row, organization_id: p.orgId }, { onConflict: 'operator_id,schedule_date' });
    setSavingCount((c) => c - 1);
    if (error) {
      setRows(prev);
      setMsg(error.message);
    }
  }

  function exportCsv() {
    const header = ['Operator', 'Position', ...days.map((d) => d.date), 'Work Days', 'Off Days', 'Hours'];
    const lines = [header.map(csvEscape).join(',')];

    for (const o of filteredOperators) {
      let work = 0;
      let off = 0;
      let hrs = 0;
      const cols = days.map((d) => {
        const k = cellKey(o.id, d.date);
        const r = cell.get(k);
        const s = r?.shift_type_id ? shiftBy.get(r.shift_type_id) : undefined;
        const a = r?.area_code_id ? areaBy.get(r.area_code_id) : undefined;
        const oc = standbyMap.has(k) ? '(OC)' : '';
        if (s) {
          if (s.is_off) off += 1;
          else work += 1;
          hrs += Number(s.duration_hours ?? 0);
        }
        return [s?.code ?? '', a?.code ?? '', oc].filter(Boolean).join(' ');
      });
      lines.push(
        [o.full_name, o.position ?? '', ...cols, String(work), String(off), String(hrs)].map(csvEscape).join(','),
      );
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bpwi-roster-${p.month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportStatus('');
    try {
      const text = await file.text();
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: text,
      });
      const json = await res.json();
      if (!res.ok) {
        setImportStatus(`Error: ${json.error ?? res.statusText}`);
      } else {
        setImportStatus(
          `Imported ${json.operators} operators, ${json.shifts} shifts, ${json.areas} areas, ${json.assignments} assignments, ${json.standby} standby, ${json.pm_tasks} PM tasks.`,
        );
        router.refresh();
      }
    } catch (err: any) {
      setImportStatus(`Error: ${err?.message ?? 'Failed to import file'}`);
    } finally {
      setImporting(false);
    }
  }

  const dailyWorkingCounts = useMemo(
    () =>
      days.map((d) => {
        let count = 0;
        for (const o of filteredOperators) {
          const r = cell.get(cellKey(o.id, d.date));
          const s = r?.shift_type_id ? shiftBy.get(r.shift_type_id) : undefined;
          if (s && !s.is_off) count += 1;
        }
        return count;
      }),
    [cell, days, filteredOperators, shiftBy],
  );

  return (
    <div style={{ padding: 14, maxWidth: '100%', minHeight: '100vh' }}>
      <header
        className="no-print"
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 10,
          padding: '10px 14px',
          background: '#ffffff',
          borderRadius: 10,
          border: '1px solid #e2e8f0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ fontSize: 15 }}>BP Waterworks · Plant Operations Schedule</strong>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 999,
              background: p.canEdit ? '#dbeafe' : '#f1f5f9',
              color: p.canEdit ? '#1d4ed8' : '#475569',
              textTransform: 'uppercase',
            }}
          >
            {p.role}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="btn" onClick={() => go(-1)} title="Previous month">
            ‹
          </button>
          <input
            type="month"
            value={p.month}
            onChange={(e) => e.target.value && router.push(`/?m=${e.target.value}`)}
            style={{
              padding: '5px 8px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              fontSize: 13,
              fontWeight: 600,
            }}
          />
          <button className="btn" onClick={() => go(1)} title="Next month">
            ›
          </button>
          <button className="btn" onClick={() => router.push(`/?m=${p.today.slice(0, 7)}`)}>
            Today
          </button>
        </div>

        <input
          type="search"
          placeholder="Filter operator…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: '5px 10px',
            borderRadius: 6,
            border: '1px solid #cbd5e1',
            fontSize: 13,
            width: 170,
          }}
        />

        {savingCount > 0 && <span style={{ fontSize: 12, color: '#2563eb', fontWeight: 500 }}>Saving…</span>}
        {msg && (
          <span role="alert" style={{ fontSize: 12, color: '#b91c1c', fontWeight: 500 }}>
            {msg}
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {p.userName && <span style={{ fontSize: 12, color: '#64748b', marginRight: 4 }}>{p.userName}</span>}
          <button className="btn" onClick={exportCsv}>
            Export CSV
          </button>
          <button className="btn" onClick={() => window.print()}>
            Print
          </button>
          {p.role === 'admin' && (
            <button
              className="btn"
              onClick={() => {
                setImportStatus('');
                setImportOpen(true);
              }}
            >
              Import JSON
            </button>
          )}
          <button
            className="btn"
            onClick={async () => {
              await supabaseBrowser().auth.signOut();
              window.location.href = '/login';
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {!p.orgId && (
        <div
          className="no-print"
          role="status"
          style={{
            marginBottom: 10,
            padding: '10px 14px',
            borderRadius: 8,
            background: '#fffbeb',
            border: '1px solid #fde68a',
            color: '#92400e',
            fontSize: 13,
          }}
        >
          Your account is signed in, but not yet linked to an organization in <code>user_profiles</code>. Ask an admin to assign your account, or run the first-time bootstrap SQL in <code>supabase/migrations/001_init.sql</code>.
        </div>
      )}

      {p.canEdit && (
        <div
          className="no-print"
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            alignItems: 'center',
            marginBottom: 10,
            padding: '8px 12px',
            background: '#ffffff',
            borderRadius: 10,
            border: '1px solid #e2e8f0',
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Shifts:</span>
          {p.shifts.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setMode('paint');
                setShiftId(s.id);
              }}
              title={s.description ?? ''}
              style={{
                padding: '4px 9px',
                borderRadius: 5,
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                background: s.background_color,
                color: s.text_color,
                border: mode === 'paint' && shiftId === s.id ? '2px solid #2563eb' : '1px solid #cbd5e1',
                boxShadow: mode === 'paint' && shiftId === s.id ? '0 0 0 1px #2563eb' : 'none',
              }}
            >
              {s.code}
            </button>
          ))}

          <span style={{ width: 1, height: 20, background: '#e2e8f0', margin: '0 4px' }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Area / Leave:</span>
          <button
            onClick={() => {
              setMode('paint');
              setAreaId(null);
            }}
            style={{
              padding: '4px 8px',
              borderRadius: 5,
              fontSize: 12,
              cursor: 'pointer',
              background: '#ffffff',
              border: mode === 'paint' && areaId === null ? '2px solid #2563eb' : '1px solid #cbd5e1',
            }}
          >
            (none)
          </button>
          {p.areas.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                setMode('paint');
                setAreaId(a.id);
              }}
              title={a.name ?? ''}
              style={{
                padding: '4px 8px',
                borderRadius: 5,
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                background: a.background_color,
                color: a.text_color,
                border: mode === 'paint' && areaId === a.id ? '2px solid #2563eb' : '1px solid #cbd5e1',
              }}
            >
              {a.code}
            </button>
          ))}

          <span style={{ width: 1, height: 20, background: '#e2e8f0', margin: '0 4px' }} />
          <button
            className="btn"
            onClick={() => setMode(mode === 'standby' ? 'paint' : 'standby')}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              border: mode === 'standby' ? '2px solid #d97706' : '1px solid #cbd5e1',
              background: mode === 'standby' ? '#fef3c7' : '#ffffff',
              color: mode === 'standby' ? '#92400e' : '#0f172a',
              fontWeight: 600,
            }}
            title="Toggle On-Call (OC) standby badge"
          >
            OC Standby
          </button>
          <button
            className="btn"
            onClick={() => setMode(mode === 'erase' ? 'paint' : 'erase')}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              border: mode === 'erase' ? '2px solid #dc2626' : '1px solid #cbd5e1',
              background: mode === 'erase' ? '#fee2e2' : '#ffffff',
              color: mode === 'erase' ? '#991b1b' : '#0f172a',
              fontWeight: 600,
            }}
            title="Click a cell to clear its shift assignment"
          >
            Clear Cell
          </button>
        </div>
      )}

      <div
        style={{
          overflow: 'auto',
          maxHeight: '78vh',
          background: '#ffffff',
          borderRadius: 10,
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 4px rgba(15, 23, 42, 0.04)',
        }}
      >
        <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
          <thead>
            <tr>
              <th
                style={{
                  position: 'sticky',
                  left: 0,
                  top: 0,
                  zIndex: 3,
                  background: '#0f172a',
                  color: '#ffffff',
                  padding: '6px 8px',
                  minWidth: 180,
                  textAlign: 'left',
                  borderRight: '1px solid #334155',
                }}
              >
                Operator ({filteredOperators.length})
              </th>
              {days.map((d) => {
                const isToday = d.date === p.today;
                return (
                  <th
                    key={d.date}
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 2,
                      background: isToday ? '#1d4ed8' : d.isWeekend ? '#1e293b' : '#0f172a',
                      color: '#ffffff',
                      minWidth: 36,
                      padding: '4px 2px',
                      textAlign: 'center',
                      borderRight: '1px solid #334155',
                    }}
                  >
                    <div>{d.dayNum}</div>
                    <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.8 }}>{d.dowLabel}</div>
                  </th>
                );
              })}
              <th
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 2,
                  background: '#0f172a',
                  color: '#ffffff',
                  padding: '4px 6px',
                  minWidth: 42,
                }}
              >
                Work
              </th>
              <th
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 2,
                  background: '#0f172a',
                  color: '#ffffff',
                  padding: '4px 6px',
                  minWidth: 38,
                }}
              >
                Off
              </th>
              <th
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 2,
                  background: '#0f172a',
                  color: '#ffffff',
                  padding: '4px 6px',
                  minWidth: 42,
                }}
              >
                Hrs
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredOperators.length === 0 ? (
              <tr>
                <td colSpan={days.length + 4} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                  No operators found{p.operators.length === 0 ? '. Import data or add operators in Supabase.' : '.'}
                </td>
              </tr>
            ) : (
              filteredOperators.map((o) => {
                let work = 0;
                let off = 0;
                let hrs = 0;
                return (
                  <tr key={o.id}>
                    <td
                      style={{
                        position: 'sticky',
                        left: 0,
                        zIndex: 1,
                        background: '#ffffff',
                        padding: '4px 8px',
                        fontWeight: 600,
                        borderBottom: '1px solid #e2e8f0',
                        borderRight: '1px solid #cbd5e1',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <div>{o.full_name}</div>
                      {o.position && <div style={{ fontSize: 10, fontWeight: 400, color: '#64748b' }}>{o.position}</div>}
                    </td>
                    {days.map((d) => {
                      const k = cellKey(o.id, d.date);
                      const r = cell.get(k);
                      const s = r?.shift_type_id ? shiftBy.get(r.shift_type_id) : undefined;
                      const a = r?.area_code_id ? areaBy.get(r.area_code_id) : undefined;
                      const isOc = standbyMap.has(k);
                      if (s) {
                        if (s.is_off) off += 1;
                        else work += 1;
                        hrs += Number(s.duration_hours ?? 0);
                      }
                      const bg =
                        a && a.background_color !== '#f1f5f9' && s?.is_off
                          ? a.background_color
                          : s?.background_color ?? (d.isWeekend ? '#f8fafc' : '#ffffff');
                      const fg = a && s?.is_off ? a.text_color : s?.text_color ?? '#94a3b8';

                      return (
                        <td
                          key={d.date}
                          onClick={() => handleCellClick(o.id, d.date)}
                          title={`${o.full_name} • ${d.date}${s ? ` • ${s.code}` : ''}${a ? ` • ${a.code}` : ''}${isOc ? ' • On-Call' : ''}`}
                          style={{
                            position: 'relative',
                            textAlign: 'center',
                            borderBottom: '1px solid #e2e8f0',
                            borderRight: d.date === p.today ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                            cursor: p.canEdit ? 'pointer' : 'default',
                            height: 28,
                            background: bg,
                            color: fg,
                            fontWeight: 800,
                            userSelect: 'none',
                          }}
                        >
                          {a?.code ?? ''}
                          {isOc && (
                            <span
                              style={{
                                position: 'absolute',
                                top: 1,
                                right: 1,
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                background: '#d97706',
                              }}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'center', borderBottom: '1px solid #e2e8f0', borderRight: '1px solid #e2e8f0', fontWeight: 600 }}>
                      {work}
                    </td>
                    <td style={{ textAlign: 'center', borderBottom: '1px solid #e2e8f0', borderRight: '1px solid #e2e8f0', color: '#64748b' }}>
                      {off}
                    </td>
                    <td style={{ textAlign: 'center', borderBottom: '1px solid #e2e8f0', fontWeight: 600 }}>{hrs}</td>
                  </tr>
                );
              })
            )}
          </tbody>
          {filteredOperators.length > 0 && (
            <tfoot>
              <tr>
                <td
                  style={{
                    position: 'sticky',
                    left: 0,
                    bottom: 0,
                    zIndex: 2,
                    background: '#f8fafc',
                    padding: '5px 8px',
                    fontWeight: 700,
                    borderTop: '2px solid #cbd5e1',
                    borderRight: '1px solid #cbd5e1',
                  }}
                >
                  On Duty Count
                </td>
                {dailyWorkingCounts.map((cnt, idx) => (
                  <td
                    key={days[idx].date}
                    style={{
                      position: 'sticky',
                      bottom: 0,
                      background: '#f8fafc',
                      textAlign: 'center',
                      fontWeight: 700,
                      color: cnt === 0 ? '#94a3b8' : '#0f172a',
                      borderTop: '2px solid #cbd5e1',
                      borderRight: '1px solid #e2e8f0',
                      padding: '5px 2px',
                    }}
                  >
                    {cnt}
                  </td>
                ))}
                <td colSpan={3} style={{ position: 'sticky', bottom: 0, background: '#f8fafc', borderTop: '2px solid #cbd5e1' }} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {importOpen && (
        <div
          className="no-print"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'grid',
            placeItems: 'center',
            padding: 16,
          }}
        >
          <div style={{ width: '100%', maxWidth: 440, background: '#ffffff', borderRadius: 12, padding: 22, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 17 }}>Import Legacy JSON Backup</h2>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: '#64748b' }}>
              Select a JSON backup exported from the standalone HTML app. Existing records are safely upserted.
            </p>
            <input type="file" accept=".json,application/json" onChange={handleImportFile} disabled={importing} />
            {importing && <p style={{ fontSize: 13, color: '#2563eb', margin: '10px 0 0' }}>Importing…</p>}
            {importStatus && (
              <p
                style={{
                  fontSize: 13,
                  margin: '10px 0 0',
                  color: importStatus.startsWith('Error:') ? '#b91c1c' : '#15803d',
                }}
              >
                {importStatus}
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <button className="btn" onClick={() => setImportOpen(false)} disabled={importing}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
