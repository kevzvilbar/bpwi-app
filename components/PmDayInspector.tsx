'use client';

import type { PmActivityChip, PmOp, PmTask } from '@/components/PmPlannerModals';
import { classifyPmCompletionRoles } from '@/lib/pm-credit';

interface PmDayInspectorProps {
  selectedDate: string;
  heading: string;
  dayRel: string;
  holiday?: { holiday_date: string; name: string; holiday_type: string };
  onDuty: number;
  onRest: number;
  onLeave: number;
  dayStandby: Array<{ operator_id: string; standby_type: string }>;
  dayTasks: PmTask[];
  operators: PmOp[];
  opBy: Map<string, PmOp>;
  activityMeta: Map<string, PmActivityChip>;
  fallbackColor: (type: string, title?: string) => string;
  getOperatorConflict: (date: string, opId: string) => string | null;
  canEdit: boolean;
  onUpdateTask: (
    t: PmTask,
    patch: Partial<Pick<PmTask, 'status' | 'assigned_operator_ids' | 'completed_by_operator_ids' | 'remarks'>>,
  ) => void;
  onRequestComplete?: (t: PmTask, mode: 'complete' | 'edit') => void;
  onEditTask: (t: PmTask) => void;
  onRemoveTask: (target: { id: string; legacy_key: string | null; date: string }) => void;
  onCreateNewTask: () => void;
}

export default function PmDayInspector({
  selectedDate: _selectedDate,
  heading,
  dayRel,
  holiday,
  onDuty,
  onRest,
  onLeave,
  dayStandby,
  dayTasks,
  operators,
  opBy,
  activityMeta,
  fallbackColor,
  getOperatorConflict,
  canEdit,
  onUpdateTask,
  onRequestComplete,
  onEditTask,
  onRemoveTask,
  onCreateNewTask,
}: PmDayInspectorProps) {
  return (
    <aside
      className="no-print card"
      style={{
        padding: 14,
        position: 'sticky',
        top: 68,
        display: 'grid',
        gap: 10,
      }}
    >
      <div>
        <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text)' }}>{heading}</h3>
        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
          {dayTasks.length} PM {dayTasks.length === 1 ? 'task' : 'tasks'} · {dayRel}
        </div>
        {holiday && (
          <div
            style={{
              marginTop: 6,
              display: 'inline-block',
              padding: '2px 8px',
              borderRadius: 6,
              fontSize: 11.5,
              fontWeight: 700,
              background: 'var(--danger-bg)',
              color: 'var(--danger-fg)',
            }}
          >
            ★ Holiday: {holiday.name} ({holiday.holiday_type.replace(/_/g, ' ')})
          </div>
        )}
      </div>

      {/* Crew & Standby Summary */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', fontSize: 11, fontWeight: 700 }}>
        <span style={{ background: 'var(--ok-bg)', color: 'var(--ok-fg)', padding: '2px 7px', borderRadius: 999 }}>
          {onDuty} on duty
        </span>
        <span style={{ background: 'var(--warn-bg)', color: 'var(--warn-fg)', padding: '2px 7px', borderRadius: 999 }}>
          {onRest} rest
        </span>
        <span style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)', padding: '2px 7px', borderRadius: 999 }}>
          {onLeave} leave
        </span>
        <span style={{ background: 'var(--violet-bg)', color: 'var(--violet-fg)', padding: '2px 7px', borderRadius: 999 }}>
          ⚡ {dayStandby.length} standby
        </span>
      </div>

      {dayStandby.length > 0 && (
        <div style={{ display: 'grid', gap: 4 }}>
          {dayStandby.map((sb) => {
            const op = opBy.get(sb.operator_id);
            if (!op) return null;
            return (
              <div
                key={sb.operator_id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 6,
                  background: 'var(--violet-bg)',
                  border: '1px solid var(--violet-border)',
                  borderRadius: 6,
                  padding: '4px 8px',
                  fontSize: 11.5,
                }}
              >
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>{op.full_name}</span>
                <span style={{ color: 'var(--violet-fg)', fontFamily: 'ui-monospace, monospace', fontSize: 10.5, fontWeight: 600 }}>
                  {sb.standby_type}
                  {op.phone_number ? ` · ${op.phone_number}` : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 10, display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
          MAINTENANCE TASKS
        </div>

        {dayTasks.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>No maintenance tasks scheduled for this day.</p>
        ) : (
          dayTasks.map((t) => {
            const meta = activityMeta.get(t.activity_type);
            const color = meta?.color ?? fallbackColor(t.activity_type, t.title);
            const availableOps = operators.filter((o) => !t.assigned_operator_ids.includes(o.id));
            const roles = classifyPmCompletionRoles(t);
            return (
              <div
                key={t.id}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 10,
                  display: 'grid',
                  gap: 6,
                  background: 'var(--surface-muted)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 700, fontSize: 12.5, color: 'var(--text)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
                    {meta?.label ?? t.title}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 999,
                      background: t.status === 'done' ? 'var(--ok-bg)' : t.status === 'postponed' ? 'var(--warn-bg)' : 'var(--border-light)',
                      color: t.status === 'done' ? 'var(--ok-fg)' : t.status === 'postponed' ? 'var(--warn-fg)' : 'var(--text)',
                    }}
                  >
                    {t.status}
                  </span>
                </div>

                {t.locations.length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t.locations.join(', ')}</div>
                )}

                {/* Crew Chips */}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {t.assigned_operator_ids.map((id) => {
                    const op = opBy.get(id);
                    if (!op) return null;
                    const conflictReason = t.status !== 'done' ? getOperatorConflict(t.scheduled_date, id) : null;
                    const chipBg = conflictReason ? 'var(--danger-bg)' : 'var(--ok-bg)';
                    const chipFg = conflictReason ? 'var(--danger-fg)' : 'var(--ok-fg)';
                    const chipBorder = conflictReason ? '1px solid var(--danger-border)' : '1px solid transparent';
                    return (
                      <span
                        key={id}
                        title={conflictReason ? `Schedule conflict: ${conflictReason}` : 'On duty'}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          background: chipBg,
                          color: chipFg,
                          border: chipBorder,
                          padding: '2px 7px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {conflictReason ? `⚠ ${op.full_name} (${conflictReason})` : op.full_name}
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateTask(t, {
                                assigned_operator_ids: t.assigned_operator_ids.filter((x) => x !== id),
                              })
                            }
                            style={{
                              border: 'none',
                              background: 'transparent',
                              color: chipFg,
                              cursor: 'pointer',
                              padding: '0 4px',
                              lineHeight: 1,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 800,
                            }}
                          >
                            ×
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>

                {t.status === 'done' && (
                  <div style={{ display: 'grid', gap: 3, fontSize: 11 }}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>Performed by:</span>
                      {roles.creditedIds.length === 0 ? (
                        <span style={{ color: 'var(--text-muted)' }}>None recorded</span>
                      ) : (
                        roles.creditedIds.map((id) => {
                          const op = opBy.get(id);
                          const isSub = roles.substituteIds.includes(id);
                          return (
                            <span
                              key={id}
                              style={{
                                background: isSub ? 'var(--warn-bg)' : 'var(--info-bg)',
                                color: isSub ? 'var(--warn-fg)' : 'var(--info-fg)',
                                borderRadius: 999,
                                padding: '1px 7px',
                                fontWeight: 700,
                              }}
                            >
                              {op?.full_name ?? id}
                              {isSub ? ' · Sub' : ''}
                            </span>
                          );
                        })
                      )}
                    </div>
                    {roles.absentPlannedIds.length > 0 && (
                      <div style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>
                        Planned not participating: {roles.absentPlannedIds.map((id) => opBy.get(id)?.full_name ?? id).join(', ')}
                      </div>
                    )}
                  </div>
                )}

                {canEdit && (
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    <select
                      className="btn"
                      style={{ padding: '3px 6px', fontSize: 11 }}
                      value={t.status}
                      onChange={(e) => {
                        const next = e.target.value as PmTask['status'];
                        if (next === 'done' && onRequestComplete) {
                          onRequestComplete(t, 'complete');
                          return;
                        }
                        onUpdateTask(t, { status: next });
                      }}
                    >
                      <option value="planned">Planned</option>
                      <option value="done">Done</option>
                      <option value="postponed">Postponed</option>
                    </select>
                    <select
                      className="btn"
                      style={{ padding: '3px 6px', fontSize: 11, flex: 1, minWidth: 0, maxWidth: '100%' }}
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          onUpdateTask(t, { assigned_operator_ids: [...t.assigned_operator_ids, e.target.value] });
                        }
                      }}
                    >
                      <option value="">+ Add crew…</option>
                      {availableOps.map((o) => {
                        const cReason = getOperatorConflict(t.scheduled_date, o.id);
                        return (
                          <option key={o.id} value={o.id}>
                            {cReason ? `⚠ ${o.full_name} (${cReason})` : o.full_name}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}

                {canEdit && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {t.status === 'done' && onRequestComplete && (
                      <button
                        type="button"
                        className="btn btn-xs"
                        onClick={() => onRequestComplete(t, 'edit')}
                      >
                        Edit crew
                      </button>
                    )}
                    <button className="btn btn-xs" onClick={() => onEditTask(t)}>
                      Edit
                    </button>
                    <button
                      className="btn btn-xs"
                      style={{ color: 'var(--danger)' }}
                      onClick={() => onRemoveTask({ id: t.id, legacy_key: t.legacy_key, date: t.scheduled_date })}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {canEdit && (
        <button
          className="btn btn-add"
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: 999,
          }}
          onClick={onCreateNewTask}
        >
          + Schedule PM on this day
        </button>
      )}
    </aside>
  );
}
