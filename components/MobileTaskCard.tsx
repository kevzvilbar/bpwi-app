'use client';

import { classifyPmCompletionRoles } from '@/lib/pm-credit';
import { Badge } from '@/components/ui';

export type MobileTask = {
  id: string;
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

export type MobileActType = { code: string; label: string; short_label: string; color: string };

const PRESET_COLOR: Record<string, string> = {
  FLUSH: '#0284c7',
  TANK: '#0d9488',
  PULL: '#db2777',
  THERM: '#ea580c',
  LEVEL: '#ca8a04',
  GENSET: '#b45309',
};

export interface MobileTaskCardProps {
  task: MobileTask;
  today: string;
  role: string;
  operatorId: string | null;
  canClosePm: boolean;
  canLogActivity?: boolean;
  actTypeMeta?: MobileActType;
  opBy: Map<string, { full_name: string }>;
  remarksValue: string;
  onRemarksChange: (value: string) => void;
  busy: boolean;
  onOpenLogger: (task: MobileTask) => void;
  onOpenCompleteModal: (task: MobileTask, mode: 'complete' | 'edit') => void;
  onReopenTask: (task: MobileTask) => void;
}

/** Renders a PM task card with performer credit badges and quick completion/close controls. */
export default function MobileTaskCard({
  task: t,
  today,
  role,
  operatorId,
  canClosePm,
  canLogActivity,
  actTypeMeta,
  opBy,
  remarksValue,
  onRemarksChange,
  busy,
  onOpenLogger,
  onOpenCompleteModal,
  onReopenTask,
}: MobileTaskCardProps) {
  const color = actTypeMeta?.color ?? PRESET_COLOR[t.activity_type] ?? '#7c3aed';
  const isDone = t.status === 'done';
  const isOverdue = !isDone && t.scheduled_date < today;
  const isToday = t.scheduled_date === today;
  const crew = t.assigned_operator_ids.map((id) => opBy.get(id)?.full_name).filter(Boolean);
  const roles = classifyPmCompletionRoles(t);
  const canCloseThis = canClosePm && (role !== 'operator' || Boolean(operatorId));
  const canModifyTask = canCloseThis && !(role === 'operator' && isDone);

  return (
    <div
      className="card card-pad-sm stack-sm"
      style={{ borderLeft: `4px solid ${isOverdue ? 'var(--danger)' : color}` }}
    >
      <div className="row-between-wrap" style={{ gap: 6 }}>
        <span
          className="badge"
          style={{
            background: 'var(--surface-muted)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
          }}
        >
          <span
            aria-hidden="true"
            style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }}
          />
          {actTypeMeta?.label ?? t.title}
        </span>
        <Badge tone={isDone ? 'ok' : isOverdue ? 'danger' : isToday ? 'info' : 'neutral'} size="sm">
          {isDone
            ? `Done${t.completed_at ? ` · ${t.completed_at}` : ''}`
            : isOverdue
              ? `Delayed · ${t.scheduled_date}`
              : isToday
                ? 'Today'
                : t.scheduled_date}
        </Badge>
      </div>

      {t.locations.length > 0 && <div className="font-bold" style={{ fontSize: 14 }}>{t.locations.join(', ')}</div>}
      {t.asset && <div className="text-secondary-sm">Asset: {t.asset}</div>}
      <div className="text-secondary-sm">
        {isDone ? 'Planned: ' : 'Assigned: '}
        <b>{crew.length ? crew.join(', ') : 'Unassigned'}</b>
      </div>

      {isDone && (
        <div className="stack-xs text-sm" style={{ gap: 2 }}>
          <div className="row-wrap" style={{ gap: 4 }}>
            <span className="text-secondary-sm">Performed by:</span>
            {roles.creditedIds.length === 0 ? (
              <span className="text-muted-sm">Not recorded</span>
            ) : (
              roles.creditedIds.map((id) => {
                const name = opBy.get(id)?.full_name ?? 'Unknown';
                const isSub = roles.substituteIds.includes(id);
                return (
                  <Badge key={id} size="sm" tone={isSub ? 'warn' : 'ok'}>
                    {name}
                    {isSub ? ' · Sub' : ''}
                  </Badge>
                );
              })
            )}
          </div>
          {roles.absentPlannedIds.length > 0 && (
            <div className="text-muted-xs">
              Planned not participating: {roles.absentPlannedIds.map((id) => opBy.get(id)?.full_name ?? id).join(', ')}
            </div>
          )}
        </div>
      )}

      {canModifyTask ? (
        <>
          <input
            className="input"
            aria-label="Completion remarks"
            placeholder="Completion notes / remarks…"
            value={remarksValue}
            onChange={(e) => onRemarksChange(e.target.value)}
            disabled={busy}
          />
          <div className="row-wrap" style={{ gap: 6 }}>
            {canLogActivity && !isDone && (
              <button
                type="button"
                className="btn btn-primary flex-1 font-bold"
                disabled={busy}
                onClick={() => onOpenLogger(t)}
              >
                📋 Log &amp; Complete
              </button>
            )}
            {isDone && (
              <button
                type="button"
                className="btn flex-1 font-bold"
                disabled={busy}
                onClick={() => onOpenCompleteModal(t, 'edit')}
              >
                Edit Crew
              </button>
            )}
            <button
              type="button"
              className={isDone ? 'btn flex-1 font-bold' : 'btn btn-teal-soft flex-1 font-bold'}
              disabled={busy}
              onClick={() => (isDone ? onReopenTask(t) : onOpenCompleteModal(t, 'complete'))}
            >
              {busy ? 'Updating…' : isDone ? 'Reopen Task' : '✓ Quick Done'}
            </button>
          </div>
        </>
      ) : (
        <div className="stack-xs">
          {t.remarks && <div className="text-secondary-xs">Notes: {t.remarks}</div>}
          {role === 'operator' && isDone && (
            <div className="text-muted-xs">
              Completed · ask a supervisor to reopen or edit crew.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
