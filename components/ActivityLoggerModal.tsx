'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_LABELS,
  ACTIVITY_TYPES,
  computeMeterTestResult,
  parse12DigitAccount,
  resolveActivityTypeFromPm,
  type ActivityCategory,
  type DailyActivityRow,
} from '@/lib/activity-types';
import { getErrorMessage } from '@/lib/error-utils';
import { resolveActivityPhotoUrl } from '@/lib/activity-media';
import {
  buildActivityDetailsPayload,
  hydrateActivityDetailFields,
  INITIAL_ACTIVITY_DETAIL_FIELDS,
  type ActivityDetailFieldsState,
} from '@/lib/activity-logger-details';
import { compressImageFile, uploadActivityPhoto } from '@/lib/image-compress';
import ActivityCategoryFields from '@/components/ActivityCategoryFields';
import ActivityMediaCapture, { type ActivityPhotoEntry } from '@/components/ActivityMediaCapture';

export type LoggerOperator = {
  id: string;
  full_name: string;
  position: string | null;
  default_station?: string | null;
};

export type LoggerArea = {
  id: string;
  code: string;
  name: string | null;
  category: string;
  sub_sites?: string[];
};

export type LoggerShift = {
  id: string;
  code: string;
  description?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  is_off?: boolean;
};

export type LoggerAssignment = {
  operator_id: string;
  shift_type_id: string | null;
  area_code_id: string | null;
};

export type LinkedPmTask = {
  id: string;
  title: string;
  activity_type: string;
  locations?: string[];
  asset?: string | null;
  assigned_operator_ids?: string[];
};

export type LinkedJobOrder = {
  id: string;
  jo_number: string;
  title: string;
  activity_type?: string | null;
  area_code_id?: string | null;
  site_or_well?: string | null;
  block_lot?: string | null;
  account_number?: string | null;
  account_name?: string | null;
  assigned_operator_ids?: string[];
};

function currentManilaHHMM() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const h = parts.find((p) => p.type === 'hour')?.value ?? '08';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h === '24' ? '00' : h}:${m}`;
}

function toManilaTimestampIso(ymd: string, hhmm: string): string | null {
  if (!ymd || !hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  try {
    return new Date(`${ymd}T${hhmm}:00+08:00`).toISOString();
  } catch {
    return null;
  }
}

export default function ActivityLoggerModal(p: {
  open: boolean;
  onClose: () => void;
  onSaved: (activity: DailyActivityRow, opts?: { offline?: boolean }) => void;
  orgId: string;
  userId: string;
  operatorId: string | null;
  date: string;
  operators: LoggerOperator[];
  areas: LoggerArea[];
  shifts: LoggerShift[];
  assignments: LoggerAssignment[];
  initialActivityType?: string;
  initialLeadOperatorId?: string | null;
  linkedPmTask?: LinkedPmTask | null;
  pmActivityTypes?: Array<{ code: string; label: string; short_label?: string }>;
  linkedJobOrder?: LinkedJobOrder | null;
  editingActivity?: DailyActivityRow | null;
  onQueuedOffline?: (payload: Record<string, unknown>) => Promise<void> | void;
}) {
  const stationAreas = useMemo(() => {
    const onlyStations = p.areas.filter((a) => a.category === 'station');
    return onlyStations.length > 0
      ? onlyStations
      : p.areas.filter((a) => a.category !== 'leave' && a.category !== 'rest' && a.category !== 'holiday');
  }, [p.areas]);

  const shiftBy = useMemo(() => new Map(p.shifts.map((s) => [s.id, s])), [p.shifts]);
  const asgByOp = useMemo(() => new Map(p.assignments.map((a) => [a.operator_id, a])), [p.assignments]);
  const stationIdSet = useMemo(() => new Set(stationAreas.map((a) => a.id)), [stationAreas]);

  const [activityType, setActivityType] = useState<string>('pump_monitoring');
  const [leadOpId, setLeadOpId] = useState<string>('');
  const [crewOpIds, setCrewOpIds] = useState<string[]>([]);
  const [showAllOps, setShowAllOps] = useState(false);
  const [shiftTypeId, setShiftTypeId] = useState<string>('');
  const [areaCodeId, setAreaCodeId] = useState<string>('');
  const [areaTouched, setAreaTouched] = useState(false);
  const [siteOrWell, setSiteOrWell] = useState<string>('');
  const [blockLot, setBlockLot] = useState<string>('');
  const [startedHHMM, setStartedHHMM] = useState<string>('');
  const [completedHHMM, setCompletedHHMM] = useState<string>(currentManilaHHMM());
  const [notes, setNotes] = useState<string>('');

  // GPS state
  const [gpsLat, setGpsLat] = useState<number | null>(null);
  const [gpsLng, setGpsLng] = useState<number | null>(null);
  const [gpsStatus, setGpsStatus] = useState<string>('');

  // Photos state
  const [photos, setPhotos] = useState<ActivityPhotoEntry[]>([]);
  const [savedBytesTotal, setSavedBytesTotal] = useState(0);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Dynamic category-specific telemetry state
  const [details, setDetails] = useState<ActivityDetailFieldsState>(INITIAL_ACTIVITY_DETAIL_FIELDS);

  // Signature pad ref for meter_test
  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sigDrawingRef = useRef(false);
  const [hasSignature, setHasSignature] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const lastParsedRef = useRef('');

  // Initialize defaults whenever modal opens
  useEffect(() => {
    if (!p.open) return;
    setErrMsg('');
    setGpsLat(null);
    setGpsLng(null);
    setGpsStatus('');
    setPhotos([]);
    setSavedBytesTotal(0);
    setHasSignature(false);
    setAreaTouched(false);
    setStartedHHMM('');
    setCompletedHHMM(currentManilaHHMM());
    setNotes('');
    lastParsedRef.current = '';

    // Reset all activity-specific telemetry fields so previous submissions never bleed over
    setDetails({
      ...INITIAL_ACTIVITY_DETAIL_FIELDS,
      accountNumber: p.linkedJobOrder?.account_number ?? '',
      accountName: p.linkedJobOrder?.account_name ?? '',
    });

    if (p.editingActivity) {
      const ea = p.editingActivity;
      const d = (ea.details ?? {}) as Record<string, unknown>;
      setActivityType(ea.activity_type);
      setLeadOpId(ea.lead_operator_id ?? '');
      setCrewOpIds(ea.crew_operator_ids ?? []);
      setShiftTypeId(ea.shift_type_id ?? '');
      setAreaCodeId(ea.area_code_id ?? '');
      setAreaTouched(true);
      setSiteOrWell(ea.site_or_well ?? '');
      setBlockLot(ea.block_lot ?? '');
      setNotes(ea.notes ?? '');
      setGpsLat(ea.gps_lat);
      setGpsLng(ea.gps_lng);
      setPhotos(
        (ea.photo_urls ?? []).map((u, idx) => {
          const sp = ea.photo_storage_paths?.[idx] ?? null;
          const resolved = resolveActivityPhotoUrl(u, sp);
          return {
            url: resolved,
            storagePath: sp,
            preview: resolved,
          };
        }),
      );
      const toHHMM = (iso: string | null) => {
        if (!iso) return '';
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
        const hh = parts.find((x) => x.type === 'hour')?.value ?? '';
        const mm = parts.find((x) => x.type === 'minute')?.value ?? '';
        return hh && mm ? `${hh === '24' ? '00' : hh}:${mm}` : '';
      };
      setStartedHHMM(toHHMM(ea.started_at));
      setCompletedHHMM(toHHMM(ea.completed_at) || currentManilaHHMM());
      setDetails(hydrateActivityDetailFields(d));
      return;
    }

    // Determine initial activity type (reconciles preset codes, custom PM types, and title keywords)
    const pmMapped = p.linkedPmTask
      ? resolveActivityTypeFromPm(p.linkedPmTask, p.pmActivityTypes)
      : undefined;
    const initAct =
      p.linkedJobOrder?.activity_type ||
      pmMapped ||
      p.initialActivityType ||
      'pump_monitoring';
    setActivityType(ACTIVITY_TYPES.some((a) => a.id === initAct) ? initAct : 'pump_monitoring');

    // Lead operator
    const defaultLead =
      p.initialLeadOperatorId ??
      p.linkedJobOrder?.assigned_operator_ids?.[0] ??
      p.linkedPmTask?.assigned_operator_ids?.[0] ??
      p.operatorId ??
      '';
    setLeadOpId(defaultLead);

    // Pre-populate crew from linked PM or JO (excluding lead)
    const linkedCrew =
      p.linkedJobOrder?.assigned_operator_ids ??
      p.linkedPmTask?.assigned_operator_ids ??
      [];
    setCrewOpIds(linkedCrew.filter((id) => id && id !== defaultLead));

    // Area & Shift from linked JO, PM location match, or Roster assignment
    const asg = defaultLead ? asgByOp.get(defaultLead) : undefined;
    setShiftTypeId(asg?.shift_type_id ?? '');
    const pmLocText = (p.linkedPmTask?.locations ?? []).join(' ').toLowerCase();
    const pmMatchedArea = pmLocText
      ? stationAreas.find(
          (a) =>
            pmLocText.includes(a.code.toLowerCase()) ||
            (a.name && pmLocText.includes(a.name.toLowerCase())),
        )
      : undefined;

    if (p.linkedJobOrder?.area_code_id) {
      setAreaCodeId(p.linkedJobOrder.area_code_id);
      setAreaTouched(true);
    } else if (pmMatchedArea) {
      setAreaCodeId(pmMatchedArea.id);
      setAreaTouched(true);
    } else if (asg?.area_code_id && stationIdSet.has(asg.area_code_id)) {
      setAreaCodeId(asg.area_code_id);
    } else {
      setAreaCodeId(stationAreas[0]?.id ?? '');
    }

    // Site / BlockLot / Account fields
    setSiteOrWell(
      p.linkedJobOrder?.site_or_well ??
        (p.linkedPmTask
          ? [p.linkedPmTask.locations?.join(', '), p.linkedPmTask.asset].filter(Boolean).join(' · ')
          : ''),
    );
    setBlockLot(p.linkedJobOrder?.block_lot ?? '');

    // Clear signature canvas if present
    setTimeout(() => {
      const cv = sigCanvasRef.current;
      if (cv) {
        const ctx = cv.getContext('2d');
        ctx?.clearRect(0, 0, cv.width, cv.height);
      }
    }, 50);
  }, [p.open]);

  // Sync shift & area when Lead Operator changes
  useEffect(() => {
    if (!p.open || !leadOpId) return;
    const asg = asgByOp.get(leadOpId);
    if (asg?.shift_type_id) setShiftTypeId(asg.shift_type_id);
    if (!areaTouched && asg?.area_code_id && stationIdSet.has(asg.area_code_id)) {
      setAreaCodeId(asg.area_code_id);
    }
    setCrewOpIds((prev) => prev.filter((id) => id !== leadOpId));
  }, [leadOpId, p.open, asgByOp, stationIdSet, areaTouched]);

  // 12-digit utility account auto-parser
  useEffect(() => {
    const parsed = parse12DigitAccount(details.accountNumber);
    if (!parsed) return;
    const clean = details.accountNumber.replace(/[\s-]+/g, '').trim();
    if (clean === lastParsedRef.current) return;
    lastParsedRef.current = clean;

    setBlockLot((prev) => (prev ? prev : parsed.blockLotFormatted));
    setSiteOrWell((prev) => (prev ? prev : `Phase ${parsed.phaseCode}`));
    if (!areaTouched) {
      const matchedArea = stationAreas.find(
        (a) =>
          a.code.toUpperCase() === parsed.projectCode.toUpperCase() ||
          (a.name ?? '').toUpperCase().includes(parsed.projectCode.toUpperCase()),
      );
      if (matchedArea) setAreaCodeId(matchedArea.id);
    }
  }, [details.accountNumber, areaTouched, stationAreas]);

  // Operators on duty today for 1-tap crew tagging
  const { sameShiftOps, otherOps } = useMemo(() => {
    const same: LoggerOperator[] = [];
    const others: LoggerOperator[] = [];
    for (const op of p.operators) {
      if (op.id === leadOpId) continue;
      const asg = asgByOp.get(op.id);
      const s = asg?.shift_type_id ? shiftBy.get(asg.shift_type_id) : undefined;
      const onDuty = Boolean(s && !s.is_off);
      const sameAreaOrShift =
        onDuty &&
        ((areaCodeId && asg?.area_code_id === areaCodeId) ||
          (shiftTypeId && asg?.shift_type_id === shiftTypeId) ||
          !areaCodeId);
      if (sameAreaOrShift) same.push(op);
      else others.push(op);
    }
    return { sameShiftOps: same, otherOps: others };
  }, [p.operators, leadOpId, asgByOp, shiftBy, areaCodeId, shiftTypeId]);

  const meterCalc = useMemo(() => {
    const toNum = (v: string) => (v.trim() === '' ? null : Number(v));
    const refV = Number(details.refVolumeM3) || 0.01;
    return computeMeterTestResult(
      toNum(details.initialReading),
      toNum(details.reading1),
      toNum(details.reading2),
      toNum(details.reading3),
      refV,
    );
  }, [details.initialReading, details.reading1, details.reading2, details.reading3, details.refVolumeM3]);

  if (!p.open) return null;

  function toggleCrew(id: string) {
    setCrewOpIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleCaptureGps() {
    if (!navigator.geolocation) {
      setGpsStatus('Geolocation not supported in this browser.');
      return;
    }
    setGpsStatus('Acquiring GPS fix…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLat(Number(pos.coords.latitude.toFixed(6)));
        setGpsLng(Number(pos.coords.longitude.toFixed(6)));
        setGpsStatus(`±${Math.round(pos.coords.accuracy)}m`);
      },
      (err) => {
        setGpsStatus(`GPS unavailable: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadingPhoto(true);
    setErrMsg('');
    const sb = supabaseBrowser();
    let totalSaved = 0;
    const added: Array<{ url: string; storagePath: string | null; preview: string }> = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        if (navigator.onLine) {
          const res = await uploadActivityPhoto(sb, p.orgId, file);
          added.push({ url: res.url, storagePath: res.storagePath, preview: res.url });
          totalSaved += res.savedBytes;
        } else {
          const compact = await compressImageFile(file, 480, 0.65);
          added.push({ url: compact.dataUrl, storagePath: null, preview: compact.dataUrl });
          totalSaved += compact.savedBytes;
        }
      } catch (err: unknown) {
        setErrMsg(`Photo processing error: ${getErrorMessage(err, 'unknown')}`);
      }
    }

    if (added.length > 0) {
      setPhotos((prev) => [...prev, ...added]);
    }
    if (totalSaved > 0) {
      setSavedBytesTotal((prev) => prev + totalSaved);
    }
    setUploadingPhoto(false);
    e.target.value = '';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrMsg('');
    if (!activityType) {
      setErrMsg('Please select an activity type.');
      return;
    }

    setSubmitting(true);
    const sigData =
      activityType === 'meter_test' && hasSignature && sigCanvasRef.current
        ? sigCanvasRef.current.toDataURL('image/png')
        : null;

    const expiresIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    type ActivitySubmitPayload = Omit<
      DailyActivityRow,
      'id' | 'verified_by' | 'verified_at' | 'review_note' | 'photos_purged_at' | 'created_at' | 'updated_at'
    >;
    const payload: ActivitySubmitPayload = {
      organization_id: p.orgId,
      activity_date: p.date,
      logged_by: p.userId,
      lead_operator_id: leadOpId || null,
      crew_operator_ids: crewOpIds.filter((id) => id && id !== leadOpId),
      shift_type_id: shiftTypeId || null,
      area_code_id: areaCodeId || null,
      site_or_well: siteOrWell.trim() || null,
      block_lot: blockLot.trim() || null,
      activity_type: activityType,
      pm_task_id: p.linkedPmTask?.id ?? null,
      status: 'submitted',
      started_at: toManilaTimestampIso(p.date, startedHHMM),
      completed_at: toManilaTimestampIso(p.date, completedHHMM) ?? new Date().toISOString(),
      gps_lat: gpsLat,
      gps_lng: gpsLng,
      notes: notes.trim() || null,
      details: buildActivityDetailsPayload(activityType, details, meterCalc),
      photo_urls: photos.map((ph) => ph.url),
      photo_storage_paths: photos.map((ph) => ph.storagePath).filter((sp): sp is string => Boolean(sp)),
      photos_expires_at: photos.length > 0 ? expiresIso : null,
      signature_data: sigData,
      ...(p.linkedJobOrder?.id ? { job_order_id: p.linkedJobOrder.id } : {}),
    };

    const buildOfflineActivityRow = (): DailyActivityRow => ({
      id: `offline-${Date.now()}`,
      ...payload,
      verified_by: null,
      verified_at: null,
      review_note: null,
      photos_purged_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (!navigator.onLine && p.onQueuedOffline) {
      await p.onQueuedOffline(payload);
      setSubmitting(false);
      p.onSaved(buildOfflineActivityRow(), { offline: true });
      p.onClose();
      return;
    }

    try {
      const sb = supabaseBrowser();
      if (p.editingActivity?.id) {
        const updatePayload: Partial<ActivitySubmitPayload> = {
          lead_operator_id: payload.lead_operator_id,
          crew_operator_ids: payload.crew_operator_ids,
          shift_type_id: payload.shift_type_id,
          area_code_id: payload.area_code_id,
          site_or_well: payload.site_or_well,
          block_lot: payload.block_lot,
          activity_type: payload.activity_type,
          started_at: payload.started_at,
          completed_at: payload.completed_at,
          gps_lat: payload.gps_lat,
          gps_lng: payload.gps_lng,
          notes: payload.notes,
          details: payload.details,
          photo_urls: payload.photo_urls,
          photo_storage_paths: payload.photo_storage_paths,
          photos_expires_at: payload.photos_expires_at,
          signature_data: sigData ?? p.editingActivity.signature_data ?? null,
          status: p.editingActivity.status === 'flagged' ? 'submitted' : p.editingActivity.status,
        };
        const { data, error } = await sb
          .from('daily_activities')
          .update(updatePayload)
          .eq('id', p.editingActivity.id)
          .select('*')
          .single();
        if (error) throw error;
        setSubmitting(false);
        p.onSaved(data as DailyActivityRow);
        p.onClose();
        return;
      }

      const { data, error } = await sb.from('daily_activities').insert(payload).select('*').single();
      if (error) throw error;

      if (p.linkedPmTask?.id) {
        await sb
          .from('pm_tasks')
          .update({
            status: 'done',
            completed_at: p.date,
            remarks: notes.trim() || `Logged via field activity (${activityType})`,
          })
          .eq('id', p.linkedPmTask.id);
      }

      if (p.linkedJobOrder?.id) {
        await sb
          .from('job_orders')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('id', p.linkedJobOrder.id);
      }

      setSubmitting(false);
      p.onSaved(data as DailyActivityRow);
      p.onClose();
    } catch (err: unknown) {
      // Fall back to offline queue if network failure and callback available
      const message = getErrorMessage(err, 'Save failed');
      const looksOffline = !navigator.onLine || /fetch|network|failed to load/i.test(message);
      if (looksOffline && p.onQueuedOffline) {
        await p.onQueuedOffline(payload);
        setSubmitting(false);
        p.onSaved(buildOfflineActivityRow(), { offline: true });
        p.onClose();
        return;
      }
      setSubmitting(false);
      setErrMsg(message);
    }
  }

  return (
    <div
      className="modal-overlay no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby="activity-logger-title"
      onClick={() => !submitting && p.onClose()}
    >
      <form
        className="modal-sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{ maxWidth: 640, display: 'grid', gap: 12 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
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
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Date: <b>{p.date}</b> (Manila) · Auto-linked to Roster Shift &amp; Area
            </div>
          </div>
          <button type="button" className="btn" onClick={p.onClose} disabled={submitting} aria-label="Close">
            ✕
          </button>
        </div>

        {/* Core Fields */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600 }}>
            Activity Type *
            <select
              className="input"
              value={activityType}
              onChange={(e) => setActivityType(e.target.value)}
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
              <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--accent)' }}>
                Auto-matched from PM: &ldquo;{p.linkedPmTask.title}&rdquo;
              </span>
            )}
          </label>

          <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600 }}>
            Station / Area (from Setup)
            <select
              className="input"
              value={areaCodeId}
              onChange={(e) => {
                setAreaTouched(true);
                setAreaCodeId(e.target.value);
              }}
            >
              <option value="">— Select Area / Station —</option>
              {stationAreas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code}
                  {a.name ? ` · ${a.name}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600 }}>
            Well / Pump / Site (optional)
            <input
              className="input"
              list="station-sub-sites-list"
              placeholder="e.g. Well 2, Booster 1, Mainline"
              value={siteOrWell}
              onChange={(e) => setSiteOrWell(e.target.value)}
            />
            {(() => {
              const selArea = stationAreas.find((a) => a.id === areaCodeId);
              const subs = selArea?.sub_sites ?? [];
              if (subs.length === 0) return null;
              return (
                <>
                  <datalist id="station-sub-sites-list">
                    {subs.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                    {subs.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSiteOrWell(s)}
                        style={{
                          padding: '2px 7px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                          border: siteOrWell === s ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                          background: siteOrWell === s ? 'var(--primary)' : 'var(--surface-muted)',
                          color: siteOrWell === s ? 'var(--primary-fg)' : 'var(--text-secondary)',
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </>
              );
            })()}
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600 }}>
            Block &amp; Lot / Location Detail
            <input
              className="input"
              placeholder="e.g. Block 004 Lot 012"
              value={blockLot}
              onChange={(e) => setBlockLot(e.target.value)}
            />
          </label>
        </div>

        {/* Lead & Crew Tagging */}
        <div
          className="card"
          style={{
            padding: 10,
            background: 'var(--surface-muted)',
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600 }}>
              Lead Operator
              <select
                className="input"
                value={leadOpId}
                onChange={(e) => setLeadOpId(e.target.value)}
              >
                <option value="">— Unspecified —</option>
                {p.operators.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.full_name}
                    {o.id === p.operatorId ? ' (Me)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600 }}>
              Shift (Roster-Linked)
              <select
                className="input"
                value={shiftTypeId}
                onChange={(e) => setShiftTypeId(e.target.value)}
              >
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                Tag Co-Operators / Crew ({crewOpIds.length} tagged — all receive credit)
              </span>
              {otherOps.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllOps((v) => !v)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--accent)',
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {showAllOps ? 'Hide off-shift ops' : `+ Show all (${otherOps.length} more)`}
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {sameShiftOps.map((op) => {
                const selected = crewOpIds.includes(op.id);
                return (
                  <button
                    key={op.id}
                    type="button"
                    onClick={() => toggleCrew(op.id)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 999,
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: selected ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                      background: selected ? 'var(--primary)' : 'var(--surface)',
                      color: selected ? 'var(--primary-fg)' : 'var(--text)',
                    }}
                  >
                    {selected ? '✓ ' : '+ '}
                    {op.full_name}
                  </button>
                );
              })}
              {showAllOps &&
                otherOps.map((op) => {
                  const selected = crewOpIds.includes(op.id);
                  return (
                    <button
                      key={op.id}
                      type="button"
                      onClick={() => toggleCrew(op.id)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 999,
                        fontSize: 11.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                        border: selected ? '1.5px solid var(--primary)' : '1px dashed var(--border)',
                        background: selected ? 'var(--primary)' : 'var(--surface)',
                        color: selected ? 'var(--primary-fg)' : 'var(--text-secondary)',
                      }}
                    >
                      {selected ? '✓ ' : '+ '}
                      {op.full_name}
                    </button>
                  );
                })}
              {sameShiftOps.length === 0 && !showAllOps && otherOps.length === 0 && (
                <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>No other active operators available.</span>
              )}
            </div>
          </div>
        </div>

        {/* Dynamic Specialized Fields based on activityType */}
        <ActivityCategoryFields
          activityType={activityType}
          fields={details}
          setFields={setDetails}
          meterCalc={meterCalc}
          sigCanvasRef={sigCanvasRef}
          sigDrawingRef={sigDrawingRef}
          setHasSignature={setHasSignature}
        />

        {/* Times + Notes */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
            Start Time (optional)
            <input className="input" type="time" value={startedHHMM} onChange={(e) => setStartedHHMM(e.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
            Completion Time
            <input className="input" type="time" value={completedHHMM} onChange={(e) => setCompletedHHMM(e.target.value)} />
          </label>
        </div>

        <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600 }}>
          Field Notes / Observations
          <textarea
            className="input"
            rows={2}
            placeholder="Work performed, pressure/reading summary, follow-ups needed…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ minHeight: 58 }}
          />
        </label>

        {/* GPS & 30-day Expiring Photo Capture */}
        <ActivityMediaCapture
          gpsLat={gpsLat}
          gpsLng={gpsLng}
          gpsStatus={gpsStatus}
          onCaptureGps={handleCaptureGps}
          uploadingPhoto={uploadingPhoto}
          onPhotoUpload={handlePhotoUpload}
          savedBytesTotal={savedBytesTotal}
          photos={photos}
          onRemovePhoto={(idx) => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
        />

        {errMsg && (
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: 'var(--danger)', fontWeight: 600 }}>
            {errMsg}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button type="button" className="btn" onClick={p.onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting || uploadingPhoto}>
            {submitting ? 'Saving Activity…' : p.editingActivity ? 'Save Changes' : p.linkedPmTask ? 'Log Activity & Complete PM' : p.linkedJobOrder ? 'Log Activity & Close JO' : 'Submit Activity Log'}
          </button>
        </div>
      </form>
    </div>
  );
}
