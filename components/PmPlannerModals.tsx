'use client';

import { resolvePmCreditedOperators } from '@/lib/pm-credit';
import {
  syncRecurrenceForStartDate,
  type PmRecurrenceConfig,
} from '@/lib/pm-recurrence';
import { type PmLocationOption } from '@/lib/pm-locations';
import { findActiveGensetAtLocation, formatGensetTag, type GensetRow } from '@/lib/gensets';
import PmRepeatBuilder from '@/components/PmRepeatBuilder';
import PmLocationPicker from '@/components/PmLocationPicker';

export const PM_PRESETS: Record<string, { label: string; short: string; color: string }> = {
  FLUSH: { label: 'Line Flushing', short: 'Flushing', color: '#0284c7' },
  TANK: { label: 'Tank Cleaning', short: 'Tank Cleaning', color: '#0d9488' },
  PULL: { label: 'Deep Well Pump & Motor Pull-out', short: 'Pull-out', color: '#db2777' },
  THERM: { label: 'Thermal Scanning', short: 'Thermal Scan', color: '#ea580c' },
  LEVEL: { label: 'Water Level Monitoring', short: 'SWL&PWL', color: '#ca8a04' },
  GENSET: { label: 'Genset Monitoring', short: 'Genset PMS', color: '#b45309' },
};

const PM_CUSTOM_PALETTE = ['#7c3aed', '#4f46e5', '#059669', '#be185d', '#0369a1'];

export function pmActivityColor(type: string, title?: string) {
  if (PM_PRESETS[type]) return PM_PRESETS[type].color;
  if (/mmf|backwash/i.test(type) || /mmf|backwash/i.test(title ?? '')) return '#7c3aed';
  let h = 0;
  for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) >>> 0;
  return PM_CUSTOM_PALETTE[h % PM_CUSTOM_PALETTE.length];
}

export function addPmDays(d: string, n: number) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function addPmMonths(d: string, n: number) {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const max = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, max));
  return t.toISOString().slice(0, 10);
}

export function diffPmDays(a: string, b: string) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

export function formatPmDayHeading(date: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(date + 'T00:00:00Z'));
}

export function formatPmShortDay(date: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(date + 'T00:00:00Z'));
}

export function buildPmCalendarIcs(tasks: PmTask[], opBy: Map<string, PmOp>): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BP Waterworks//PM Calendar//EN'];
  for (const t of tasks) {
    const dt = t.scheduled_date.replace(/-/g, '');
    const nextDt = addPmDays(t.scheduled_date, 1).replace(/-/g, '');
    const crew = t.assigned_operator_ids.map((id) => opBy.get(id)?.full_name).filter(Boolean).join(', ');
    const credited =
      t.status === 'done'
        ? resolvePmCreditedOperators(t).map((id) => opBy.get(id)?.full_name).filter(Boolean).join(', ')
        : '';
    lines.push(
      'BEGIN:VEVENT',
      `UID:${t.id}@bpwi`,
      `DTSTART;VALUE=DATE:${dt}`,
      `DTEND;VALUE=DATE:${nextDt}`,
      `SUMMARY:${t.title}${t.locations.length ? ' - ' + t.locations.join(', ') : ''}`,
      `DESCRIPTION:${[
        crew ? 'Planned: ' + crew : '',
        credited && credited !== crew ? 'Performed by: ' + credited : '',
        t.asset ? 'Asset: ' + t.asset : '',
        t.remarks ?? '',
      ]
        .filter(Boolean)
        .join(' | ')}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export type PmTask = {
  id: string;
  legacy_key: string | null;
  activity_type: string;
  title: string;
  locations: string[];
  asset: string | null;
  assigned_operator_ids: string[];
  completed_by_operator_ids?: string[];
  scheduled_date: string;
  status: 'planned' | 'done' | 'postponed';
  completed_at: string | null;
  remarks: string | null;
};

export type PmOp = { id: string; full_name: string; phone_number: string | null };

export type PmActivityType = {
  id?: string;
  code: string;
  label: string;
  short_label: string;
  color: string;
  sort_order: number;
};

export type PmActivityChip = {
  type: string;
  label: string;
  short: string;
  color: string;
  count: number;
  sort: number;
};

export type PmDraft = {
  id?: string;
  legacy_key?: string | null;
  typeKey: string;
  custom: string;
  locations: string[];
  locationQuery: string;
  splitLocations: boolean;
  originalLocations?: string[];
  asset: string;
  assignees: string[];
  completedBy: string[];
  date: string;
  status: PmTask['status'];
  remarks: string;
  recurrence: PmRecurrenceConfig;
};

export type PmConfirmDelete = {
  scope: 'one' | 'series' | 'following';
  target?: { id: string; legacy_key: string | null; date: string };
};

interface PmPlannerModalsProps {
  canEdit: boolean;
  draft: PmDraft | null;
  setDraft: React.Dispatch<React.SetStateAction<PmDraft | null>>;
  busy: boolean;
  onSave: () => void;
  onRequestRemove: (scope: 'one' | 'series' | 'following', target?: { id: string; legacy_key: string | null; date: string }) => void;
  confirmDel: PmConfirmDelete | null;
  onCancelDelete: () => void;
  onExecuteDelete: () => void;
  editActsOpen: boolean;
  setEditActsOpen: (open: boolean) => void;
  actDraft: PmActivityType[];
  setActDraft: React.Dispatch<React.SetStateAction<PmActivityType[]>>;
  savingActs: boolean;
  onSaveActivities: () => void;
  activityChips: PmActivityChip[];
  operators: PmOp[];
  holidayByDate: Map<string, { holiday_date: string; name: string; holiday_type: string }>;
  getOperatorConflict: (date: string, opId: string) => string | null;
  savedLocationCatalog: PmLocationOption[];
  onOpenManageLocations: () => void;
  gensets?: GensetRow[];
  onOpenManageGensets?: () => void;
  modalError?: string;
}

export default function PmPlannerModals({
  canEdit,
  draft,
  setDraft,
  busy,
  onSave,
  onRequestRemove,
  confirmDel,
  onCancelDelete,
  onExecuteDelete,
  editActsOpen,
  setEditActsOpen,
  actDraft,
  setActDraft,
  savingActs,
  onSaveActivities,
  activityChips,
  operators,
  holidayByDate,
  getOperatorConflict,
  savedLocationCatalog,
  onOpenManageLocations,
  gensets = [],
  onOpenManageGensets,
  modalError,
}: PmPlannerModalsProps) {
  return (
    <>
      {/* Create / Edit Modal (Bottom Sheet on mobile, Dialog on desktop) */}
      {draft && (
        <div
          className="no-print modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pm-dialog-title"
          onClick={() => !busy && setDraft(null)}
        >
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ display: 'grid', gap: 10 }}>
            <h2 id="pm-dialog-title" style={{ margin: 0, fontSize: 17 }}>
              {draft.id ? 'Edit task' : 'Schedule PM task'}
            </h2>
            {modalError && (
              <div
                role="alert"
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: 'var(--danger-bg)',
                  color: 'var(--danger-fg)',
                  border: '1px solid var(--danger-border)',
                }}
              >
                {modalError}
              </div>
            )}
            <label style={{ fontSize: 13 }}>
              Activity
              <select
                className="input"
                value={draft.typeKey}
                onChange={(e) => {
                  const nextKey = e.target.value;
                  const nextLabel = activityChips.find((c) => c.type === nextKey)?.label ?? '';
                  const isGensetNew =
                    !draft.id && (/genset|generator/i.test(nextKey) || /genset|generator/i.test(nextLabel));
                  setDraft({
                    ...draft,
                    typeKey: nextKey,
                    ...(isGensetNew && draft.recurrence.mode === 'none'
                      ? {
                          recurrence: {
                            ...draft.recurrence,
                            mode: 'weekly' as const,
                            endMode: 'count' as const,
                            count: 4,
                          },
                        }
                      : {}),
                  });
                }}
              >
                {activityChips.map((c) => (
                  <option key={c.type} value={c.type}>
                    {c.label}
                  </option>
                ))}
                <option value="__custom">+ Custom activity…</option>
              </select>
            </label>
            {draft.typeKey === '__custom' && (
              <input
                className="input"
                placeholder="Custom activity name (e.g. MMF Backwashing)"
                value={draft.custom}
                onChange={(e) => setDraft({ ...draft, custom: e.target.value })}
              />
            )}
            <PmLocationPicker
              selected={draft.locations}
              query={draft.locationQuery}
              catalog={savedLocationCatalog}
              splitLocations={draft.splitLocations}
              showSplitOption={!draft.id}
              canManage={canEdit}
              legacyExisting={draft.originalLocations}
              onChangeSelected={(locations, clearQuery) =>
                setDraft({ ...draft, locations, ...(clearQuery ? { locationQuery: '' } : {}) })
              }
              onChangeQuery={(locationQuery) => setDraft({ ...draft, locationQuery })}
              onChangeSplit={(splitLocations) => setDraft({ ...draft, splitLocations })}
              onOpenManage={onOpenManageLocations}
            />
            {draft.typeKey === 'GENSET' && (
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'var(--surface-muted)',
                  border: '1px solid var(--border-light)',
                  display: 'grid',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
                    Assigned Gensets by Site
                  </span>
                  {canEdit && onOpenManageGensets && (
                    <button
                      type="button"
                      onClick={onOpenManageGensets}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        fontSize: 12,
                        fontWeight: 700,
                        color: 'var(--teal)',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      Manage gensets
                    </button>
                  )}
                </div>
                {draft.locations.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    Select a site above to auto-tag its assigned genset Control #.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {draft.locations.map((loc) => {
                      const assigned = findActiveGensetAtLocation(gensets, loc);
                      return (
                        <span
                          key={loc}
                          style={{
                            padding: '2px 8px',
                            borderRadius: 999,
                            fontSize: 11.5,
                            fontWeight: 600,
                            background: assigned ? 'var(--ok-bg)' : 'var(--warn-bg)',
                            color: assigned ? 'var(--ok-fg)' : 'var(--warn-fg)',
                            border: assigned ? '1px solid var(--ok-border)' : '1px solid var(--warn-border)',
                          }}
                        >
                          {loc} → {assigned ? formatGensetTag(assigned) : 'No active genset'}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <label style={{ fontSize: 13 }}>
              {draft.typeKey === 'GENSET' ? 'Asset / Genset Control #' : 'Asset'}{' '}
              <input
                className="input"
                placeholder={
                  draft.typeKey === 'GENSET'
                    ? 'Auto-filled per site from assigned genset (optional override)'
                    : undefined
                }
                value={draft.asset}
                onChange={(e) => setDraft({ ...draft, asset: e.target.value })}
              />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <label style={{ fontSize: 13, flex: 1 }}>
                Date{' '}
                <input
                  type="date"
                  className="input"
                  value={draft.date}
                  onChange={(e) => {
                    const nextDate = e.target.value;
                    setDraft({
                      ...draft,
                      date: nextDate,
                      recurrence: nextDate
                        ? syncRecurrenceForStartDate(draft.recurrence, draft.date, nextDate)
                        : draft.recurrence,
                    });
                  }}
                />
              </label>
              <label style={{ fontSize: 13, flex: 1 }}>
                Status
                <select
                  className="input"
                  value={draft.status}
                  onChange={(e) => {
                    const nextStatus = e.target.value as PmTask['status'];
                    setDraft({
                      ...draft,
                      status: nextStatus,
                      completedBy:
                        nextStatus === 'done' && draft.completedBy.length === 0
                          ? draft.assignees
                          : draft.completedBy,
                    });
                  }}
                >
                  <option value="planned">Planned</option>
                  <option value="done">Done</option>
                  <option value="postponed">Postponed</option>
                </select>
              </label>
            </div>
            {holidayByDate.get(draft.date) && (
              <div style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, background: 'var(--warn-bg)', color: 'var(--warn-fg)', border: '1px solid var(--warn-border)', fontWeight: 600 }}>
                ★ Note: {holidayByDate.get(draft.date)!.name} ({holidayByDate.get(draft.date)!.holiday_type.replace(/_/g, ' ')}) falls on this date.
              </div>
            )}
            <fieldset style={{ border: '1px solid var(--border-light)', borderRadius: 8, maxHeight: 120, overflow: 'auto', fontSize: 12 }}>
              <legend>Planned Assignees</legend>
              {operators.map((o) => {
                const cReason = getOperatorConflict(draft.date, o.id);
                return (
                  <label
                    key={o.id}
                    style={{
                      display: 'inline-flex',
                      gap: 4,
                      margin: '2px 10px 2px 0',
                      color: cReason ? 'var(--danger)' : undefined,
                      fontWeight: cReason ? 700 : undefined,
                    }}
                    title={cReason ? `Schedule conflict on ${draft.date}: ${cReason}` : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={draft.assignees.includes(o.id)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          assignees: e.target.checked
                            ? [...draft.assignees, o.id]
                            : draft.assignees.filter((x) => x !== o.id),
                        })
                      }
                    />
                    {cReason ? `⚠ ${o.full_name} (${cReason})` : o.full_name}
                  </label>
                );
              })}
            </fieldset>
            {draft.status === 'done' && (
              <fieldset style={{ border: '1px solid var(--border-light)', borderRadius: 8, maxHeight: 120, overflow: 'auto', fontSize: 12 }}>
                <legend>Actual Performers (Credited for KPI)</legend>
                {operators.map((o) => {
                  const isPlanned = draft.assignees.includes(o.id);
                  const checked = draft.completedBy.includes(o.id);
                  return (
                    <label
                      key={o.id}
                      style={{
                        display: 'inline-flex',
                        gap: 4,
                        margin: '2px 10px 2px 0',
                        color: checked && !isPlanned ? 'var(--warn-fg)' : undefined,
                        fontWeight: checked && !isPlanned ? 700 : undefined,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            completedBy: e.target.checked
                              ? [...draft.completedBy, o.id]
                              : draft.completedBy.filter((x) => x !== o.id),
                          })
                        }
                      />
                      {o.full_name}
                      {!isPlanned && checked ? ' (Sub)' : ''}
                    </label>
                  );
                })}
              </fieldset>
            )}
            {(/genset|generator/i.test(draft.typeKey) ||
              /genset|generator/i.test(activityChips.find((c) => c.type === draft.typeKey)?.label ?? '')) && (
              <div
                style={{
                  fontSize: 12,
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: 'var(--warn-bg)',
                  color: 'var(--warn-fg)',
                  border: '1px solid var(--warn-border)',
                  lineHeight: 1.4,
                }}
              >
                <strong>Weekly Genset PMS Standard:</strong> Run <b>15–20 min no-load</b> weekly when unused (or log{' '}
                <i>Inspection Only</i> if already run on outage); check oil, coolant/battery, fuel level, leaks, noise &amp; smoke.
              </div>
            )}
            <label style={{ fontSize: 13 }}>
              Remarks{' '}
              <input
                className="input"
                placeholder={
                  /genset|generator/i.test(draft.typeKey)
                    ? 'e.g. Weekly 15–20m no-load exercise, oil/fuel check'
                    : undefined
                }
                value={draft.remarks}
                onChange={(e) => setDraft({ ...draft, remarks: e.target.value })}
              />
            </label>
            {draft.id && draft.legacy_key?.startsWith('S') && (
              <div
                style={{
                  fontSize: 12,
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: 'var(--info-bg)',
                  color: 'var(--info-fg)',
                  border: '1px solid var(--info-border)',
                  fontWeight: 600,
                }}
              >
                ↻ Part of a recurring PM series. Edits apply to this occurrence; use delete actions below to remove following tasks or the entire series.
              </div>
            )}
            {!draft.id && (
              <PmRepeatBuilder
                startDate={draft.date}
                recurrence={draft.recurrence}
                onChange={(recurrence) => setDraft({ ...draft, recurrence })}
                holidayByDate={holidayByDate}
              />
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {draft.id && (
                  <button className="btn" style={{ color: 'var(--danger)' }} onClick={() => onRequestRemove('one')}>
                    Delete
                  </button>
                )}
                {draft.id && draft.legacy_key?.startsWith('S') && (
                  <>
                    <button className="btn" style={{ color: 'var(--danger)' }} onClick={() => onRequestRemove('following')}>
                      Delete this &amp; following
                    </button>
                    <button className="btn" style={{ color: 'var(--danger)' }} onClick={() => onRequestRemove('series')}>
                      Delete series
                    </button>
                  </>
                )}
              </span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button className="btn" onClick={() => setDraft(null)} disabled={busy}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={onSave} disabled={busy}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {confirmDel && (
        <div
          className="no-print modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pm-del-title"
          onClick={onCancelDelete}
        >
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400, display: 'grid', gap: 12 }}>
            <h2 id="pm-del-title" style={{ margin: 0, fontSize: 16 }}>
              {confirmDel.scope === 'one'
                ? 'Delete this task?'
                : confirmDel.scope === 'series'
                  ? 'Delete the entire series?'
                  : 'Delete this and following tasks?'}
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
              This action cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={onCancelDelete}>
                Cancel
              </button>
              <button
                className="btn"
                style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-border)', color: 'var(--danger-fg)', fontWeight: 700 }}
                onClick={onExecuteDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit PM Activities & Colors Modal */}
      {editActsOpen && (
        <div
          className="no-print modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-acts-title"
          onClick={() => !savingActs && setEditActsOpen(false)}
        >
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 id="edit-acts-title" style={{ margin: 0, fontSize: 17 }}>
                Edit PM Activity Names &amp; Colors
              </h2>
              <button
                className="btn btn-add"
                onClick={() =>
                  setActDraft((a) => [
                    ...a,
                    {
                      code: `CUSTOM_${a.length + 1}`,
                      label: 'New Activity',
                      short_label: 'New Activity',
                      color: '#0284c7',
                      sort_order: a.length,
                    },
                  ])
                }
              >
                + Add activity
              </button>
            </div>

            <div style={{ display: 'grid', gap: 8, maxHeight: '58vh', overflow: 'auto', paddingRight: 4 }}>
              {actDraft.map((a, i) => (
                <div
                  key={`${a.code}-${i}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '40px 1fr 1fr 110px',
                    gap: 8,
                    alignItems: 'center',
                    padding: '6px 8px',
                    background: 'var(--surface-muted)',
                    borderRadius: 8,
                    border: '1px solid var(--border-light)',
                  }}
                >
                  <input
                    type="color"
                    aria-label={`Color for ${a.label}`}
                    value={a.color}
                    onChange={(e) =>
                      setActDraft((list) => list.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))
                    }
                    style={{ width: 36, height: 30, padding: 0, border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}
                  />
                  <input
                    className="input"
                    aria-label="Full activity name"
                    placeholder="Full name (e.g. Line Flushing)"
                    value={a.label}
                    onChange={(e) =>
                      setActDraft((list) => list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                    }
                  />
                  <input
                    className="input"
                    aria-label="Short pill label"
                    placeholder="Pill label (e.g. Flushing)"
                    value={a.short_label}
                    onChange={(e) =>
                      setActDraft((list) => list.map((x, j) => (j === i ? { ...x, short_label: e.target.value } : x)))
                    }
                  />
                  <span
                    style={{
                      background: a.color,
                      color: '#ffffff',
                      borderRadius: 999,
                      padding: '4px 10px',
                      fontSize: 11.5,
                      fontWeight: 700,
                      textAlign: 'center',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {a.short_label || a.label || a.code}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setEditActsOpen(false)} disabled={savingActs}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={onSaveActivities} disabled={savingActs}>
                {savingActs ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
