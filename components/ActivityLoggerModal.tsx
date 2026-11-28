'use client';

import { useEffect, useState } from 'react';
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_LABELS,
  ACTIVITY_TYPES,
  type ActivityCategory,
  type LinkedJobOrder,
  type LinkedPmTask,
} from '@/lib/activity-types';
import { calcDurationMinutes } from '@/lib/activity-logger-details';
import { fmtTimeManila } from '@/lib/date';
import ActivityCategoryFields from '@/components/ActivityCategoryFields';
import ActivityMediaCapture from '@/components/ActivityMediaCapture';
import ConfirmDialog from '@/components/ConfirmDialog';
import {
  MAX_ACTIVITY_PHOTOS,
  useActivityLoggerForm,
  type ActivityLoggerModalProps,
  type LoggerArea,
  type LoggerAssignment,
  type LoggerOperator,
  type LoggerShift,
} from '@/components/useActivityLoggerForm';

export type { LinkedJobOrder, LinkedPmTask };
export type { LoggerOperator, LoggerArea, LoggerShift, LoggerAssignment, ActivityLoggerModalProps };

const STRUCTURED_MODAL_ACTIVITY_TYPES = new Set([
  'well_pull_out',
  'tank_cleaning',
  'genset_monitoring',
  'leak_repair',
  'flushing',
  'meter_test',
  'genset_fuel_distribution',
  'genset_fuel_refill',
  'chlorine_refill',
]);

/** Modal dialog for logging or editing field activities, linked PM completions, and Job Order fulfillments. */
export default function ActivityLoggerModal(p: ActivityLoggerModalProps) {
  const f = useActivityLoggerForm(p);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  useEffect(() => {
    if (!p.open) setConfirmDiscardOpen(false);
  }, [p.open]);

  if (!p.open) return null;

  const selArea = f.stationAreas.find((a) => a.id === f.areaCodeId);
  const subSites = selArea?.sub_sites ?? [];
  const modalMaxWidth = STRUCTURED_MODAL_ACTIVITY_TYPES.has(f.activityType) ? 780 : 680;

  function handleAttemptClose() {
    if (f.submitting) return;
    if (f.isDirty) {
      setConfirmDiscardOpen(true);
    } else {
      p.onClose();
    }
  }

  return (
    <>
      <div
        className="modal-overlay no-print"
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-logger-title"
        onClick={handleAttemptClose}
      >
      <form
        className="modal-sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={f.handleSubmit}
        style={{ maxWidth: modalMaxWidth, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}
      >
        <div
          className="row-between"
          style={{
            flexShrink: 0,
            padding: '16px 18px 12px',
            borderBottom: '1px solid var(--border-light)',
            background: 'var(--surface)',
          }}
        >
          <div>
            <h2 id="activity-logger-title" style={{ margin: 0, fontSize: 17 }}>
              {p.editingActivity
                ? 'Edit Field Activity'
                : p.linkedPmTask
                  ? `Log & Complete PM: ${p.linkedPmTask.title}`
                  : p.linkedJobOrder
                    ? `Fulfill Job Order: ${p.linkedJobOrder.jo_number}`
                    : 'Log Daily Field Activity'}
            </h2>
            <div className="text-secondary-xs">
              Date: <b>{p.date}</b> (Manila) · Auto-linked to Roster Shift &amp; Area
            </div>
          </div>
          <button type="button" className="btn" onClick={handleAttemptClose} disabled={f.submitting} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="stack-md" style={{ flex: '1 1 auto', overflowY: 'auto', minHeight: 0, padding: '14px 18px' }}>

        {f.draftRestoredAt && (
          <div
            role="status"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--info-border)',
              background: 'var(--info-bg)',
              color: 'var(--info-fg)',
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            <span>Restored unsaved draft from {fmtTimeManila(f.draftRestoredAt)}.</span>
            <button type="button" className="btn btn-sm" onClick={() => void f.startFreshDraft()}>
              Start Fresh
            </button>
          </div>
        )}

        {/* Core Fields */}
        <div className="grid-auto-md">
          <label className="field-label">
            Activity Type *
            <select
              className="input"
              value={f.activityType}
              onChange={(e) => f.setActivityType(e.target.value)}
              required
            >
              {ACTIVITY_CATEGORIES.map((cat: ActivityCategory) => (
                <optgroup key={cat} label={ACTIVITY_CATEGORY_LABELS[cat]}>
                  {ACTIVITY_TYPES.filter((a) => a.category === cat).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {p.linkedPmTask && (
              <span className="field-hint" style={{ fontWeight: 500, color: 'var(--accent)' }}>
                Auto-matched from PM: &ldquo;{p.linkedPmTask.title}&rdquo;
              </span>
            )}
          </label>

          <label className="field-label">
            Station / Area (from Setup)
            <select
              className="input"
              value={f.areaCodeId}
              onChange={(e) => {
                f.setAreaTouched(true);
                f.setAreaCodeId(e.target.value);
              }}
            >
              <option value="">— Select Area / Station —</option>
              {f.stationAreas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code}
                  {a.name ? ` · ${a.name}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid-auto-sm">
          <label className="field-label">
            Well / Pump / Site (optional)
            <input
              className="input"
              list="station-sub-sites-list"
              placeholder="e.g. Well 2, Booster 1, Mainline"
              value={f.siteOrWell}
              onChange={(e) => f.setSiteOrWell(e.target.value)}
            />
            {subSites.length > 0 && (
              <>
                <datalist id="station-sub-sites-list">
                  {subSites.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                <div className="row-wrap" style={{ gap: 4, marginTop: 2 }}>
                  {subSites.map((s) => {
                    const active = f.siteOrWell === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        className="chip-btn badge"
                        aria-pressed={active}
                        onClick={() => f.setSiteOrWell(s)}
                        style={{
                          cursor: 'pointer',
                          border: active ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                          background: active ? 'var(--primary)' : 'var(--surface-muted)',
                          color: active ? 'var(--primary-fg)' : 'var(--text-secondary)',
                        }}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </label>
          <label className="field-label">
            Block &amp; Lot / Location Detail
            <input
              className="input"
              placeholder="e.g. Block 004 Lot 012"
              value={f.blockLot}
              onChange={(e) => f.setBlockLot(e.target.value)}
            />
          </label>
        </div>

        {/* Lead & Crew Tagging */}
        <div className="card card-pad-sm stack-sm" style={{ background: 'var(--surface-muted)' }}>
          <div className="grid-auto-sm">
            <label className="field-label">
              Lead Operator
              <select className="input" value={f.leadOpId} onChange={(e) => f.setLeadOpId(e.target.value)}>
                <option value="">— Unspecified —</option>
                {p.operators.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.full_name}
                    {o.id === p.operatorId ? ' (Me)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-label">
              Shift (Roster-Linked)
              <select className="input" value={f.shiftTypeId} onChange={(e) => f.setShiftTypeId(e.target.value)}>
                <option value="">— None —</option>
                {p.shifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code}
                    {s.description ? ` · ${s.description}` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <div className="row-between" style={{ marginBottom: 4 }}>
              <span className="text-xs font-bold">
                Tag Co-Operators / Crew ({f.crewOpIds.length} tagged — all receive credit)
              </span>
              {f.otherOps.length > 0 && (
                <button
                  type="button"
                  onClick={() => f.setShowAllOps((v) => !v)}
                  className="btn-xs font-bold"
                  style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}
                >
                  {f.showAllOps ? 'Hide off-shift ops' : `+ Show all (${f.otherOps.length} more)`}
                </button>
              )}
            </div>
            <div className="row-wrap" style={{ gap: 6 }}>
              {f.sameShiftOps.concat(f.showAllOps ? f.otherOps : []).map((op) => {
                const selected = f.crewOpIds.includes(op.id);
                const dashed = !f.sameShiftOps.includes(op);
                return (
                  <button
                    key={op.id}
                    type="button"
                    className="chip-btn badge"
                    aria-pressed={selected}
                    onClick={() => f.toggleCrew(op.id)}
                    style={{
                      cursor: 'pointer',
                      border: selected ? '1.5px solid var(--primary)' : `1px ${dashed ? 'dashed' : 'solid'} var(--border)`,
                      background: selected ? 'var(--primary)' : 'var(--surface)',
                      color: selected ? 'var(--primary-fg)' : dashed ? 'var(--text-secondary)' : 'var(--text)',
                    }}
                  >
                    {selected ? '✓ ' : '+ '}
                    {op.full_name}
                  </button>
                );
              })}
              {f.sameShiftOps.length === 0 && f.otherOps.length === 0 && (
                <span className="text-secondary-xs">No other active operators available.</span>
              )}
            </div>
          </div>
        </div>

        {/* Dynamic Specialized Fields based on activityType */}
        <ActivityCategoryFields
          activityType={f.activityType}
          fields={f.details}
          setFields={f.setDetails}
          meterCalc={f.meterCalc}
          sigCanvasRef={f.sigCanvasRef}
          sigDrawingRef={f.sigDrawingRef}
          setHasSignature={f.setHasSignature}
          activityDate={p.date}
          leadOpName={f.leadOpName}
          performedBySummary={f.performedBySummary}
        />

        {/* Times + Notes (Pull-Out and Tank Cleaning collect start/finish & notes inside their structured forms) */}
        {f.activityType !== 'well_pull_out' && f.activityType !== 'tank_cleaning' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 10 }}>
              <label className="field-label">
                {f.activityType === 'backwash' ? 'Start Time *' : 'Start Time (optional)'}
                <input
                  className="input"
                  type="time"
                  required={f.activityType === 'backwash'}
                  value={f.startedHHMM}
                  onChange={(e) => {
                    const nextStart = e.target.value;
                    f.setStartedHHMM(nextStart);
                    if (f.activityType === 'backwash') {
                      const mins = calcDurationMinutes(nextStart, f.completedHHMM);
                      f.setDetails((prev) => ({ ...prev, backwashDurationMin: mins }));
                    }
                  }}
                />
              </label>
              <label className="field-label">
                {f.activityType === 'backwash' ? 'Completion Time *' : 'Completion Time'}
                <input
                  className="input"
                  type="time"
                  required={f.activityType === 'backwash'}
                  value={f.completedHHMM}
                  onChange={(e) => {
                    const nextEnd = e.target.value;
                    f.setCompletedHHMM(nextEnd);
                    if (f.activityType === 'backwash') {
                      const mins = calcDurationMinutes(f.startedHHMM, nextEnd);
                      f.setDetails((prev) => ({ ...prev, backwashDurationMin: mins }));
                    }
                  }}
                />
              </label>
            </div>

            <label className="field-label">
              Field Notes / Observations
              <textarea
                className="input"
                rows={2}
                value={f.notes}
                onChange={(e) => f.setNotes(e.target.value)}
                placeholder="Work performed, pressure/reading summary, follow-ups needed…"
                style={{ minHeight: 58 }}
              />
            </label>
          </>
        )}

        {/* GPS & 30-day Expiring Photo Capture */}
        <ActivityMediaCapture
          gpsLat={f.gpsLat}
          gpsLng={f.gpsLng}
          gpsAccuracyM={f.gpsAccuracyM}
          gpsSource={f.gpsSource}
          onGpsChange={f.handleGpsChange}
          uploadingPhoto={f.uploadingPhoto}
          onPhotoUpload={f.handlePhotoUpload}
          savedBytesTotal={f.savedBytesTotal}
          photos={f.photos}
          onRemovePhoto={f.handleRemovePhoto}
          maxPhotos={MAX_ACTIVITY_PHOTOS}
          helperNote={
            f.activityType === 'tank_cleaning'
              ? 'Photo 1 = Start (Pre-Cleaning) · Photo 2 = End (Post-Cleaning). Auto-deleted after 30 days.'
              : undefined
          }
        />

        {p.linkedJobOrder?.deadline && f.openAtMs > new Date(p.linkedJobOrder.deadline).getTime() && (
          <label className="alert alert-warn field-label">
            <span>⚠️ Job Order {p.linkedJobOrder.jo_number} is past its SLA deadline — TAT Justification (optional)</span>
            <input
              className="input"
              value={f.joTatJustification}
              onChange={(e) => f.setJoTatJustification(e.target.value)}
              placeholder="e.g. Awaited customer access / materials…"
            />
          </label>
        )}

        {!p.editingActivity && (p.sampleOnly || p.canLogSample) && (
          <label
            className="alert alert-warn row-between text-xs font-bold"
            style={{ cursor: p.sampleOnly ? 'default' : 'pointer' }}
          >
            <span className="row-sm">
              <input
                type="checkbox"
                checked={Boolean(p.sampleOnly || f.isSample)}
                disabled={Boolean(p.sampleOnly)}
                onChange={(e) => f.setIsSample(e.target.checked)}
              />
              <span>Log as sample (auto-deletes in 24h){p.sampleOnly ? ' · Required for department heads' : ''}</span>
            </span>
          </label>
        )}

        </div>

        <div
          style={{
            flexShrink: 0,
            padding: '12px 18px calc(12px + env(safe-area-inset-bottom))',
            borderTop: '1px solid var(--border-light)',
            background: 'var(--surface)',
            display: 'grid',
            gap: 8,
          }}
        >
          {f.errMsg && (
            <p role="alert" className="text-danger-sm font-bold" style={{ margin: 0 }}>
              {f.errMsg}
            </p>
          )}

          <div className="row-end">
            <button type="button" className="btn" onClick={handleAttemptClose} disabled={f.submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={f.submitting || f.uploadingPhoto}>
              {f.submitting
                ? 'Saving Activity…'
                : p.editingActivity
                  ? 'Save Changes'
                  : p.linkedPmTask
                    ? 'Log Activity & Complete PM'
                    : p.linkedJobOrder
                      ? 'Log Activity & Close JO'
                      : 'Submit Activity Log'}
            </button>
          </div>
        </div>
      </form>
      </div>
      <ConfirmDialog
        open={confirmDiscardOpen}
        title="Discard unsaved activity log?"
        description="You have unsaved changes in this activity log. Discarding will lose any edits, notes, or photos captured so far."
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
        tone="danger"
        onConfirm={() => {
          setConfirmDiscardOpen(false);
          void f.discardDraft();
          p.onClose();
        }}
        onCancel={() => setConfirmDiscardOpen(false)}
      />
    </>
  );
}
