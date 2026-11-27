'use client';

import { fmtTimeManila } from '@/lib/date';
import { extractGpsMetadata, formatGpsBadgeLabel } from '@/lib/gps-accuracy';
import { resolveActivityPhotoUrl } from '@/lib/activity-media';
import { ACTIVITY_BY_ID, type DailyActivityRow } from '@/lib/activity-types';
import { formatTelemetrySummary } from '@/lib/activity-telemetry';
import { Badge } from '@/components/ui';
import { SampleBadge } from '@/components/SampleBadge';

export type PrintPreviewMode =
  | 'activity'
  | 'meter_test'
  | 'well_pull_out'
  | 'tank_cleaning'
  | 'leak_volume_loss'
  | 'flushing_volume';

const SPECIAL_PRINT_BUTTONS: Record<string, { mode: PrintPreviewMode; label: string; color: string }> = {
  meter_test: { mode: 'meter_test', label: '🖨 Meter Certificate', color: 'var(--violet)' },
  well_pull_out: { mode: 'well_pull_out', label: '🖨 Pull-Out Form', color: 'var(--accent)' },
  tank_cleaning: { mode: 'tank_cleaning', label: '🖨 Tank Cleaning Report', color: 'var(--ok-fg)' },
  leak_repair: { mode: 'leak_volume_loss', label: '💧 Volume Loss Sheet', color: 'var(--danger)' },
  flushing: { mode: 'flushing_volume', label: '💧 Flushing Volume Sheet', color: 'var(--accent)' },
};

function daysUntil(iso: string | null | undefined) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export interface ActivityFeedCardProps {
  act: DailyActivityRow;
  area?: { code: string; name: string | null };
  leadName?: string;
  crewNames: string[];
  canVerifyActivity: boolean;
  canEdit: boolean;
  canDelete: boolean;
  isFlagging: boolean;
  flagReason: string;
  onFlagReasonChange: (reason: string) => void;
  onToggleFlag: () => void;
  onVerify: () => void;
  onConfirmFlag: () => void;
  onTogglePhotoHold?: () => void;
  onPrint: (mode: PrintPreviewMode) => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** Renders a single field activity card with telemetry, GPS badge, photos, and review actions. */
export default function ActivityFeedCard({
  act,
  area,
  leadName,
  crewNames,
  canVerifyActivity,
  canEdit,
  canDelete,
  isFlagging,
  flagReason,
  onFlagReasonChange,
  onToggleFlag,
  onVerify,
  onConfirmFlag,
  onTogglePhotoHold,
  onPrint,
  onEdit,
  onDelete,
}: ActivityFeedCardProps) {
  const def = ACTIVITY_BY_ID[act.activity_type];
  const telemetry = formatTelemetrySummary(act);
  const expDays = daysUntil(act.photos_expires_at);
  const statusTone = act.status === 'verified' ? 'ok' : act.status === 'flagged' ? 'danger' : 'info';
  const specialPrint = SPECIAL_PRINT_BUTTONS[act.activity_type];

  return (
    <div
      className="card card-pad stack-sm"
      style={{ display: 'flex', flexDirection: 'column', borderLeft: `4px solid ${def?.color ?? 'var(--accent)'}` }}
    >
      <div className="row-between">
        <span className="badge" style={{ background: def?.color ?? 'var(--primary)', color: '#ffffff' }}>
          {def?.label ?? act.activity_type}
        </span>
        <span className="row-wrap" style={{ gap: 5, justifyContent: 'flex-end' }}>
          {act.is_sample && <SampleBadge expiresAt={act.sample_expires_at} />}
          {act.photo_hold && !act.photos_purged_at && (
            <Badge size="sm" tone="warn">
              EVIDENCE HOLD
            </Badge>
          )}
          <Badge size="sm" tone={statusTone}>
            {act.status.toUpperCase()}
          </Badge>
        </span>
      </div>

      <div className="row-between font-bold" style={{ fontSize: 13.5, alignItems: 'start' }}>
        <span>
          {area ? `${area.code}${area.name ? ` · ${area.name}` : ''}` : 'Unassigned Area'}
          {act.site_or_well ? ` — ${act.site_or_well}` : ''}
        </span>
        <span className="text-secondary-xs" style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>
          {fmtTimeManila(act.completed_at ?? act.created_at)}
        </span>
      </div>

      {act.block_lot && <div className="text-secondary-xs">Location: {act.block_lot}</div>}

      <div className="text-sm">
        Lead: <b>{leadName ?? 'Unspecified'}</b>
        {crewNames.length > 0 && (
          <span className="text-secondary-sm"> · Crew: {crewNames.join(', ')}</span>
        )}
      </div>

      {telemetry.length > 0 && (
        <div
          className="card-pad-xs stack-xs text-xs"
          style={{ borderRadius: 6, background: 'var(--surface-muted)', gap: 2 }}
        >
          {telemetry.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

      {act.notes && <div className="text-sm">{act.notes}</div>}

      {act.review_note && (
        <div className="alert alert-danger card-pad-xs text-xs">
          <span>
            <b>Supervisor Note:</b> {act.review_note}
          </span>
        </div>
      )}

      {act.gps_lat != null && act.gps_lng != null && (() => {
        const gpsMeta = extractGpsMetadata(act.details);
        const gpsLabel = formatGpsBadgeLabel(act.details);
        const gpsTone =
          gpsMeta.gpsSource === 'map_pin'
            ? 'warn'
            : (gpsMeta.gpsAccuracyM ?? 99) <= 5
              ? 'ok'
              : 'info';
        return (
          <div className="row-wrap text-xs">
            <a
              href={`https://maps.google.com/?q=${act.gps_lat},${act.gps_lng}`}
              target="_blank"
              rel="noreferrer"
              className="font-bold"
              style={{ color: 'var(--accent)' }}
            >
              📍 GPS: {act.gps_lat}, {act.gps_lng}
            </a>
            {gpsLabel && <Badge size="sm" tone={gpsTone}>{gpsLabel}</Badge>}
          </div>
        );
      })()}

      {/* Photo thumbnails or purged notice */}
      {act.photos_purged_at ? (
        <div className="text-muted-xs" style={{ fontStyle: 'italic' }}>
          Photos auto-purged after storage retention ({act.photos_purged_at.slice(0, 10)}).
        </div>
      ) : Array.isArray(act.photo_urls) && act.photo_urls.length > 0 ? (
        <div className="stack-xs">
          <div className="row-wrap">
            {act.photo_urls.map((u, idx) => {
              const photoSrc = resolveActivityPhotoUrl(u, act.photo_storage_paths?.[idx]);
              return (
                <a key={idx} href={photoSrc} target="_blank" rel="noreferrer">
                  <img
                    src={photoSrc}
                    alt={`Photo ${idx + 1}`}
                    style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }}
                  />
                </a>
              );
            })}
          </div>
          {act.photo_hold || act.status === 'flagged' ? (
            <span className="text-secondary-xs" style={{ color: 'var(--warn-fg)' }}>
              {act.photo_hold ? 'Protected by supervisor evidence hold (max 365d)' : 'Flagged log exempt from auto-purge (max 365d)'}
            </span>
          ) : (
            expDays !== null && (
              <span
                className="text-secondary-xs"
                style={{ color: expDays <= 5 ? 'var(--warn-fg)' : undefined }}
              >
                {expDays > 0 ? `Storage auto-expires in ${expDays}d` : 'Photo retention expired — ready to purge'}
              </span>
            )
          )}
        </div>
      ) : null}

      {/* Action Bar */}
      <div
        className="row-wrap"
        style={{ gap: 6, marginTop: 'auto', borderTop: '1px solid var(--border-light)', paddingTop: 8 }}
      >
        {canVerifyActivity && !act.is_sample && act.status !== 'verified' && (
          <button
            type="button"
            className="btn btn-sm font-bold"
            onClick={onVerify}
            style={{ background: 'var(--ok-bg)', color: 'var(--ok-fg)', borderColor: 'var(--ok-border)' }}
          >
            ✓ Verify
          </button>
        )}
        {canVerifyActivity && !act.is_sample && act.status !== 'flagged' && (
          <button
            type="button"
            className="btn btn-sm btn-danger-soft"
            onClick={onToggleFlag}
          >
            ⚠ Flag
          </button>
        )}
        {canVerifyActivity && !act.is_sample && !act.photos_purged_at && Array.isArray(act.photo_urls) && act.photo_urls.length > 0 && onTogglePhotoHold && (
          <button type="button" className="btn btn-sm" onClick={onTogglePhotoHold}>
            {act.photo_hold ? 'Release Hold' : 'Hold Photos'}
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={() => onPrint('activity')}>
          🖨 Print Report
        </button>
        {specialPrint && (
          <button
            type="button"
            className="btn btn-sm font-bold"
            onClick={() => onPrint(specialPrint.mode)}
            style={{ color: specialPrint.color }}
          >
            {specialPrint.label}
          </button>
        )}
        {(canEdit || canDelete) && (
          <>
            {canEdit && (
              <button type="button" className="btn btn-sm" onClick={onEdit}>
                Edit
              </button>
            )}
            {canDelete && (
              <button type="button" className="btn btn-sm btn-danger-soft" onClick={onDelete}>
                Delete
              </button>
            )}
          </>
        )}
      </div>

      {isFlagging && (
        <div className="row-wrap" style={{ gap: 6, marginTop: 4 }}>
          <input
            className="input flex-1"
            placeholder="Reason for flagging…"
            value={flagReason}
            onChange={(e) => onFlagReasonChange(e.target.value)}
            style={{ fontSize: 12, minWidth: 160 }}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onConfirmFlag}
          >
            Confirm
          </button>
        </div>
      )}
    </div>
  );
}
