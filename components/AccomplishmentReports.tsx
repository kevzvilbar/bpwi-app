'use client';

import { useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { DailyActivityRow } from '@/lib/activity-types';
import {
  ALL_FORM_COLUMNS,
  activityToAccomplishmentEntry,
  type AccomplishmentEntry,
  type AccomplishmentReportRow,
} from '@/lib/accomplishment-form';
import AccomplishmentFormSheet from '@/components/AccomplishmentFormSheet';

export interface HeadOption {
  id: string;
  full_name: string | null;
  role: string;
  job_title: string | null;
}

export interface OperatorOption {
  id: string;
  full_name: string;
  position: string | null;
  department_head_id?: string | null;
}

export interface ShiftOption {
  id: string;
  code: string;
  description: string | null;
}

interface Props {
  orgId: string;
  userId: string;
  userName: string;
  userRole: string;
  userJobTitle: string | null;
  operatorId: string | null;
  today: string;
  canVerify: boolean;
  heads: HeadOption[];
  operators: OperatorOption[];
  shifts: ShiftOption[];
  areas: Array<{ id: string; code: string; name: string | null }>;
  initialActivities: DailyActivityRow[];
  initialReports: AccomplishmentReportRow[];
  migrationMissing?: boolean;
  error?: string;
}

function emptyEntry(idx: number): AccomplishmentEntry {
  return {
    id: `manual-${Date.now()}-${idx}`,
    source_activity_id: null,
    column_id: null,
    others_specify: 'W.M',
    location_project: '',
    location_ph: '',
    location_blk: '',
    location_lot: '',
    time_started: '',
    time_finished: '',
    remarks: '',
  };
}

export default function AccomplishmentReports(p: Props) {
  const sb = useMemo(() => supabaseBrowser(), []);
  const areaById = useMemo(() => new Map(p.areas.map((a) => [a.id, a])), [p.areas]);
  const opById = useMemo(() => new Map(p.operators.map((o) => [o.id, o])), [p.operators]);
  const headById = useMemo(() => new Map(p.heads.map((h) => [h.id, h])), [p.heads]);

  const myOp = p.operatorId ? opById.get(p.operatorId) : undefined;
  const defaultHeadId = myOp?.department_head_id ?? p.heads[0]?.id ?? '';

  const [reports, setReports] = useState<AccomplishmentReportRow[]>(p.initialReports);
  const [reportDate, setReportDate] = useState<string>(p.today);
  const [tab, setTab] = useState<'my' | 'inbox'>(p.canVerify ? 'inbox' : 'my');
  const [inboxFilter, setInboxFilter] = useState<'pending' | 'checked' | 'all'>('pending');
  const [inboxScope, setInboxScope] = useState<'mine' | 'org'>(p.userRole === 'manager' ? 'mine' : 'org');

  // Find existing report for current user + selected date
  const existingForDate = useMemo(
    () =>
      reports.find(
        (r) =>
          r.report_date === reportDate &&
          (r.submitted_by === p.userId || (p.operatorId && r.operator_id === p.operatorId)),
      ) ?? null,
    [reports, reportDate, p.userId, p.operatorId],
  );

  const initialAutoEntries = useMemo(() => {
    const dayActs = p.initialActivities.filter((a) => a.activity_date === reportDate);
    if (!dayActs.length) return [emptyEntry(0)];
    return dayActs.map((a) => activityToAccomplishmentEntry(a, a.area_code_id ? areaById.get(a.area_code_id)?.code : undefined));
  }, [p.initialActivities, reportDate, areaById]);

  const [editingId, setEditingId] = useState<string | null>(existingForDate?.id ?? null);
  const [entries, setEntries] = useState<AccomplishmentEntry[]>(() => {
    const dayActs = p.initialActivities.filter((a) => a.activity_date === reportDate);
    if (!existingForDate) return initialAutoEntries;
    if (existingForDate.status === 'draft' || existingForDate.status === 'returned') {
      const mapped = dayActs.map((a) =>
        activityToAccomplishmentEntry(a, a.area_code_id ? areaById.get(a.area_code_id)?.code : undefined),
      );
      const base = existingForDate.entries.length ? existingForDate.entries : [];
      const seen = new Set(base.map((e) => e.source_activity_id).filter(Boolean));
      const merged = [...base, ...mapped.filter((m) => m.source_activity_id && !seen.has(m.source_activity_id))];
      return merged.length ? merged : [emptyEntry(0)];
    }
    return existingForDate.entries.length ? existingForDate.entries : [emptyEntry(0)];
  });
  const [assignedHeadId, setAssignedHeadId] = useState<string>(
    existingForDate?.assigned_head_id ?? defaultHeadId,
  );
  const [shiftTypeId, setShiftTypeId] = useState<string>(existingForDate?.shift_type_id ?? '');
  const [preparedName, setPreparedName] = useState<string>(
    existingForDate?.prepared_by_name || myOp?.full_name || p.userName,
  );
  const [preparedTitle, setPreparedTitle] = useState<string>(
    existingForDate?.prepared_by_title || myOp?.position || p.userJobTitle || 'Project & Maintenance Staff',
  );
  const [summaryNotes, setSummaryNotes] = useState<string>(existingForDate?.summary_notes ?? '');
  const [selectedInboxId, setSelectedInboxId] = useState<string | null>(null);
  const [headRemarksInput, setHeadRemarksInput] = useState<string>('');
  const [showPreview, setShowPreview] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    p.error ? { kind: 'err', text: p.error } : null,
  );

  function mergeActivitiesIntoEntries(existing: AccomplishmentEntry[], acts: DailyActivityRow[]): AccomplishmentEntry[] {
    const mapped = acts.map((a) =>
      activityToAccomplishmentEntry(a, a.area_code_id ? areaById.get(a.area_code_id)?.code : undefined),
    );
    if (!mapped.length) return existing.length ? existing : [emptyEntry(0)];

    // Keep non-empty manual rows or previously edited activity rows, and auto-append any newly logged activities
    const isStarterBlank = (e: AccomplishmentEntry) =>
      !e.source_activity_id && !e.location_project.trim() && !e.remarks.trim() && !e.time_started.trim();
    const meaningfulExisting = existing.filter((e) => !isStarterBlank(e));
    const seenActivityIds = new Set(meaningfulExisting.map((e) => e.source_activity_id).filter(Boolean));
    const newOnes = mapped.filter((m) => m.source_activity_id && !seenActivityIds.has(m.source_activity_id));
    const merged = [...meaningfulExisting, ...newOnes];
    return merged.length ? merged : [emptyEntry(0)];
  }

  async function fetchAndSyncActivitiesForDate(targetDate: string, baseEntries: AccomplishmentEntry[], isEditable: boolean) {
    if (!isEditable) return;
    const { data, error } = await sb
      .from('daily_activities')
      .select('*')
      .eq('organization_id', p.orgId)
      .eq('activity_date', targetDate)
      .order('started_at', { ascending: true });
    if (error || !data) return;
    const mine = (data as DailyActivityRow[]).filter(
      (a) =>
        a.logged_by === p.userId ||
        (p.operatorId && (a.lead_operator_id === p.operatorId || a.crew_operator_ids?.includes(p.operatorId))),
    );
    if (mine.length) {
      setEntries(mergeActivitiesIntoEntries(baseEntries, mine));
    }
  }

  async function loadDateIntoEditor(nextDate: string) {
    setReportDate(nextDate);
    setMsg(null);
    const found = reports.find(
      (r) =>
        r.report_date === nextDate &&
        (r.submitted_by === p.userId || (p.operatorId && r.operator_id === p.operatorId)),
    );
    if (found) {
      const base = found.entries.length ? found.entries : [emptyEntry(0)];
      setEditingId(found.id);
      setEntries(base);
      setAssignedHeadId(found.assigned_head_id ?? defaultHeadId);
      setShiftTypeId(found.shift_type_id ?? '');
      setPreparedName(found.prepared_by_name || myOp?.full_name || p.userName);
      setPreparedTitle(found.prepared_by_title || myOp?.position || p.userJobTitle || 'Project & Maintenance Staff');
      setSummaryNotes(found.summary_notes ?? '');
      if (found.status === 'draft' || found.status === 'returned') {
        await fetchAndSyncActivitiesForDate(nextDate, base, true);
      }
    } else {
      setEditingId(null);
      const dayActs = p.initialActivities.filter((a) => a.activity_date === nextDate);
      const base = dayActs.length
        ? dayActs.map((a) => activityToAccomplishmentEntry(a, a.area_code_id ? areaById.get(a.area_code_id)?.code : undefined))
        : [emptyEntry(0)];
      setEntries(base);
      setAssignedHeadId(defaultHeadId);
      setShiftTypeId('');
      setPreparedName(myOp?.full_name || p.userName);
      setPreparedTitle(myOp?.position || p.userJobTitle || 'Project & Maintenance Staff');
      setSummaryNotes('');
      await fetchAndSyncActivitiesForDate(nextDate, base, true);
    }
  }

  async function pullActivitiesForDate() {
    setBusy(true);
    setMsg(null);
    const { data, error } = await sb
      .from('daily_activities')
      .select('*')
      .eq('organization_id', p.orgId)
      .eq('activity_date', reportDate)
      .order('started_at', { ascending: true });
    setBusy(false);
    if (error) {
      setMsg({ kind: 'err', text: error.message });
      return;
    }
    const mine = (data ?? []).filter(
      (a: DailyActivityRow) =>
        a.logged_by === p.userId ||
        (p.operatorId && (a.lead_operator_id === p.operatorId || a.crew_operator_ids?.includes(p.operatorId))),
    );
    if (!mine.length) {
      setMsg({ kind: 'err', text: `No logged activities found for ${reportDate}. You can add rows manually below.` });
      return;
    }
    const mapped = mine.map((a: DailyActivityRow) =>
      activityToAccomplishmentEntry(a, a.area_code_id ? areaById.get(a.area_code_id)?.code : undefined),
    );
    setEntries(mapped);
    setMsg({ kind: 'ok', text: `Loaded ${mapped.length} logged activit${mapped.length === 1 ? 'y' : 'ies'} for ${reportDate}.` });
  }

  function updateEntry(idx: number, patch: Partial<AccomplishmentEntry>) {
    setEntries((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function saveReport(targetStatus: 'draft' | 'submitted') {
    if (targetStatus === 'submitted' && !assignedHeadId) {
      setMsg({ kind: 'err', text: 'Please select an Assigned Department Head before sending.' });
      return;
    }
    const cleanEntries = entries.filter(
      (e) =>
        e.column_id ||
        e.others_specify.trim() ||
        e.location_project.trim() ||
        e.remarks.trim() ||
        e.time_started.trim(),
    );
    if (targetStatus === 'submitted' && !cleanEntries.length) {
      setMsg({ kind: 'err', text: 'Add at least one accomplishment row before sending.' });
      return;
    }

    setBusy(true);
    setMsg(null);
    const payload = {
      organization_id: p.orgId,
      report_date: reportDate,
      shift_type_id: shiftTypeId || null,
      operator_id: p.operatorId || null,
      submitted_by: p.userId,
      assigned_head_id: assignedHeadId || null,
      prepared_by_name: preparedName.trim() || p.userName,
      prepared_by_title: preparedTitle.trim() || 'Project & Maintenance Staff',
      status: targetStatus,
      entries: cleanEntries,
      summary_notes: summaryNotes.trim() || null,
      ...(targetStatus === 'submitted' ? { submitted_at: new Date().toISOString() } : {}),
    };

    const res = editingId
      ? await sb.from('accomplishment_reports').update(payload).eq('id', editingId).select('*').single()
      : await sb.from('accomplishment_reports').insert(payload).select('*').single();

    setBusy(false);
    if (res.error || !res.data) {
      setMsg({ kind: 'err', text: res.error?.message ?? 'Failed to save report.' });
      return;
    }
    const saved = res.data as AccomplishmentReportRow;
    setEditingId(saved.id);
    setReports((prev) => {
      const idx = prev.findIndex((r) => r.id === saved.id);
      return idx >= 0 ? prev.map((r) => (r.id === saved.id ? saved : r)) : [saved, ...prev];
    });
    setMsg({
      kind: 'ok',
      text:
        targetStatus === 'submitted'
          ? `Report sent to ${headById.get(assignedHeadId)?.full_name ?? 'Assigned Head'}.`
          : 'Draft saved.',
    });
  }

  async function reviewReport(report: AccomplishmentReportRow, nextStatus: 'checked' | 'returned') {
    setBusy(true);
    setMsg(null);
    const patch =
      nextStatus === 'checked'
        ? {
            status: 'checked',
            checked_by: p.userId,
            checked_by_name: p.userName,
            checked_by_title: p.userJobTitle || 'Project Head/Technical Head',
            checked_at: new Date().toISOString(),
            head_remarks: headRemarksInput.trim() || null,
          }
        : {
            status: 'returned',
            head_remarks: headRemarksInput.trim() || 'Please review and update entries.',
          };

    const { data, error } = await sb
      .from('accomplishment_reports')
      .update(patch)
      .eq('id', report.id)
      .select('*')
      .single();

    setBusy(false);
    if (error || !data) {
      setMsg({ kind: 'err', text: error?.message ?? 'Failed to update report.' });
      return;
    }
    const updated = data as AccomplishmentReportRow;
    setReports((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setMsg({
      kind: 'ok',
      text: nextStatus === 'checked' ? 'Report checked and approved.' : 'Report returned for revision.',
    });
  }

  const scopedReports = useMemo(
    () => (inboxScope === 'mine' ? reports.filter((r) => r.assigned_head_id === p.userId) : reports),
    [reports, inboxScope, p.userId],
  );

  const inboxReports = useMemo(() => {
    return scopedReports.filter((r) => {
      if (inboxFilter === 'pending') return r.status === 'submitted';
      if (inboxFilter === 'checked') return r.status === 'checked';
      return r.status !== 'draft';
    });
  }, [scopedReports, inboxFilter]);

  const pendingCount = useMemo(
    () => scopedReports.filter((r) => r.status === 'submitted').length,
    [scopedReports],
  );

  const selectedInboxReport = useMemo(
    () => inboxReports.find((r) => r.id === selectedInboxId) ?? inboxReports[0] ?? null,
    [inboxReports, selectedInboxId],
  );

  const activeReportForMy = existingForDate;
  const isLocked = activeReportForMy?.status === 'checked';

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* Top Toolbar */}
      <div className="no-print card" style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <strong style={{ fontSize: 15 }}>Daily Accomplishment Reports</strong>
          <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
            BPEMS-F-002 · End-of-Shift Technical &amp; Project Report
          </span>
        </div>

        {p.canVerify && (
          <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
            <button
              type="button"
              className={`btn ${tab === 'inbox' ? 'btn-primary' : ''}`}
              onClick={() => setTab('inbox')}
            >
              Head Inbox {pendingCount > 0 ? `(${pendingCount})` : ''}
            </button>
            <button
              type="button"
              className={`btn ${tab === 'my' ? 'btn-primary' : ''}`}
              onClick={() => setTab('my')}
            >
              My Shift Report
            </button>
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <a
            href="/api/reports/leave-export"
            className="btn"
            style={{ fontSize: 12, textDecoration: 'none' }}
            title="Download annual Leave & Holiday Worked CSV"
          >
            Leave/Holiday Export
          </a>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </div>

      {p.migrationMissing && (
        <div className="no-print card" style={{ padding: 12, borderLeft: '4px solid #d97706', background: 'rgba(217,119,6,0.08)', fontSize: 12.5 }}>
          Database migration <code>014_accomplishment_reports.sql</code> has not been applied yet. You can preview and print forms, and once you run migration <code>014</code> in Supabase SQL Editor, saving and sending to heads will be live.
        </div>
      )}

      {msg && (
        <div
          className="no-print card"
          role="alert"
          style={{
            padding: '8px 12px',
            fontSize: 12.5,
            borderLeft: `4px solid ${msg.kind === 'err' ? '#dc2626' : '#16a34a'}`,
            color: msg.kind === 'err' ? '#b91c1c' : '#15803d',
          }}
        >
          {msg.text}
        </div>
      )}

      {/* HEAD INBOX TAB */}
      {tab === 'inbox' && p.canVerify && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="no-print card" style={{ padding: 12, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>Scope:</span>
              <button
                type="button"
                className={`btn ${inboxScope === 'mine' ? 'btn-primary' : ''}`}
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={() => setInboxScope('mine')}
              >
                Assigned to Me
              </button>
              <button
                type="button"
                className={`btn ${inboxScope === 'org' ? 'btn-primary' : ''}`}
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={() => setInboxScope('org')}
              >
                All Org
              </button>
              <span style={{ fontSize: 12.5, fontWeight: 600, marginLeft: 8 }}>Status:</span>
              {(['pending', 'checked', 'all'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`btn ${inboxFilter === f ? 'btn-primary' : ''}`}
                  style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => setInboxFilter(f)}
                >
                  {f === 'pending' ? `Pending Review (${pendingCount})` : f === 'checked' ? 'Checked' : 'All Submitted'}
                </button>
              ))}
            </div>

            {!inboxReports.length ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                No accomplishment reports in this filter.
              </p>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {inboxReports.map((r) => {
                  const isSel = selectedInboxReport?.id === r.id;
                  const headName = r.assigned_head_id ? headById.get(r.assigned_head_id)?.full_name : null;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setSelectedInboxId(r.id);
                        setHeadRemarksInput(r.head_remarks ?? '');
                      }}
                      className={`btn ${isSel ? 'btn-primary' : ''}`}
                      style={{ textAlign: 'left', padding: '7px 11px', display: 'grid', gap: 2 }}
                    >
                      <span style={{ fontWeight: 700, fontSize: 12.5 }}>
                        {r.prepared_by_name || 'Staff'} · {r.report_date}
                      </span>
                      <span style={{ fontSize: 11, opacity: 0.85 }}>
                        {r.entries.length} row{r.entries.length === 1 ? '' : 's'} · {r.status.toUpperCase()}
                        {headName ? ` → ${headName}` : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {selectedInboxReport && (
            <>
              <div className="no-print card" style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 220 }}
                  placeholder="Head remarks / review note (optional)..."
                  value={headRemarksInput}
                  onChange={(e) => setHeadRemarksInput(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || selectedInboxReport.status === 'checked'}
                  onClick={() => reviewReport(selectedInboxReport, 'checked')}
                >
                  {selectedInboxReport.status === 'checked' ? '✓ Checked' : 'Check & Approve'}
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ color: '#b91c1c' }}
                  disabled={busy}
                  onClick={() => reviewReport(selectedInboxReport, 'returned')}
                >
                  Return for Revision
                </button>
              </div>

              <AccomplishmentFormSheet
                reportDate={selectedInboxReport.report_date}
                entries={selectedInboxReport.entries}
                preparedByName={selectedInboxReport.prepared_by_name}
                preparedByTitle={selectedInboxReport.prepared_by_title}
                checkedByName={selectedInboxReport.checked_by_name}
                checkedByTitle={selectedInboxReport.checked_by_title}
                status={selectedInboxReport.status}
                submittedAt={selectedInboxReport.submitted_at}
                checkedAt={selectedInboxReport.checked_at}
              />
            </>
          )}
        </div>
      )}

      {/* MY SHIFT REPORT TAB */}
      {tab === 'my' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="no-print card" style={{ padding: 14, display: 'grid', gap: 12 }}>
            {activeReportForMy?.status === 'returned' && activeReportForMy.head_remarks && (
              <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', color: '#b91c1c', fontSize: 12.5 }}>
                <strong>Returned by Head:</strong> {activeReportForMy.head_remarks}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              <label style={{ fontSize: 12 }}>
                Report Date
                <input
                  type="date"
                  className="input"
                  value={reportDate}
                  onChange={(e) => loadDateIntoEditor(e.target.value)}
                />
              </label>

              <label style={{ fontSize: 12 }}>
                Assigned Department Head *
                <select
                  className="input"
                  value={assignedHeadId}
                  disabled={isLocked}
                  onChange={(e) => setAssignedHeadId(e.target.value)}
                >
                  <option value="">— Select Head —</option>
                  {p.heads.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.full_name ?? h.id}{h.job_title ? ` (${h.job_title})` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ fontSize: 12 }}>
                Shift
                <select
                  className="input"
                  value={shiftTypeId}
                  disabled={isLocked}
                  onChange={(e) => setShiftTypeId(e.target.value)}
                >
                  <option value="">— Select Shift —</option>
                  {p.shifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code}{s.description ? ` · ${s.description}` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ fontSize: 12 }}>
                Prepared By
                <input
                  className="input"
                  value={preparedName}
                  disabled={isLocked}
                  onChange={(e) => setPreparedName(e.target.value)}
                />
              </label>

              <label style={{ fontSize: 12 }}>
                Designation / Title
                <input
                  className="input"
                  value={preparedTitle}
                  disabled={isLocked}
                  onChange={(e) => setPreparedTitle(e.target.value)}
                />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" className="btn" disabled={busy || isLocked} onClick={pullActivitiesForDate}>
                Load Logged Activities ({reportDate})
              </button>
              <button
                type="button"
                className="btn"
                disabled={isLocked}
                onClick={() => setEntries((prev) => [...prev, emptyEntry(prev.length)])}
              >
                + Add Row
              </button>
              <button type="button" className="btn" onClick={() => setShowPreview((v) => !v)}>
                {showPreview ? 'Hide Form Preview' : 'Show Official Form Preview'}
              </button>

              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn" disabled={busy || isLocked} onClick={() => saveReport('draft')}>
                  Save Draft
                </button>
                <button type="button" className="btn btn-primary" disabled={busy || isLocked} onClick={() => saveReport('submitted')}>
                  {activeReportForMy?.status === 'submitted' ? 'Update & Re-send to Head' : 'Send to Assigned Head'}
                </button>
              </div>
            </div>

            {/* Mobile Stacked Card Editor (<= 640px) */}
            <div className="responsive-cards" style={{ gap: 10 }}>
              {entries.map((row, idx) => (
                <div
                  key={`m-${row.id}`}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: 10,
                    background: 'var(--surface-muted)',
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: 12 }}>
                      Entry #{idx + 1}{row.source_activity_id ? ' · Synced' : ''}
                    </strong>
                    {!isLocked && (
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '2px 8px', fontSize: 12, color: '#b91c1c' }}
                        onClick={() => setEntries((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 8 }}>
                    <label style={{ fontSize: 11.5 }}>
                      Form Column
                      <select
                        className="input"
                        disabled={isLocked}
                        value={row.column_id ?? '__others__'}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateEntry(idx, {
                            column_id: val === '__others__' ? null : val,
                            others_specify: val === '__others__' ? (row.others_specify || 'W.M') : '',
                          });
                        }}
                      >
                        <option value="__others__">OTHERS (SPECIFY)</option>
                        <optgroup label="TECHNICAL">
                          {ALL_FORM_COLUMNS.filter((c) => c.group === 'technical').map((c) => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                          ))}
                        </optgroup>
                        <optgroup label="PROJECT">
                          {ALL_FORM_COLUMNS.filter((c) => c.group === 'project').map((c) => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                          ))}
                        </optgroup>
                      </select>
                    </label>
                    <label style={{ fontSize: 11.5 }}>
                      Others
                      <input
                        className="input"
                        disabled={isLocked || row.column_id !== null}
                        placeholder="W.M"
                        value={row.column_id === null ? row.others_specify : ''}
                        onChange={(e) => updateEntry(idx, { others_specify: e.target.value })}
                      />
                    </label>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 6 }}>
                    <label style={{ fontSize: 11.5 }}>
                      Project / Site
                      <input className="input" disabled={isLocked} value={row.location_project} onChange={(e) => updateEntry(idx, { location_project: e.target.value })} />
                    </label>
                    <label style={{ fontSize: 11.5 }}>
                      PH
                      <input className="input" disabled={isLocked} value={row.location_ph} onChange={(e) => updateEntry(idx, { location_ph: e.target.value })} />
                    </label>
                    <label style={{ fontSize: 11.5 }}>
                      BLK
                      <input className="input" disabled={isLocked} value={row.location_blk} onChange={(e) => updateEntry(idx, { location_blk: e.target.value })} />
                    </label>
                    <label style={{ fontSize: 11.5 }}>
                      LOT
                      <input className="input" disabled={isLocked} value={row.location_lot} onChange={(e) => updateEntry(idx, { location_lot: e.target.value })} />
                    </label>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <label style={{ fontSize: 11.5 }}>
                      Time Started
                      <input className="input" disabled={isLocked} placeholder="3:10 PM" value={row.time_started} onChange={(e) => updateEntry(idx, { time_started: e.target.value })} />
                    </label>
                    <label style={{ fontSize: 11.5 }}>
                      Time Finished
                      <input className="input" disabled={isLocked} placeholder="3:54 PM" value={row.time_finished} onChange={(e) => updateEntry(idx, { time_finished: e.target.value })} />
                    </label>
                  </div>
                  <label style={{ fontSize: 11.5 }}>
                    Remarks
                    <input className="input" disabled={isLocked} placeholder="Well / site status, FM & PG readings..." value={row.remarks} onChange={(e) => updateEntry(idx, { remarks: e.target.value })} />
                  </label>
                </div>
              ))}
            </div>

            {/* Desktop Editable Rows Table */}
            <div className="responsive-table-wrap" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--surface-muted)', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px' }}>Form Column</th>
                    <th style={{ padding: '6px 8px', width: 90 }}>Others (Code)</th>
                    <th style={{ padding: '6px 8px', width: 130 }}>Project / Site</th>
                    <th style={{ padding: '6px 8px', width: 55 }}>PH</th>
                    <th style={{ padding: '6px 8px', width: 55 }}>BLK</th>
                    <th style={{ padding: '6px 8px', width: 55 }}>LOT</th>
                    <th style={{ padding: '6px 8px', width: 90 }}>Started</th>
                    <th style={{ padding: '6px 8px', width: 90 }}>Finished</th>
                    <th style={{ padding: '6px 8px', minWidth: 220 }}>Remarks</th>
                    <th style={{ padding: '6px 8px', width: 42 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((row, idx) => (
                    <tr key={row.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td style={{ padding: 4 }}>
                        <select
                          className="input"
                          disabled={isLocked}
                          value={row.column_id ?? '__others__'}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateEntry(idx, {
                              column_id: val === '__others__' ? null : val,
                              others_specify: val === '__others__' ? (row.others_specify || 'W.M') : '',
                            });
                          }}
                        >
                          <option value="__others__">OTHERS (SPECIFY)</option>
                          <optgroup label="TECHNICAL">
                            {ALL_FORM_COLUMNS.filter((c) => c.group === 'technical').map((c) => (
                              <option key={c.id} value={c.id}>{c.label}</option>
                            ))}
                          </optgroup>
                          <optgroup label="PROJECT">
                            {ALL_FORM_COLUMNS.filter((c) => c.group === 'project').map((c) => (
                              <option key={c.id} value={c.id}>{c.label}</option>
                            ))}
                          </optgroup>
                        </select>
                      </td>
                      <td style={{ padding: 4 }}>
                        <input
                          className="input"
                          disabled={isLocked || row.column_id !== null}
                          placeholder="W.M"
                          value={row.column_id === null ? row.others_specify : ''}
                          onChange={(e) => updateEntry(idx, { others_specify: e.target.value })}
                        />
                      </td>
                      <td style={{ padding: 4 }}>
                        <input
                          className="input"
                          disabled={isLocked}
                          placeholder="e.g. Sta. Barbara"
                          value={row.location_project}
                          onChange={(e) => updateEntry(idx, { location_project: e.target.value })}
                        />
                      </td>
                      <td style={{ padding: 4 }}>
                        <input
                          className="input"
                          disabled={isLocked}
                          value={row.location_ph}
                          onChange={(e) => updateEntry(idx, { location_ph: e.target.value })}
                        />
                      </td>
                      <td style={{ padding: 4 }}>
                        <input
                          className="input"
                          disabled={isLocked}
                          value={row.location_blk}
                          onChange={(e) => updateEntry(idx, { location_blk: e.target.value })}
                        />
                      </td>
                      <td style={{ padding: 4 }}>
                        <input
                          className="input"
                          disabled={isLocked}
                          value={row.location_lot}
                          onChange={(e) => updateEntry(idx, { location_lot: e.target.value })}
                        />
                      </td>
                      <td style={{ padding: 4 }}>
                        <input
                          className="input"
                          disabled={isLocked}
                          placeholder="3:10 PM"
                          value={row.time_started}
                          onChange={(e) => updateEntry(idx, { time_started: e.target.value })}
                        />
                      </td>
                      <td style={{ padding: 4 }}>
                        <input
                          className="input"
                          disabled={isLocked}
                          placeholder="3:54 PM"
                          value={row.time_finished}
                          onChange={(e) => updateEntry(idx, { time_finished: e.target.value })}
                        />
                      </td>
                      <td style={{ padding: 4 }}>
                        <input
                          className="input"
                          disabled={isLocked}
                          placeholder="Well / site status, FM & PG readings..."
                          value={row.remarks}
                          onChange={(e) => updateEntry(idx, { remarks: e.target.value })}
                        />
                      </td>
                      <td style={{ padding: 4, textAlign: 'center' }}>
                        {!isLocked && (
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: '4px 8px', color: '#b91c1c' }}
                            onClick={() => setEntries((prev) => prev.filter((_, i) => i !== idx))}
                            title="Remove row"
                          >
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {showPreview && (
            <AccomplishmentFormSheet
              reportDate={reportDate}
              entries={entries}
              preparedByName={preparedName}
              preparedByTitle={preparedTitle}
              checkedByName={activeReportForMy?.checked_by_name}
              checkedByTitle={activeReportForMy?.checked_by_title}
              status={activeReportForMy?.status}
              submittedAt={activeReportForMy?.submitted_at}
              checkedAt={activeReportForMy?.checked_at}
            />
          )}
        </div>
      )}
    </div>
  );
}
