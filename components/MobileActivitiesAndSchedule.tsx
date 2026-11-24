'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { ACTIVITY_BY_ID, type DailyActivityRow } from '@/lib/activity-types';
import { resolveActivityPhotoUrl } from '@/lib/activity-media';
import { DEFAULT_STATION_CODE } from '@/lib/roster-helpers';
import { SampleBadge } from '@/components/SampleBadge';
import ConfirmDialog from '@/components/ConfirmDialog';

export type MobileOp = {
  id: string;
  full_name: string;
  position: string | null;
  phone_number: string | null;
  default_station: string | null;
};

export type MobileShift = {
  id: string;
  code: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  background_color: string;
  text_color: string;
  is_off: boolean;
};

export type MobileArea = {
  id: string;
  code: string;
  name: string | null;
  category: string;
  sub_sites?: string[];
};

export type MobileScheduleRow = {
  op: MobileOp;
  shift: MobileShift | undefined;
  area: MobileArea | undefined;
  standbyType: string | undefined;
  isLeave: boolean;
  isRestDay: boolean;
  isOnDuty: boolean;
  isNow: boolean;
};

function addDays(d: string, n: number) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

interface MobileActivitiesAndScheduleProps {
  tab: 'activities' | 'schedule';
  date: string;
  today: string;
  role: string;
  userId?: string;
  canLogActivity?: boolean;
  canLogSampleActivity?: boolean;
  scopedActivities: DailyActivityRow[];
  scheduleList: MobileScheduleRow[];
  opBy: Map<string, MobileOp>;
  areaBy: Map<string, MobileArea>;
  onEditActivity: (act: DailyActivityRow) => void;
  onActivityDeleted: (actId: string) => void;
  onNavigateDate: (nextDate: string) => void;
  onError: (msg: string) => void;
}

export default function MobileActivitiesAndSchedule({
  tab,
  date,
  today,
  role,
  userId,
  canLogActivity,
  canLogSampleActivity,
  scopedActivities,
  scheduleList,
  opBy,
  areaBy,
  onEditActivity,
  onActivityDeleted,
  onNavigateDate,
  onError,
}: MobileActivitiesAndScheduleProps) {
  const [pendingDeleteAct, setPendingDeleteAct] = useState<DailyActivityRow | null>(null);
  const [deletingAct, setDeletingAct] = useState(false);

  async function confirmDeleteActivity() {
    if (!pendingDeleteAct) return;
    const targetId = pendingDeleteAct.id;
    setDeletingAct(true);
    try {
      const { error } = await supabaseBrowser().from('daily_activities').delete().eq('id', targetId);
      if (error) {
        onError(error.message);
        return;
      }
      onActivityDeleted(targetId);
    } finally {
      setDeletingAct(false);
      setPendingDeleteAct(null);
    }
  }

  if (tab === 'activities') {
    const statusColors: Record<string, { bg: string; fg: string }> = {
      verified: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
      flagged: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
      submitted: { bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
      draft: { bg: 'var(--surface-muted)', fg: 'var(--text-secondary)' },
    };

    return (
      <div style={{ display: 'grid', gap: 10 }}>
        {!canLogActivity && (
          <div className="card" style={{ padding: '8px 12px', fontSize: 12.5, color: 'var(--text-secondary)' }}>
            {canLogSampleActivity ? (
              <>Real activity submission is restricted to <b>operator</b> and <b>admin</b> logins. You can log <b>24h sample logs</b> above.</>
            ) : (
              <>Only active <b>operator</b> and <b>admin</b> accounts can submit daily activity logs.</>
            )}
          </div>
        )}

        {scopedActivities.length === 0 ? (
          <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13.5 }}>
            No field activities logged yet for <b>{date}</b>.
          </div>
        ) : (
          <div className="schedule-cards-grid">
            {scopedActivities.map((act) => {
              const def = ACTIVITY_BY_ID[act.activity_type];
              const area = act.area_code_id ? areaBy.get(act.area_code_id) : undefined;
              const lead = act.lead_operator_id ? opBy.get(act.lead_operator_id) : undefined;
              const crewNames = (act.crew_operator_ids ?? []).map((id) => opBy.get(id)?.full_name).filter(Boolean);
              const sc = statusColors[act.status] ?? statusColors.submitted;
              const avgErr = act.details?.avgErr;
              const hasAvgErr = typeof avgErr === 'number' || typeof avgErr === 'string';

              return (
                <div
                  key={act.id}
                  className="card"
                  style={{
                    padding: 12,
                    display: 'grid',
                    gap: 6,
                    borderLeft: `4px solid ${def?.color ?? 'var(--accent)'}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        background: def?.color ?? 'var(--primary)',
                        color: '#ffffff',
                        padding: '2px 9px',
                        borderRadius: 999,
                        fontSize: 11.5,
                        fontWeight: 700,
                      }}
                    >
                      {def?.label ?? act.activity_type}
                    </span>
                    <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                      {act.is_sample && <SampleBadge expiresAt={act.sample_expires_at} />}
                      <span style={{ background: sc.bg, color: sc.fg, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
                        {act.status}
                      </span>
                    </span>
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                    {area ? `${area.code}${area.name ? ` · ${area.name}` : ''}` : 'Unassigned Station'}
                    {act.site_or_well ? ` — ${act.site_or_well}` : ''}
                  </div>
                  {act.block_lot && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Location: {act.block_lot}</div>}
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Lead: <b>{lead?.full_name ?? 'Unspecified'}</b>
                    {crewNames.length > 0 && <> · Crew: {crewNames.join(', ')}</>}
                  </div>
                  {hasAvgErr && (
                    <div style={{ fontSize: 12, fontWeight: 600, color: act.details?.verdict === 'Passed' ? 'var(--ok-fg)' : 'var(--danger)' }}>
                      Meter Test: {String(avgErr)}% ({String(act.details?.verdict ?? '')} · {String(act.details?.recommendation ?? '')})
                    </div>
                  )}
                  {act.notes && <div style={{ fontSize: 12.5, color: 'var(--text)' }}>{act.notes}</div>}
                  {Array.isArray(act.photo_urls) && act.photo_urls.length > 0 && !act.photos_purged_at && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                      {act.photo_urls.map((u, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={i}
                          src={resolveActivityPhotoUrl(u, act.photo_storage_paths?.[i])}
                          alt={`Activity photo ${i + 1}`}
                          style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }}
                        />
                      ))}
                    </div>
                  )}
                  {(role === 'admin' || (userId && act.logged_by === userId)) && act.status !== 'verified' && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, borderTop: '1px solid var(--border-light)', paddingTop: 6 }}>
                      <button
                        type="button"
                        className="btn"
                        style={{ minHeight: 32, padding: '2px 10px', fontSize: 12 }}
                        onClick={() => onEditActivity(act)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn"
                        style={{ minHeight: 32, padding: '2px 10px', fontSize: 12, color: 'var(--danger)' }}
                        onClick={() => setPendingDeleteAct(act)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <ConfirmDialog
          open={pendingDeleteAct !== null}
          title="Delete activity log?"
          description="This permanently removes the activity log from the feed. This action cannot be undone."
          confirmLabel={deletingAct ? 'Deleting…' : 'Delete log'}
          tone="danger"
          busy={deletingAct}
          onCancel={() => setPendingDeleteAct(null)}
          onConfirm={() => void confirmDeleteActivity()}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card" style={{ padding: 8, display: 'flex', gap: 6, alignItems: 'center', maxWidth: 420 }}>
        <button className="btn" onClick={() => onNavigateDate(addDays(date, -1))}>
          ‹
        </button>
        <input
          type="date"
          className="input"
          value={date}
          onChange={(e) => e.target.value && onNavigateDate(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="btn" onClick={() => onNavigateDate(addDays(date, 1))}>
          ›
        </button>
        {date !== today && (
          <button className="btn btn-primary" onClick={() => onNavigateDate(today)}>
            Today
          </button>
        )}
      </div>

      <div className="schedule-cards-grid">
        {scheduleList.map(({ op, shift, area, standbyType, isLeave, isRestDay, isOnDuty, isNow }) => (
          <div
            key={op.id}
            className="card"
            style={{
              padding: 12,
              display: 'grid',
              gap: 6,
              borderLeft: standbyType ? '4px solid var(--violet)' : undefined,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{op.full_name}</div>
                {op.position && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{op.position}</div>}
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {standbyType && (
                  <span style={{ background: '#6d28d9', color: '#ffffff', padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                    STANDBY · {standbyType}
                  </span>
                )}
                {isLeave ? (
                  <span style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)', padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                    LEAVE · {area?.code}
                  </span>
                ) : isRestDay ? (
                  <span style={{ background: 'var(--surface-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border)', padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                    REST · {area?.code}
                  </span>
                ) : isOnDuty && shift ? (
                  <span
                    style={{
                      background: shift.background_color,
                      color: shift.text_color,
                      padding: '3px 8px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      border: '1px solid var(--border)',
                    }}
                  >
                    {isNow ? 'ON DUTY NOW' : 'DUTY'} · {shift.code}
                  </span>
                ) : shift?.is_off ? (
                  <span style={{ background: 'var(--surface-muted)', color: 'var(--text-secondary)', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
                    OFF · {shift.code}
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>Unassigned</span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, color: 'var(--text-secondary)' }}>
              <span>Station: <b>{area?.code ?? (isOnDuty ? DEFAULT_STATION_CODE : op.default_station ?? '—')}</b></span>
              {op.phone_number && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <a
                    href={`tel:${op.phone_number}`}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 8,
                      background: '#0369a1',
                      color: '#ffffff',
                      textDecoration: 'none',
                      fontWeight: 700,
                      fontSize: 12.5,
                    }}
                  >
                    Call
                  </a>
                  <a href={`sms:${op.phone_number}`} className="btn" style={{ textDecoration: 'none', fontWeight: 700 }}>
                    SMS
                  </a>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
