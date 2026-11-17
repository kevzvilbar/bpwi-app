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
type PmMarkTask = {
  scheduled_date: string;
  assigned_operator_ids: string[];
  status: string;
  title: string;
};

type ToolMode = 'paint' | 'erase' | 'standby';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

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
  pmTasks: PmMarkTask[];
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
  const [standbyType, setStandbyType] = useState<'OC' | 'DWP' | 'ERP'>('OC');
  const [shiftId, setShiftId] = useState<string | null>(p.shifts[0]?.id ?? null);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [savingCount, setSavingCount] = useState(0);
  const [msg, setMsg] = useState(p.initialError ?? '');
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; opId: string; opName: string; date: string } | null>(null);

  useEffect(() => {
    setRows(p.rows);
  }, [p.rows]);

  useEffect(() => {
    setStandby(p.standby);
  }, [p.standby]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [ctxMenu]);

  const [y, mo] = p.month.split('-').map(Number);
  const monthLabel = `${MONTHS_FULL[(mo - 1 + 12) % 12]} ${y}`;
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

  const pmByCell = useMemo(() => {
    const m = new Map<string, { titles: string[]; warn: boolean }>();
    for (const t of p.pmTasks) {
      const warn = t.status === 'planned' && t.scheduled_date < p.today;
      for (const opId of t.assigned_operator_ids ?? []) {
        const k = cellKey(opId, t.scheduled_date);
        const cur = m.get(k);
        if (cur) {
          cur.titles.push(t.title);
          if (warn) cur.warn = true;
        } else {
          m.set(k, { titles: [t.title], warn });
        }
      }
    }
    return m;
  }, [p.pmTasks, p.today]);

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

  async function setStandbyValue(opId: string, date: string, nextType: string | null) {
    if (!p.canEdit) return;
    setMsg('');
    const k = cellKey(opId, date);
    const prev = standby;
    if (nextType === null) {
      setStandby((s) => s.filter((x) => cellKey(x.operator_id, x.schedule_date) !== k));
    } else {
      setStandby((s) => [
        ...s.filter((x) => cellKey(x.operator_id, x.schedule_date) !== k),
        { operator_id: opId, schedule_date: date, standby_type: nextType },
      ]);
    }
    setSavingCount((c) => c + 1);
    const query =
      nextType === null
        ? supabaseBrowser().from('standby_assignments').delete().eq('operator_id', opId).eq('schedule_date', date)
        : supabaseBrowser()
            .from('standby_assignments')
            .upsert(
              { organization_id: p.orgId, operator_id: opId, schedule_date: date, standby_type: nextType },
              { onConflict: 'operator_id,schedule_date' },
            );
    const { error } = await query;
    setSavingCount((c) => c - 1);
    if (error) {
      setStandby(prev);
      setMsg(error.message);
    }
  }

  async function clearCell(opId: string, date: string) {
    if (!p.canEdit) return;
    setMsg('');
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
  }

  async function fillRight(opId: string, fromDate: string) {
    if (!p.canEdit) return;
    const source = cell.get(cellKey(opId, fromDate));
    if (!source) {
      setMsg('Select a cell with an assignment before filling right.');
      return;
    }
    const targets = days.filter((d) => d.date >= fromDate).map((d) => d.date);
    const payload = targets.map((date) => ({
      organization_id: p.orgId,
      operator_id: opId,
      schedule_date: date,
      shift_type_id: source.shift_type_id,
      area_code_id: source.area_code_id,
    }));
    const prev = rows;
    const targetSet = new Set(targets);
    setRows((r) => [
      ...r.filter((x) => !(x.operator_id === opId && targetSet.has(x.schedule_date))),
      ...payload.map(({ operator_id, schedule_date, shift_type_id, area_code_id }) => ({
        operator_id,
        schedule_date,
        shift_type_id,
        area_code_id,
      })),
    ]);
    setSavingCount((c) => c + 1);
    const { error } = await supabaseBrowser()
      .from('schedule_assignments')
      .upsert(payload, { onConflict: 'operator_id,schedule_date' });
    setSavingCount((c) => c - 1);
    if (error) {
      setRows(prev);
      setMsg(error.message);
    }
  }

  async function handleCellClick(opId: string, date: string) {
    if (!p.canEdit) return;
    setMsg('');

    if (mode === 'standby') {
      const existing = standbyMap.get(cellKey(opId, date));
      await setStandbyValue(opId, date, existing?.standby_type === standbyType ? null : standbyType);
      return;
    }

    if (mode === 'erase') {
      await clearCell(opId, date);
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
    const header = ['Operator', 'Position', ...days.map((d) => d.date), 'Duty', 'OC', 'Hours', 'Off', 'Leaves'];
    const lines = [header.map(csvEscape).join(',')];

    for (const o of filteredOperators) {
      let duty = 0;
      let ocCount = 0;
      let off = 0;
      let leaves = 0;
      let hrs = 0;
      const cols = days.map((d) => {
        const k = cellKey(o.id, d.date);
        const r = cell.get(k);
        const s = r?.shift_type_id ? shiftBy.get(r.shift_type_id) : undefined;
        const a = r?.area_code_id ? areaBy.get(r.area_code_id) : undefined;
        const sb = standbyMap.get(k);
        if (sb) ocCount += 1;
        if (a?.category === 'leave') leaves += 1;
        if (s) {
          if (s.is_off) off += 1;
          else duty += 1;
          hrs += Number(s.duration_hours ?? 0);
        }
        return [s?.code ?? '', a?.code ?? '', sb ? `(${sb.standby_type})` : ''].filter(Boolean).join(' ');
      });
      lines.push(
        [o.full_name, o.position ?? '', ...cols, String(duty), String(ocCount), String(hrs), String(off), String(leaves)]
          .map(csvEscape)
          .join(','),
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
    <div style={{ padding: '10px 14px 16px', maxWidth: '100%' }}>
      {/* Action & Filter Bar */}
      <header
        className="no-print"
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 8,
          padding: '8px 12px',
          background: '#ffffff',
          borderRadius: 10,
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="btn" onClick={() => go(-1)} title="Previous month">
            ‹
          </button>
          <input
            type="month"
            value={p.month}
            onChange={(e) => e.target.value && router.push(`/?m=${e.target.value}`)}
            style={{
              padding: '4px 8px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              fontSize: 12.5,
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
          id="filterInput"
          type="search"
          placeholder="Filter operator…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: '5px 10px',
            borderRadius: 6,
            border: '1px solid #cbd5e1',
            fontSize: 12.5,
            width: 170,
          }}
        />

        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 999,
            background: p.canEdit ? '#dbeafe' : '#f1f5f9',
            color: p.canEdit ? '#1d4ed8' : '#475569',
            textTransform: 'uppercase',
          }}
        >
          {p.role}
        </span>

        {savingCount > 0 && <span style={{ fontSize: 12, color: '#2563eb', fontWeight: 600 }}>Saving…</span>}
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
            marginBottom: 8,
            padding: '10px 14px',
            borderRadius: 8,
            background: '#fffbeb',
            border: '1px solid #fde68a',
            color: '#92400e',
            fontSize: 12.5,
          }}
        >
          Your account is signed in, but not yet linked to an organization in <code>user_profiles</code>. Run{' '}
          <code>001_init.sql</code> and <code>002_auto_profile.sql</code> in Supabase SQL Editor, then refresh.
        </div>
      )}

      {/* Paint Palette Bar */}
      {p.canEdit && (
        <div
          className="no-print"
          style={{
            display: 'flex',
            gap: 5,
            flexWrap: 'wrap',
            alignItems: 'center',
            marginBottom: 8,
            padding: '7px 12px',
            background: '#ffffff',
            borderRadius: 10,
            border: '1px solid #e2e8f0',
          }}
        >
          <span style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Shifts:</span>
          {p.shifts.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setMode('paint');
                setShiftId(s.id);
              }}
              title={s.description ?? ''}
              style={{
                padding: '3px 8px',
                borderRadius: 5,
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
                background: s.background_color,
                color: s.text_color,
                border: mode === 'paint' && shiftId === s.id ? '2px solid #2563eb' : '1px solid #cbd5e1',
              }}
            >
              {s.code}
            </button>
          ))}

          <span style={{ width: 1, height: 18, background: '#e2e8f0', margin: '0 3px' }} />
          <span style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
            Area / Leave:
          </span>
          <button
            onClick={() => {
              setMode('paint');
              setAreaId(null);
            }}
            style={{
              padding: '3px 7px',
              borderRadius: 5,
              fontSize: 11.5,
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
              className={a.category === 'leave' ? 'cell-leave' : undefined}
              style={{
                padding: '3px 7px',
                borderRadius: 5,
                fontSize: 11.5,
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

          <span style={{ width: 1, height: 18, background: '#e2e8f0', margin: '0 3px' }} />
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <button
              className="btn"
              onClick={() => setMode(mode === 'standby' ? 'paint' : 'standby')}
              style={{
                padding: '3px 9px',
                fontSize: 11.5,
                border: mode === 'standby' ? '2px solid #7c3aed' : '1px solid #cbd5e1',
                background: mode === 'standby' ? '#f5f3ff' : '#ffffff',
                color: mode === 'standby' ? '#6d28d9' : '#0f172a',
                fontWeight: 700,
              }}
              title="Toggle Standby overlay (right-click any cell for quick actions)"
            >
              ⚡ Standby ({standbyType})
            </button>
            {mode === 'standby' && (
              <select
                value={standbyType}
                onChange={(e) => setStandbyType(e.target.value as 'OC' | 'DWP' | 'ERP')}
                style={{
                  padding: '3px 6px',
                  borderRadius: 5,
                  border: '1px solid #c4b5fd',
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: '#6d28d9',
                  background: '#f5f3ff',
                }}
              >
                <option value="OC">OC · General</option>
                <option value="DWP">DWP · Deep Well</option>
                <option value="ERP">ERP · Electro-Mech</option>
              </select>
            )}
          </div>

          <button
            className="btn"
            onClick={() => setMode(mode === 'erase' ? 'paint' : 'erase')}
            style={{
              padding: '3px 9px',
              fontSize: 11.5,
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

      {/* Spreadsheet Schedule Table */}
      <div
        className="schedule-container"
        style={{
          overflow: 'auto',
          maxHeight: '76vh',
          background: '#ffffff',
          borderRadius: 10,
          border: '1px solid #cbd5e1',
          boxShadow: '0 1px 4px rgba(15, 23, 42, 0.05)',
        }}
      >
        <table className="schedule-table">
          <thead>
            {/* Row 1: Month Banner + Summary Group */}
            <tr style={{ height: 26 }}>
              <th
                rowSpan={2}
                className="sticky-corner-idx"
                style={{
                  background: '#0f172a',
                  color: '#94a3b8',
                  width: 36,
                  minWidth: 36,
                  textAlign: 'center',
                  fontSize: 10,
                }}
              >
                #
              </th>
              <th
                rowSpan={2}
                className="sticky-corner-name"
                style={{
                  background: '#0f172a',
                  color: '#ffffff',
                  minWidth: 165,
                  padding: '4px 8px',
                  textAlign: 'left',
                }}
              >
                Operator ({filteredOperators.length})
              </th>
              <th
                colSpan={days.length}
                className="sticky-header-month"
                style={{
                  background: '#0f172a',
                  color: '#e2e8f0',
                  padding: '4px 8px',
                  textAlign: 'center',
                  fontSize: 11.5,
                  letterSpacing: '0.03em',
                  textTransform: 'uppercase',
                }}
              >
                {monthLabel}
              </th>
              <th
                rowSpan={2}
                className="sticky-corner-stat sticky-col-duty"
                style={{ background: '#0f172a', color: '#ffffff', width: 42, minWidth: 42, textAlign: 'center' }}
                title="Duty Days"
              >
                Duty
              </th>
              <th
                rowSpan={2}
                className="sticky-corner-stat sticky-col-oc"
                style={{ background: '#4c1d95', color: '#ede9fe', width: 42, minWidth: 42, textAlign: 'center' }}
                title="On-Call / Standby Days"
              >
                OC
              </th>
              <th
                rowSpan={2}
                className="sticky-corner-stat sticky-col-hours"
                style={{ background: '#0f172a', color: '#ffffff', width: 42, minWidth: 42, textAlign: 'center' }}
                title="Total Duty Hours"
              >
                Hrs
              </th>
              <th
                rowSpan={2}
                className="sticky-corner-stat sticky-col-off"
                style={{ background: '#0f172a', color: '#94a3b8', width: 42, minWidth: 42, textAlign: 'center' }}
                title="Rest / Off Days"
              >
                Off
              </th>
              <th
                rowSpan={2}
                className="sticky-corner-stat sticky-col-leaves"
                style={{ background: '#0f172a', color: '#fde68a', width: 42, minWidth: 42, textAlign: 'center' }}
                title="Leave Days"
              >
                Lvs
              </th>
            </tr>

            {/* Row 2: Day Number + Weekday */}
            <tr>
              {days.map((d) => {
                const isToday = d.date === p.today;
                return (
                  <th
                    key={d.date}
                    className="sticky-header-days"
                    style={{
                      background: isToday ? '#1d4ed8' : d.isWeekend ? '#1e293b' : '#0f172a',
                      color: '#ffffff',
                      minWidth: 34,
                      padding: '3px 2px',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ lineHeight: 1.1 }}>{d.dayNum}</div>
                    <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.78 }}>{d.dowLabel}</div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {filteredOperators.length === 0 ? (
              <tr>
                <td colSpan={days.length + 7} style={{ padding: 28, textAlign: 'center', color: '#64748b', background: '#fff' }}>
                  No operators found{p.operators.length === 0 ? '. Import data or add operators under Operators & Setup.' : '.'}
                </td>
              </tr>
            ) : (
              filteredOperators.map((o, idx) => {
                let duty = 0;
                let ocCount = 0;
                let hrs = 0;
                let off = 0;
                let leaves = 0;

                return (
                  <tr key={o.id} className="operator-row">
                    <td
                      className="sticky-col-idx"
                      style={{
                        background: '#f8fafc',
                        color: '#64748b',
                        textAlign: 'center',
                        fontSize: 10,
                        fontWeight: 600,
                      }}
                    >
                      {idx + 1}
                    </td>
                    <td
                      className="sticky-col-name"
                      style={{
                        background: '#ffffff',
                        padding: '3px 8px',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <div style={{ color: '#0f172a' }}>{o.full_name}</div>
                      {o.position && <div style={{ fontSize: 9.5, fontWeight: 400, color: '#64748b' }}>{o.position}</div>}
                    </td>

                    {days.map((d) => {
                      const k = cellKey(o.id, d.date);
                      const r = cell.get(k);
                      const s = r?.shift_type_id ? shiftBy.get(r.shift_type_id) : undefined;
                      const a = r?.area_code_id ? areaBy.get(r.area_code_id) : undefined;
                      const sb = standbyMap.get(k);
                      const pm = pmByCell.get(k);

                      if (sb) ocCount += 1;
                      if (a?.category === 'leave') leaves += 1;
                      if (s) {
                        if (s.is_off) off += 1;
                        else duty += 1;
                        hrs += Number(s.duration_hours ?? 0);
                      }

                      const isLeave = a?.category === 'leave';
                      const bg =
                        a && a.background_color !== '#f1f5f9' && (s?.is_off || !s)
                          ? a.background_color
                          : s?.background_color ?? (sb ? '#f5f3ff' : d.isWeekend ? '#f8fafc' : '#ffffff');
                      const fg =
                        a && (s?.is_off || !s) ? a.text_color : s?.text_color ?? (sb ? '#6d28d9' : '#94a3b8');

                      const classes = [isLeave ? 'cell-leave' : '', sb ? 'cell-oncall-active' : ''].filter(Boolean).join(' ');

                      return (
                        <td
                          key={d.date}
                          className={classes || undefined}
                          onClick={() => handleCellClick(o.id, d.date)}
                          onContextMenu={(e) => {
                            if (!p.canEdit) return;
                            e.preventDefault();
                            setCtxMenu({ x: e.clientX, y: e.clientY, opId: o.id, opName: o.full_name, date: d.date });
                          }}
                          title={[
                            `${o.full_name} • ${d.date}`,
                            s ? `${s.code}${s.description ? ` (${s.description})` : ''}` : null,
                            a ? `${a.code}${a.name ? ` (${a.name})` : ''}` : null,
                            sb ? `Standby: ${sb.standby_type}` : null,
                            pm ? `PM: ${pm.titles.join(', ')}` : null,
                          ]
                            .filter(Boolean)
                            .join('\n')}
                          style={{
                            position: 'relative',
                            textAlign: 'center',
                            cursor: p.canEdit ? 'pointer' : 'default',
                            height: 27,
                            background: bg,
                            color: fg,
                            fontWeight: 800,
                            outline: d.date === p.today ? '1.5px solid #3b82f6' : undefined,
                            outlineOffset: -1.5,
                          }}
                        >
                          {a?.code ?? ''}
                          {sb && (
                            <>
                              <span className="oncall-corner-triangle" />
                              <span className="oncall-icon-mark">{sb.standby_type === 'OC' ? 'OC' : sb.standby_type[0]}</span>
                            </>
                          )}
                          {pm && <span className={`pm-mark${pm.warn ? ' warn' : ''}`} />}
                        </td>
                      );
                    })}

                    <td className="sticky-col-duty" style={{ background: '#ffffff', textAlign: 'center', fontWeight: 700 }}>
                      {duty}
                    </td>
                    <td
                      className="sticky-col-oc"
                      style={{
                        background: ocCount ? '#f5f3ff' : '#ffffff',
                        color: ocCount ? '#6d28d9' : '#cbd5e1',
                        textAlign: 'center',
                        fontWeight: 700,
                      }}
                    >
                      {ocCount}
                    </td>
                    <td className="sticky-col-hours" style={{ background: '#ffffff', textAlign: 'center', fontWeight: 600 }}>
                      {hrs}
                    </td>
                    <td className="sticky-col-off" style={{ background: '#ffffff', textAlign: 'center', color: '#64748b' }}>
                      {off}
                    </td>
                    <td
                      className="sticky-col-leaves"
                      style={{
                        background: leaves ? '#fefce8' : '#ffffff',
                        color: leaves ? '#854d0e' : '#cbd5e1',
                        textAlign: 'center',
                        fontWeight: 700,
                      }}
                    >
                      {leaves}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>

          {filteredOperators.length > 0 && (
            <tfoot>
              <tr>
                <td
                  colSpan={2}
                  className="sticky-col-idx"
                  style={{
                    position: 'sticky',
                    bottom: 0,
                    zIndex: 30,
                    background: '#f8fafc',
                    padding: '5px 8px',
                    fontWeight: 700,
                    borderTop: '2px solid #94a3b8',
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
                      zIndex: 20,
                      background: '#f8fafc',
                      textAlign: 'center',
                      fontWeight: 700,
                      color: cnt === 0 ? '#94a3b8' : '#0f172a',
                      borderTop: '2px solid #94a3b8',
                      padding: '5px 2px',
                    }}
                  >
                    {cnt}
                  </td>
                ))}
                <td colSpan={5} style={{ position: 'sticky', bottom: 0, zIndex: 20, background: '#f8fafc', borderTop: '2px solid #94a3b8' }} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Legend Strip */}
      <div
        className="no-print"
        style={{
          marginTop: 8,
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
          alignItems: 'center',
          fontSize: 11.5,
          color: '#475569',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              background: '#f5f3ff',
              boxShadow: 'inset 0 0 0 2px #7c3aed',
              display: 'inline-block',
            }}
          />
          Violet ring + corner = On-Call / Standby (OC/DWP/ERP)
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span
            className="cell-leave"
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              backgroundColor: '#fef3c7',
              border: '1px solid #cbd5e1',
              display: 'inline-block',
            }}
          />
          Diagonal stripe = Leave day
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: '#0f766e', display: 'inline-block' }} />
          Teal / Rose dot = PM task scheduled / overdue
        </span>
        {p.canEdit && <span style={{ color: '#64748b' }}>Tip: right-click any cell for standby &amp; fill-right actions.</span>}
      </div>

      {/* Right-Click Context Menu */}
      {ctxMenu && (
        <div
          className="no-print"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: Math.min(ctxMenu.y, window.innerHeight - 250),
            left: Math.min(ctxMenu.x, window.innerWidth - 240),
            zIndex: 60,
            width: 230,
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            boxShadow: '0 10px 25px rgba(15, 23, 42, 0.18)',
            padding: '4px 0',
            fontSize: 12,
          }}
        >
          <div
            style={{
              padding: '5px 10px',
              borderBottom: '1px solid #f1f5f9',
              fontSize: 10.5,
              fontWeight: 700,
              color: '#64748b',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>CELL ACTIONS</span>
            <span style={{ color: '#2563eb' }}>
              {ctxMenu.opName.split(' ')[0]} · {ctxMenu.date.slice(5)}
            </span>
          </div>
          {[
            { label: '⚡ Set General On-Call (OC)', fn: () => setStandbyValue(ctxMenu.opId, ctxMenu.date, 'OC'), color: '#5b21b6' },
            { label: '🔧 Deep Well Standby (DWP)', fn: () => setStandbyValue(ctxMenu.opId, ctxMenu.date, 'DWP'), color: '#5b21b6' },
            { label: '⚙ Electro-Mech Repair (ERP)', fn: () => setStandbyValue(ctxMenu.opId, ctxMenu.date, 'ERP'), color: '#5b21b6' },
            { label: '⊘ Remove Standby', fn: () => setStandbyValue(ctxMenu.opId, ctxMenu.date, null), color: '#475569' },
            { label: '→ Fill Right to Month End', fn: () => fillRight(ctxMenu.opId, ctxMenu.date), color: '#0f172a' },
            { label: '✕ Clear Shift (No Duty)', fn: () => clearCell(ctxMenu.opId, ctxMenu.date), color: '#b91c1c' },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => {
                setCtxMenu(null);
                item.fn();
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 12px',
                border: 'none',
                background: 'transparent',
                color: item.color,
                cursor: 'pointer',
                fontWeight: 500,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* Import JSON Modal */}
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
          <div
            style={{
              width: '100%',
              maxWidth: 440,
              background: '#ffffff',
              borderRadius: 12,
              padding: 22,
              boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
            }}
          >
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
