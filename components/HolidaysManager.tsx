'use client';

import { useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { formatDateOnly } from '@/lib/date';
import { AlertBanner, Badge, type BadgeTone } from '@/components/ui';

export type HolidayRow = {
  id: string;
  holiday_date: string;
  name: string;
  holiday_type: 'regular' | 'special_non_working' | 'company';
};

const TYPE_META: Record<HolidayRow['holiday_type'], { label: string; tone: BadgeTone }> = {
  regular: { label: 'Regular Holiday', tone: 'danger' },
  special_non_working: { label: 'Special Non-Working', tone: 'warn' },
  company: { label: 'Company / Local', tone: 'info' },
};

function lastMondayOfAugust(year: number) {
  const d = new Date(Date.UTC(year, 7, 31));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function buildPhHolidays(year: number): Array<{ holiday_date: string; name: string; holiday_type: HolidayRow['holiday_type'] }> {
  return [
    { holiday_date: `${year}-01-01`, name: "New Year's Day", holiday_type: 'regular' },
    { holiday_date: `${year}-04-09`, name: 'Araw ng Kagitingan', holiday_type: 'regular' },
    { holiday_date: `${year}-05-01`, name: 'Labor Day', holiday_type: 'regular' },
    { holiday_date: `${year}-06-12`, name: 'Independence Day', holiday_type: 'regular' },
    { holiday_date: `${year}-08-21`, name: 'Ninoy Aquino Day', holiday_type: 'special_non_working' },
    { holiday_date: lastMondayOfAugust(year), name: 'National Heroes Day', holiday_type: 'regular' },
    { holiday_date: `${year}-11-01`, name: "All Saints' Day", holiday_type: 'special_non_working' },
    { holiday_date: `${year}-11-30`, name: 'Bonifacio Day', holiday_type: 'regular' },
    { holiday_date: `${year}-12-08`, name: 'Feast of the Immaculate Conception', holiday_type: 'special_non_working' },
    { holiday_date: `${year}-12-25`, name: 'Christmas Day', holiday_type: 'regular' },
    { holiday_date: `${year}-12-30`, name: 'Rizal Day', holiday_type: 'regular' },
    { holiday_date: `${year}-12-31`, name: 'Last Day of the Year', holiday_type: 'special_non_working' },
  ];
}

export default function HolidaysManager(p: {
  initialHolidays: HolidayRow[];
  orgId: string;
  isAdmin: boolean;
  error?: string;
}) {
  const currentYear = new Date().getFullYear();
  const [holidays, setHolidays] = useState<HolidayRow[]>(p.initialHolidays);
  const [yearFilter, setYearFilter] = useState<string>(String(currentYear));
  const [newDate, setNewDate] = useState(`${currentYear}-01-01`);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<HolidayRow['holiday_type']>('regular');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(p.error ?? '');

  const visible = useMemo(() => {
    const list = yearFilter === 'all' ? holidays : holidays.filter((h) => h.holiday_date.startsWith(yearFilter));
    return [...list].sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
  }, [holidays, yearFilter]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newDate || !newName.trim()) return;
    setBusy(true);
    setMsg('');
    const sb = supabaseBrowser();
    const { data, error } = await sb
      .from('holidays')
      .upsert(
        {
          organization_id: p.orgId,
          holiday_date: newDate,
          name: newName.trim(),
          holiday_type: newType,
        },
        { onConflict: 'organization_id,holiday_date' },
      )
      .select('id, holiday_date, name, holiday_type')
      .single();

    setBusy(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    const row = data as HolidayRow;
    setHolidays((prev) => [...prev.filter((x) => x.holiday_date !== row.holiday_date), row]);
    setNewName('');
    setMsg(`✓ Saved holiday: ${row.name} (${row.holiday_date})`);
  }

  async function handleLoadPreset() {
    const y = Number(yearFilter) || currentYear;
    setBusy(true);
    setMsg('');
    const sb = supabaseBrowser();
    const rows = buildPhHolidays(y).map((h) => ({ ...h, organization_id: p.orgId }));
    const { data, error } = await sb
      .from('holidays')
      .upsert(rows, { onConflict: 'organization_id,holiday_date' })
      .select('id, holiday_date, name, holiday_type');

    setBusy(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    const inserted = (data ?? []) as HolidayRow[];
    setHolidays((prev) => {
      const byDate = new Map(prev.map((h) => [h.holiday_date, h]));
      inserted.forEach((h) => byDate.set(h.holiday_date, h));
      return Array.from(byDate.values());
    });
    setMsg(`✓ Loaded ${inserted.length} Philippine fixed holidays for ${y}. Add movable holidays (Holy Week, Eid) manually.`);
  }

  async function handleDelete(id: string) {
    setBusy(true);
    setMsg('');
    const { error } = await supabaseBrowser().from('holidays').delete().eq('id', id);
    setBusy(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    setHolidays((prev) => prev.filter((x) => x.id !== id));
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <strong style={{ fontSize: 15 }}>Organization Holiday Calendar</strong>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Holidays highlight on the Roster &amp; PM Planner and automatically track Holiday Shifts Worked in Reports without overwriting 24/7 plant shifts.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="input"
              aria-label="Filter holidays by year"
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              style={{ width: 'auto' }}
            >
              <option value={String(currentYear - 1)}>{currentYear - 1}</option>
              <option value={String(currentYear)}>{currentYear}</option>
              <option value={String(currentYear + 1)}>{currentYear + 1}</option>
              <option value="all">All Years</option>
            </select>
            {p.isAdmin && yearFilter !== 'all' && (
              <button type="button" className="btn" disabled={busy} onClick={handleLoadPreset}>
                Load PH Holidays ({yearFilter})
              </button>
            )}
          </div>
        </div>

        {p.isAdmin && (
          <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', borderTop: '1px solid var(--border-light)', paddingTop: 10 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600, flex: '1 1 140px', minWidth: 0 }}>
              Date
              <input className="input" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} required />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600, flex: '1 1 180px', minWidth: 0 }}>
              Holiday Name
              <input className="input" placeholder="e.g. Maundy Thursday, Iloilo Charter Day" value={newName} onChange={(e) => setNewName(e.target.value)} required />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600, flex: '1 1 140px', minWidth: 0 }}>
              Type
              <select className="input" value={newType} onChange={(e) => setNewType(e.target.value as HolidayRow['holiday_type'])}>
                <option value="regular">Regular Holiday</option>
                <option value="special_non_working">Special Non-Working</option>
                <option value="company">Company / Local</option>
              </select>
            </label>
            <button type="submit" className="btn btn-add" disabled={busy}>
              {busy ? 'Saving…' : '+ Add / Update Holiday'}
            </button>
          </form>
        )}

        {msg && <AlertBanner tone={msg.startsWith('✓') ? 'ok' : 'danger'}>{msg}</AlertBanner>}
      </div>

      <div className="card responsive-table-wrap scroll-x">
        <table className="data-table">
          <thead>
            <tr style={{ background: 'var(--header-bg)', color: 'var(--header-fg)', textAlign: 'left', fontSize: 12 }}>
              <th style={{ padding: '7px 12px' }}>Date</th>
              <th style={{ padding: '7px 10px' }}>Holiday Name</th>
              <th style={{ padding: '7px 10px' }}>Classification</th>
              {p.isAdmin && <th style={{ padding: '7px 12px', textAlign: 'right' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={p.isAdmin ? 4 : 3} style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)' }}>
                  No holidays configured for this selection.
                </td>
              </tr>
            ) : (
              visible.map((h) => {
                const tm = TYPE_META[h.holiday_type] ?? TYPE_META.regular;
                return (
                  <tr key={h.id}>
                    <td className="tabular-nums" style={{ padding: '7px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {h.holiday_date} <span style={{ fontWeight: 400, color: 'var(--text-secondary)', fontSize: 11.5 }}>({formatDateOnly(h.holiday_date)})</span>
                    </td>
                    <td style={{ padding: '7px 10px', fontWeight: 600 }}>{h.name}</td>
                    <td style={{ padding: '7px 10px' }}>
                      <Badge tone={tm.tone} size="sm">{tm.label}</Badge>
                    </td>
                    {p.isAdmin && (
                      <td style={{ padding: '7px 12px', textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => void handleDelete(h.id)}
                          style={{ padding: '4px 10px', fontSize: 12, color: 'var(--danger)' }}
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="responsive-cards">
        {visible.length === 0 ? (
          <div className="card" style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
            No holidays configured for this selection.
          </div>
        ) : (
          visible.map((h) => {
            const tm = TYPE_META[h.holiday_type] ?? TYPE_META.regular;
            return (
              <div key={`m-${h.id}`} className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="tabular-nums" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
                      {h.holiday_date} ({formatDateOnly(h.holiday_date)})
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{h.name}</div>
                  </div>
                  <Badge tone={tm.tone} size="sm">{tm.label}</Badge>
                </div>
                {p.isAdmin && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => void handleDelete(h.id)}
                      style={{ color: 'var(--danger)' }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
