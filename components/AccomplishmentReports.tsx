'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { enqueueOfflineReport } from '@/lib/offline-queue';
import { newClientId } from '@/lib/offline-sync-core';
import { getErrorMessage, isNetworkErrorMessage } from '@/lib/error-utils';
import { buildOwnActivityOrFilter, DAILY_ACTIVITY_REPORT_COLUMNS } from '@/lib/query-columns';
import type { DailyActivityRow } from '@/lib/activity-types';
import {
  activityToAccomplishmentEntry,
  type AccomplishmentEntry,
  type AccomplishmentReportRow,
} from '@/lib/accomplishment-form';
import AccomplishmentFormSheet from '@/components/AccomplishmentFormSheet';
import AccomplishmentEntryEditor from '@/components/AccomplishmentEntryEditor';
import { SampleBadge } from '@/components/SampleBadge';
import { AlertBanner, EmptyState, SegmentedTabs } from '@/components/ui';

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
  canLogSample?: boolean;
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
    const dayActs = p.initialActivities.filter((a) => !a.is_sample && a.activity_date === reportDate);
    if (!dayActs.length) return [emptyEntry(0)];
    return dayActs.map((a) => activityToAccomplishmentEntry(a, a.area_code_id ? areaById.get(a.area_code_id)?.code : undefined));
  }, [p.initialActivities, reportDate, areaById]);

  const [editingId, setEditingId] = useState<string | null>(existingForDate?.id ?? null);
  const [entries, setEntries] = useState<AccomplishmentEntry[]>(() => {
    const dayActs = p.initialActivities.filter((a) => !a.is_sample && a.activity_date === reportDate);
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
  useEffect(() => {
    if (window.innerWidth <= 640) setShowPreview(false);
  }, []);
  const [isSample, setIsSample] = useState<boolean>(Boolean(existingForDate?.is_sample));
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
    const ownFilter = buildOwnActivityOrFilter(p.userId, p.operatorId);
    let q = sb
      .from('daily_activities')
      .select(DAILY_ACTIVITY_REPORT_COLUMNS)
      .eq('organization_id', p.orgId)
      .eq('is_sample', false)
      .eq('activity_date', targetDate)
      .order('started_at', { ascending: true });
    if (ownFilter) q = q.or(ownFilter);
    const { data, error } = await q;
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
      setIsSample(Boolean(found.is_sample));
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
      setIsSample(false);
      const dayActs = p.initialActivities.filter((a) => !a.is_sample && a.activity_date === nextDate);
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
    const ownFilter = buildOwnActivityOrFilter(p.userId, p.operatorId);
    let q = sb
      .from('daily_activities')
      .select(DAILY_ACTIVITY_REPORT_COLUMNS)
      .eq('organization_id', p.orgId)
      .eq('is_sample', false)
      .eq('activity_date', reportDate)
      .order('started_at', { ascending: true });
    if (ownFilter) q = q.or(ownFilter);
    const { data, error } = await q;
    setBusy(false);
    if (error) {
      setMsg({ kind: 'err', text: error.message });
      return;
    }
    const mine = ((data ?? []) as DailyActivityRow[]).filter(
      (a) =>
        a.logged_by === p.userId ||
        (p.operatorId && (a.lead_operator_id === p.operatorId || a.crew_operator_ids?.includes(p.operatorId))),
    );
    if (!mine.length) {
      setMsg({ kind: 'err', text: `No logged activities found for ${reportDate}. You can add rows manually below.` });
      return;
    }
    const mapped = mine.map((a) =>
      activityToAccomplishmentEntry(a, a.area_code_id ? areaById.get(a.area_code_id)?.code : undefined),
    );
    setEntries(mapped);
    setMsg({ kind: 'ok', text: `Loaded ${mapped.length} logged activit${mapped.length === 1 ? 'y' : 'ies'} for ${reportDate}.` });
  }

  function updateEntry(idx: number, patch: Partial<AccomplishmentEntry>) {
    setEntries((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  /** Primary key for a report that is being created, kept across attempts so a retry after a lost
   *  response cannot create a second report. Cleared once the report is saved or queued. */
  const newReportRef = useRef<{ key: string; id: string } | null>(null);

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
      is_sample: p.canLogSample ? isSample : false,
      ...(targetStatus === 'submitted' ? { submitted_at: new Date().toISOString() } : {}),
    };

    const expectedUpdatedAt = editingId ? (existingForDate?.updated_at ?? null) : null;

    const newReportKey = `${reportDate}|${payload.is_sample}`;
    if (!editingId && newReportRef.current?.key !== newReportKey) {
      newReportRef.current = { key: newReportKey, id: newClientId() };
    }
    const newReportId = editingId ? null : (newReportRef.current?.id ?? null);
    const queueReport = async () => {
      await enqueueOfflineReport(editingId, newReportId ? { ...payload, id: newReportId } : payload, p.userId, {
        expectedUpdatedAt,
      });
      newReportRef.current = null;
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      await queueReport();
      setBusy(false);
      setMsg({
        kind: 'ok',
        text: 'Offline detected — report queued on this device and will auto-send when signal returns.',
      });
      return;
    }

    try {
      let res = editingId
        ? await sb.from('accomplishment_reports').update(payload).eq('id', editingId).select('*').single()
        : await sb
            .from('accomplishment_reports')
            .insert({ ...payload, id: newReportId as string })
            .select('*')
            .single();
      if (!editingId && res.error?.code === '23505') {
        // An earlier attempt already created this report; apply the current values to it.
        res = await sb
          .from('accomplishment_reports')
          .update(payload)
          .eq('id', newReportId as string)
          .select('*')
          .single();
      }

      setBusy(false);
      if (res.error || !res.data) {
        const errText = res.error?.message ?? 'Failed to save report.';
        if (isNetworkErrorMessage(errText)) {
          await queueReport();
          setMsg({
            kind: 'ok',
            text: 'Weak signal — report saved offline and will auto-sync when connection returns.',
          });
          return;
        }
        setMsg({ kind: 'err', text: errText });
        return;
      }
      const saved = res.data as AccomplishmentReportRow;
      newReportRef.current = null;
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
    } catch (err: unknown) {
      const errText = getErrorMessage(err, 'Failed to save report.');
      if (!navigator.onLine || isNetworkErrorMessage(errText)) {
        await queueReport();
        setBusy(false);
        setMsg({
          kind: 'ok',
          text: 'Connection lost — report queued offline and will auto-sync when signal returns.',
        });
        return;
      }
      setBusy(false);
      setMsg({ kind: 'err', text: errText });
    }
  }

  async function reviewReport(report: AccomplishmentReportRow, nextStatus: 'checked' | 'returned') {
    setBusy(true);
    setMsg(null);
    const patch =
      nextStatus === 'checked'
        ? {
            status: 'checked' as const,
            checked_by: p.userId,
            checked_by_name: p.userName,
            checked_by_title: p.userJobTitle || 'Project Head/Technical Head',
            checked_at: new Date().toISOString(),
            head_remarks: headRemarksInput.trim() || null,
          }
        : {
            status: 'returned' as const,
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
      <div className="no-print card mobile-toolbar-compact" style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h1 className="page-title" style={{ fontSize: 15 }}>Daily Accomplishment Reports</h1>
          <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
            BPEMS-F-002 · End-of-Shift Technical &amp; Project Report
          </span>
        </div>

        {p.canVerify && (
          <SegmentedTabs
            ariaLabel="Accomplishment report view"
            size="sm"
            className="mobile-full-tabs"
            value={tab}
            onChange={setTab}
            items={[
              { id: 'inbox', label: `Head Inbox${pendingCount > 0 ? ` (${pendingCount})` : ''}` },
              { id: 'my', label: 'My Shift Report' },
            ]}
          />
        )}

        <div className="mobile-action-grid" style={{ marginLeft: 'auto' }}>
          {p.canVerify && (
            <a
              href="/api/reports/leave-export"
              className="btn"
              style={{ fontSize: 12, textDecoration: 'none' }}
              title="Download annual Leave & Holiday Worked CSV"
            >
              Leave/Holiday Export
            </a>
          )}
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </div>

      {p.migrationMissing && (
        <AlertBanner className="no-print" tone="warn">
          Database migration <code>014_accomplishment_reports.sql</code> has not been applied yet. You can preview and print forms, and once you run migration <code>014</code> in Supabase SQL Editor, saving and sending to heads will be live.
        </AlertBanner>
      )}

      {msg && (
        <AlertBanner className="no-print" tone={msg.kind === 'err' ? 'danger' : 'ok'}>
          {msg.text}
        </AlertBanner>
      )}

      {/* HEAD INBOX TAB */}
      {tab === 'inbox' && p.canVerify && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="no-print card mobile-toolbar-compact" style={{ padding: 12, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="mobile-filter-pair">
                <span className="section-eyebrow">Scope</span>
                <SegmentedTabs
                  ariaLabel="Report inbox scope"
                  size="sm"
                  value={inboxScope}
                  onChange={setInboxScope}
                  items={[
                    { id: 'mine', label: 'Assigned to Me' },
                    { id: 'org', label: 'All Org' },
                  ]}
                />
              </div>
              <div className="mobile-filter-pair">
                <span className="section-eyebrow">Status</span>
                <SegmentedTabs
                  ariaLabel="Report status filter"
                  size="sm"
                  value={inboxFilter}
                  onChange={setInboxFilter}
                  items={[
                    { id: 'pending', label: `Pending Review (${pendingCount})` },
                    { id: 'checked', label: 'Checked' },
                    { id: 'all', label: 'All Submitted' },
                  ]}
                />
              </div>
            </div>

            {!inboxReports.length ? (
              <EmptyState
                minHeight={150}
                title={inboxFilter === 'pending' ? 'No reports pending review' : 'No accomplishment reports in this filter'}
                description="Switch to All Submitted to browse past shift reports or draft a BPEMS-F-002 report."
                action={(
                  <div className="row-wrap" style={{ justifyContent: 'center' }}>
                    {inboxFilter !== 'all' && (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => setInboxFilter('all')}>
                        All Submitted
                      </button>
                    )}
                    <button type="button" className="btn btn-sm" onClick={() => setTab('my')}>
                      My Shift Report
                    </button>
                  </div>
                )}
              />
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
                      <span style={{ fontWeight: 700, fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        <span>{r.prepared_by_name || 'Staff'} · {r.report_date}</span>
                        {r.is_sample && <SampleBadge expiresAt={r.sample_expires_at} />}
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
                isSample={Boolean(selectedInboxReport.is_sample)}
              />
            </>
          )}
        </div>
      )}

      {/* MY SHIFT REPORT TAB */}
      {tab === 'my' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="no-print card mobile-toolbar-compact" style={{ padding: 14, display: 'grid', gap: 12 }}>
            {activeReportForMy?.status === 'returned' && activeReportForMy.head_remarks && (
              <div style={{ padding: '8px 12px', borderRadius: 6, background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', color: 'var(--danger-fg)', fontSize: 12.5 }}>
                <strong>Returned by Head:</strong> {activeReportForMy.head_remarks}
              </div>
            )}

            <div className="report-meta-grid">
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

              <label className="report-meta-full" style={{ fontSize: 12 }}>
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

            {p.canLogSample && (
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', padding: '7px 10px', borderRadius: 6, background: 'var(--warn-bg)', color: 'var(--warn-fg)', border: '1px solid var(--warn-border)', fontSize: 12, fontWeight: 600, cursor: editingId || isLocked ? 'default' : 'pointer' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={isSample}
                    disabled={Boolean(editingId) || isLocked}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setIsSample(next);
                      const matching = reports.find(
                        (r) =>
                          r.report_date === reportDate &&
                          Boolean(r.is_sample) === next &&
                          (r.submitted_by === p.userId || (p.operatorId && r.operator_id === p.operatorId)),
                      );
                      setEditingId(matching?.id ?? null);
                    }}
                  />
                  <span>Log as sample (auto-deletes in 24h)</span>
                </span>
                {activeReportForMy?.is_sample && <SampleBadge expiresAt={activeReportForMy.sample_expires_at} />}
              </label>
            )}

            <div className="mobile-action-grid">
              <button type="button" className="btn" disabled={busy || isLocked} onClick={pullActivitiesForDate}>
                Load Logged Activities ({reportDate})
              </button>
              <button
                type="button"
                className="btn btn-add"
                disabled={isLocked}
                onClick={() => setEntries((prev) => [...prev, emptyEntry(prev.length)])}
              >
                + Add Row
              </button>
            </div>

            <AccomplishmentEntryEditor
              entries={entries}
              isLocked={isLocked}
              onUpdate={updateEntry}
              onRemove={(idx) => setEntries((prev) => prev.filter((_, i) => i !== idx))}
            />

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
              <button type="button" className="btn" onClick={() => setShowPreview((v) => !v)}>
                {showPreview ? 'Hide Form Preview' : 'Show Official Form Preview'}
              </button>

              <div className="mobile-action-grid">
                <button type="button" className="btn" disabled={busy || isLocked} onClick={() => saveReport('draft')}>
                  Save Draft
                </button>
                <button type="button" className="btn btn-primary" disabled={busy || isLocked} onClick={() => saveReport('submitted')}>
                  {activeReportForMy?.status === 'submitted' ? 'Update & Re-send to Head' : 'Send to Assigned Head'}
                </button>
              </div>
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
              isSample={Boolean(editingId ? activeReportForMy?.is_sample : isSample)}
            />
          )}
        </div>
      )}
    </div>
  );
}
