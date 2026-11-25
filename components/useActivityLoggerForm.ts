'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import {
  ACTIVITY_TYPES,
  computeMeterTestResult,
  parse12DigitAccount,
  resolveActivityTypeFromPm,
  type DailyActivityRow,
  type LinkedJobOrder,
  type LinkedPmTask,
} from '@/lib/activity-types';
import { getErrorMessage, isNetworkErrorMessage } from '@/lib/error-utils';
import { resolveActivityPhotoUrl } from '@/lib/activity-media';
import { extractGpsMetadata, type GpsSource } from '@/lib/gps-accuracy';
import { buildPmActualPerformerIds, getDefaultPmPerformers, isMissingCompletedByColumnError } from '@/lib/pm-credit';
import { DAILY_ACTIVITY_LIST_COLUMNS } from '@/lib/query-columns';
import {
  buildActivityDetailsPayload,
  currentManilaHHMM,
  hydrateActivityDetailFields,
  INITIAL_ACTIVITY_DETAIL_FIELDS,
  toManilaTimestampIso,
  type ActivityDetailFieldsState,
} from '@/lib/activity-logger-details';
import {
  normalizePulloutDateYMD,
  normalizePulloutTimeHHMM,
} from '@/lib/well-pullout-types';
import { compressImageFile, uploadActivityPhoto, uploadDataUrlPhoto } from '@/lib/image-compress';
import { newClientId } from '@/lib/offline-sync-core';
import type { ActivityPhotoEntry } from '@/components/ActivityMediaCapture';

export const MAX_ACTIVITY_PHOTOS = 4;

export type LoggerOperator = { id: string; full_name: string; position: string | null; default_station?: string | null };
export type LoggerArea = { id: string; code: string; name: string | null; category: string; sub_sites?: string[] };
export type LoggerShift = { id: string; code: string; description?: string | null; start_time?: string | null; end_time?: string | null; is_off?: boolean };
export type LoggerAssignment = { operator_id: string; shift_type_id: string | null; area_code_id: string | null };

export type ActivitySubmitPayload = Omit<
  DailyActivityRow,
  'id' | 'verified_by' | 'verified_at' | 'review_note' | 'photos_purged_at' | 'created_at' | 'updated_at'
> & {
  tat_justification?: string | null;
};

export type ActivityLoggerModalProps = {
  open: boolean;
  onClose: () => void;
  onSaved: (
    activity: DailyActivityRow,
    opts?: {
      offline?: boolean;
      tatJustification?: string | null;
      completedByIds?: string[];
      pmUpdateFailed?: boolean;
      linkedWarning?: string;
    },
  ) => void;
  orgId: string;
  userId: string;
  role?: string;
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
  canLogSample?: boolean;
  sampleOnly?: boolean;
  onQueuedOffline?: (
    payload: ActivitySubmitPayload,
    opts?: { editingId?: string | null; expectedUpdatedAt?: string | null },
  ) => Promise<void> | void;
};

function toManilaHHMM(iso: string | null) {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const hh = parts.find((x) => x.type === 'hour')?.value ?? '';
  const mm = parts.find((x) => x.type === 'minute')?.value ?? '';
  return hh && mm ? `${hh === '24' ? '00' : hh}:${mm}` : '';
}

/** Manages state, edit hydration, GPS/photo capture, validation, and online/offline submission for ActivityLoggerModal. */
export function useActivityLoggerForm(p: ActivityLoggerModalProps) {
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

  const [gpsLat, setGpsLat] = useState<number | null>(null);
  const [gpsLng, setGpsLng] = useState<number | null>(null);
  const [gpsAccuracyM, setGpsAccuracyM] = useState<number | null>(null);
  const [gpsSource, setGpsSource] = useState<GpsSource | null>(null);

  const [photos, setPhotos] = useState<ActivityPhotoEntry[]>([]);
  const [savedBytesTotal, setSavedBytesTotal] = useState(0);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [details, setDetails] = useState<ActivityDetailFieldsState>(INITIAL_ACTIVITY_DETAIL_FIELDS);

  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sigDrawingRef = useRef(false);
  const [hasSignature, setHasSignature] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [joTatJustification, setJoTatJustification] = useState('');
  const [isSample, setIsSample] = useState(Boolean(p.sampleOnly));
  const [openAtMs, setOpenAtMs] = useState(0);
  const [openSeq, setOpenSeq] = useState(0);
  const [initialSnapshot, setInitialSnapshot] = useState('');
  const initPhaseRef = useRef<'closed' | 'init' | 'capture' | 'settled'>('closed');
  const lastParsedRef = useRef('');
  /** Primary key for the log being created. Fixed for the whole modal session so that every attempt
   *  (online, retried, or queued offline) refers to the same row and cannot create a duplicate. */
  const newLogIdRef = useRef('');
  const initCtxRef = useRef({ p, asgByOp, stationAreas, stationIdSet });
  initCtxRef.current = { p, asgByOp, stationAreas, stationIdSet };

  const leadOpName = useMemo(
    () => p.operators.find((o) => o.id === leadOpId)?.full_name ?? '',
    [p.operators, leadOpId],
  );

  const performedBySummary = useMemo(() => {
    const opNameById = new Map(p.operators.map((o) => [o.id, o.full_name]));
    const names: string[] = [];
    if (leadOpId && opNameById.get(leadOpId)) names.push(opNameById.get(leadOpId)!);
    for (const id of crewOpIds) {
      const n = id !== leadOpId ? opNameById.get(id) : undefined;
      if (n) names.push(n);
    }
    return names.join(', ');
  }, [p.operators, leadOpId, crewOpIds]);

  // Initialize defaults whenever modal opens
  useEffect(() => {
    if (!p.open) return;
    initPhaseRef.current = 'init';
    newLogIdRef.current = newClientId();
    setOpenSeq((n) => n + 1);
    const { p: props, asgByOp: asgMap, stationAreas: stAreas, stationIdSet: stIdSet } = initCtxRef.current;
    setErrMsg('');
    setJoTatJustification('');
    setIsSample(props.editingActivity ? Boolean(props.editingActivity.is_sample) : Boolean(props.sampleOnly));
    setOpenAtMs(Date.now());
    setGpsLat(null);
    setGpsLng(null);
    setGpsAccuracyM(null);
    setGpsSource(null);
    setPhotos([]);
    setSavedBytesTotal(0);
    setHasSignature(false);
    setAreaTouched(false);
    setStartedHHMM('');
    setCompletedHHMM(currentManilaHHMM());
    setNotes('');
    lastParsedRef.current = '';

    setDetails({
      ...INITIAL_ACTIVITY_DETAIL_FIELDS,
      ...(props.linkedPmTask && resolveActivityTypeFromPm(props.linkedPmTask, props.pmActivityTypes) === 'genset_monitoring' ? { gensetCause: 'PMS' as const } : {}),
      accountNumber: props.linkedJobOrder?.account_number ?? '',
      accountName: props.linkedJobOrder?.account_name ?? '',
    });

    if (props.editingActivity) {
      const ea = props.editingActivity;
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
      const gpsMeta = extractGpsMetadata(d);
      setGpsAccuracyM(gpsMeta.gpsAccuracyM);
      setGpsSource(gpsMeta.gpsSource ?? (ea.gps_lat != null && ea.gps_lng != null ? 'gps' : null));
      setPhotos(
        (ea.photo_urls ?? []).map((u, idx) => {
          const sp = ea.photo_storage_paths?.[idx] ?? null;
          const resolved = resolveActivityPhotoUrl(u, sp);
          return { url: resolved, storagePath: sp, preview: resolved };
        }),
      );
      setStartedHHMM(toManilaHHMM(ea.started_at));
      setCompletedHHMM(toManilaHHMM(ea.completed_at) || currentManilaHHMM());
      const hydrated = hydrateActivityDetailFields(d);
      if (!ea.site_or_well) {
        const legacySite =
          ea.activity_type === 'tank_cleaning'
            ? hydrated.tankCleaning.tankId
            : ea.activity_type === 'backwash'
              ? hydrated.filterUnit
              : ea.activity_type === 'thermal_scanning'
                ? hydrated.scannedEquipment
                : ea.activity_type === 'water_sampling'
                  ? hydrated.samplePoint
                  : '';
        if (legacySite) setSiteOrWell(legacySite);
      }
      if (ea.activity_type === 'well_pull_out') {
        hydrated.wellPullout = {
          ...hydrated.wellPullout,
          dateStarted: hydrated.wellPullout.dateStarted || ea.activity_date,
          timeStarted: hydrated.wellPullout.timeStarted || toManilaHHMM(ea.started_at),
          timeFinished: hydrated.wellPullout.timeFinished || toManilaHHMM(ea.completed_at),
          overallRemarks: hydrated.wellPullout.overallRemarks || (ea.notes ?? ''),
        };
      } else if (ea.activity_type === 'tank_cleaning') {
        hydrated.tankCleaning = {
          ...hydrated.tankCleaning,
          dateStarted: hydrated.tankCleaning.dateStarted || ea.activity_date,
          timeStarted: hydrated.tankCleaning.timeStarted || toManilaHHMM(ea.started_at),
          timeFinished: hydrated.tankCleaning.timeFinished || toManilaHHMM(ea.completed_at),
          conclusionRecommendations: hydrated.tankCleaning.conclusionRecommendations || (ea.notes ?? ''),
        };
      }
      setDetails(hydrated);
      return;
    }

    const pmMapped = props.linkedPmTask ? resolveActivityTypeFromPm(props.linkedPmTask, props.pmActivityTypes) : undefined;
    const initAct = props.linkedJobOrder?.activity_type || pmMapped || props.initialActivityType || 'pump_monitoring';
    setActivityType(ACTIVITY_TYPES.some((a) => a.id === initAct) ? initAct : 'pump_monitoring');

    const pmDefaults = props.linkedPmTask ? getDefaultPmPerformers(props.linkedPmTask, props.operatorId) : [];
    const defaultLead = props.initialLeadOperatorId ?? props.linkedJobOrder?.assigned_operator_ids?.[0] ?? pmDefaults[0] ?? props.operatorId ?? '';
    setLeadOpId(defaultLead);
    const linkedCrew = props.linkedJobOrder?.assigned_operator_ids ?? pmDefaults;
    setCrewOpIds(linkedCrew.filter((id) => id && id !== defaultLead));

    const asg = defaultLead ? asgMap.get(defaultLead) : undefined;
    setShiftTypeId(asg?.shift_type_id ?? '');
    const pmLocText = (props.linkedPmTask?.locations ?? []).join(' ').toLowerCase();
    const pmMatchedArea = pmLocText
      ? stAreas.find((a) => pmLocText.includes(a.code.toLowerCase()) || (a.name && pmLocText.includes(a.name.toLowerCase())))
      : undefined;

    if (props.linkedJobOrder?.area_code_id) {
      setAreaCodeId(props.linkedJobOrder.area_code_id);
      setAreaTouched(true);
    } else if (pmMatchedArea) {
      setAreaCodeId(pmMatchedArea.id);
      setAreaTouched(true);
    } else if (asg?.area_code_id && stIdSet.has(asg.area_code_id)) {
      setAreaCodeId(asg.area_code_id);
    } else {
      setAreaCodeId(stAreas[0]?.id ?? '');
    }

    setSiteOrWell(
      props.linkedJobOrder?.site_or_well ??
        (props.linkedPmTask
          ? [props.linkedPmTask.locations?.join(', '), props.linkedPmTask.asset].filter(Boolean).join(' · ')
          : ''),
    );
    setBlockLot(props.linkedJobOrder?.block_lot ?? '');

    setTimeout(() => {
      const cv = sigCanvasRef.current;
      if (cv) {
        const ctx = cv.getContext('2d');
        ctx?.clearRect(0, 0, cv.width, cv.height);
      }
    }, 50);
  }, [p.open, p.editingActivity?.id, p.linkedPmTask?.id, p.linkedJobOrder?.id, p.initialActivityType, p.initialLeadOperatorId]);

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

  const currentSnapshot = useMemo(
    () =>
      JSON.stringify({
        activityType, leadOpId, crewOpIds, shiftTypeId, areaCodeId, siteOrWell, blockLot,
        startedHHMM, completedHHMM, notes, gpsLat, gpsLng,
        photoKeys: photos.map((ph) => ph.storagePath ?? ph.url),
        details, hasSignature, joTatJustification, isSample,
      }),
    [activityType, leadOpId, crewOpIds, shiftTypeId, areaCodeId, siteOrWell, blockLot, startedHHMM, completedHHMM, notes, gpsLat, gpsLng, photos, details, hasSignature, joTatJustification, isSample],
  );

  useEffect(() => {
    if (!p.open) {
      initPhaseRef.current = 'closed';
      setInitialSnapshot('');
      return;
    }
    if (initPhaseRef.current === 'init') {
      initPhaseRef.current = 'capture';
      return;
    }
    if (initPhaseRef.current === 'capture') {
      initPhaseRef.current = 'settled';
      setInitialSnapshot(currentSnapshot);
    }
  }, [p.open, currentSnapshot, openSeq]);

  const isDirty = Boolean(initialSnapshot) && initPhaseRef.current === 'settled' && currentSnapshot !== initialSnapshot;

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

  function toggleCrew(id: string) {
    setCrewOpIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleGpsChange(fix: { lat: number | null; lng: number | null; accuracyM: number | null; source: GpsSource | null }) {
    setGpsLat(fix.lat);
    setGpsLng(fix.lng);
    setGpsAccuracyM(fix.accuracyM);
    setGpsSource(fix.source);
  }

  function handleRemovePhoto(idx: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const remaining = MAX_ACTIVITY_PHOTOS - photos.length;
    if (remaining <= 0) {
      setErrMsg(`Maximum ${MAX_ACTIVITY_PHOTOS} photos allowed per activity.`);
      e.target.value = '';
      return;
    }
    setUploadingPhoto(true);
    setErrMsg(
      files.length > remaining
        ? `Only ${remaining} more photo${remaining === 1 ? '' : 's'} can be added (max ${MAX_ACTIVITY_PHOTOS} per activity).`
        : '',
    );
    const sb = supabaseBrowser();
    let totalSaved = 0;
    const added: ActivityPhotoEntry[] = [];

    const count = Math.min(files.length, remaining);
    for (let i = 0; i < count; i++) {
      const file = files[i];
      try {
        if (navigator.onLine) {
          const res = await uploadActivityPhoto(sb, p.orgId, file, { sample: Boolean(p.sampleOnly || isSample) });
          added.push({ url: res.url, storagePath: res.storagePath, preview: res.url });
          if (res.uploadError) {
            setErrMsg(`Photo not uploaded yet (${res.uploadError}). It will be uploaded when you submit.`);
          }
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

    if (added.length > 0) setPhotos((prev) => [...prev, ...added]);
    if (totalSaved > 0) setSavedBytesTotal((prev) => prev + totalSaved);
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

    const isPullout = activityType === 'well_pull_out';
    const isTankClean = activityType === 'tank_cleaning';
    const wpStartYmd = normalizePulloutDateYMD(details.wellPullout.dateStarted, p.date);
    const wpEndYmd = normalizePulloutDateYMD(details.wellPullout.dateFinished, wpStartYmd);
    const tcStartYmd = normalizePulloutDateYMD(details.tankCleaning.dateStarted, p.date);
    const tcEndYmd = normalizePulloutDateYMD(details.tankCleaning.dateFinished, tcStartYmd);
    const resolvedStartedAt = isPullout
      ? toManilaTimestampIso(wpStartYmd, normalizePulloutTimeHHMM(details.wellPullout.timeStarted))
      : isTankClean
        ? toManilaTimestampIso(tcStartYmd, normalizePulloutTimeHHMM(details.tankCleaning.timeStarted))
        : toManilaTimestampIso(p.date, startedHHMM);
    const resolvedCompletedAt = isPullout
      ? toManilaTimestampIso(wpEndYmd, normalizePulloutTimeHHMM(details.wellPullout.timeFinished)) ?? new Date().toISOString()
      : isTankClean
        ? toManilaTimestampIso(tcEndYmd, normalizePulloutTimeHHMM(details.tankCleaning.timeFinished)) ?? new Date().toISOString()
        : toManilaTimestampIso(p.date, completedHHMM) ?? new Date().toISOString();
    const resolvedNotes = isPullout
      ? details.wellPullout.overallRemarks.trim() || notes.trim() || null
      : isTankClean
        ? details.tankCleaning.conclusionRecommendations.trim() || notes.trim() || null
        : notes.trim() || null;

    const siteText = siteOrWell.trim();
    const locText = [siteText, blockLot.trim()].filter(Boolean).join(' · ');
    const detailsForSubmit: ActivityDetailFieldsState = isPullout
      ? { ...details, wellPullout: { ...details.wellPullout, dateStarted: wpStartYmd, dateFinished: wpEndYmd, performedByContractor: performedBySummary || details.wellPullout.performedByContractor } }
      : isTankClean
        ? { ...details, tankCleaning: { ...details.tankCleaning, tankId: siteText || details.tankCleaning.tankId, dateStarted: tcStartYmd, dateFinished: tcEndYmd } }
        : {
            ...details,
            samplePoint: activityType === 'water_sampling' ? locText || details.samplePoint : details.samplePoint,
            filterUnit: activityType === 'backwash' ? siteText || details.filterUnit : details.filterUnit,
            scannedEquipment: activityType === 'thermal_scanning' ? siteText || details.scannedEquipment : details.scannedEquipment,
            driverName: activityType === 'tankering' ? leadOpName || details.driverName : details.driverName,
          };

    const expiresIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const preservedExpiry =
      p.editingActivity?.photos_expires_at ??
      (p.editingActivity?.created_at
        ? new Date(new Date(p.editingActivity.created_at).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
        : expiresIso);
    const baseDetails = buildActivityDetailsPayload(activityType, detailsForSubmit, meterCalc);
    const gpsMetaPayload =
      gpsLat !== null && gpsLng !== null
        ? {
            ...(gpsSource ? { gpsSource } : {}),
            ...(gpsAccuracyM !== null ? { gpsAccuracyM } : {}),
          }
        : {};
    const effectiveIsSample = p.editingActivity ? Boolean(p.editingActivity.is_sample) : Boolean(p.sampleOnly || isSample);
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
      started_at: resolvedStartedAt,
      completed_at: resolvedCompletedAt,
      gps_lat: gpsLat,
      gps_lng: gpsLng,
      notes: resolvedNotes,
      details: { ...baseDetails, ...gpsMetaPayload },
      photo_urls: photos.map((ph) => ph.url),
      photo_storage_paths: photos.map((ph) => ph.storagePath).filter((sp): sp is string => Boolean(sp)),
      photos_expires_at: photos.length > 0 ? preservedExpiry : null,
      signature_data: sigData,
      is_sample: effectiveIsSample,
      ...(p.linkedJobOrder?.id ? { job_order_id: p.linkedJobOrder.id } : {}),
    };

    const trimmedTat = joTatJustification.trim() || null;
    const newLogId = p.editingActivity ? null : newLogIdRef.current || (newLogIdRef.current = newClientId());
    const offlinePayload: ActivitySubmitPayload & { id?: string } = {
      ...payload,
      ...(newLogId ? { id: newLogId } : {}),
      ...(p.editingActivity
        ? { status: p.editingActivity.status === 'flagged' ? 'submitted' : p.editingActivity.status }
        : {}),
      ...(p.linkedJobOrder?.id && trimmedTat ? { tat_justification: trimmedTat } : {}),
    };
    const queueOpts = {
      editingId: p.editingActivity?.id ?? null,
      expectedUpdatedAt: p.editingActivity?.updated_at ?? null,
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

    const queueOffline = async () => {
      if (!p.onQueuedOffline) return false;
      await p.onQueuedOffline(offlinePayload, queueOpts);
      setSubmitting(false);
      p.onSaved(buildOfflineActivityRow(), { offline: true });
      p.onClose();
      return true;
    };

    if (!navigator.onLine && (await queueOffline())) return;

    try {
      const sb = supabaseBrowser();

      // Photos still held as data URLs failed to upload earlier. Upload them now; base64 image data must
      // never be written into the database row.
      if (payload.photo_urls.some((u) => u.startsWith('data:'))) {
        const ready: ActivityPhotoEntry[] = [];
        let uploadFailure = '';
        for (const ph of photos) {
          if (!ph.url.startsWith('data:') || uploadFailure) {
            ready.push(ph);
            continue;
          }
          try {
            const up = await uploadDataUrlPhoto(sb, p.orgId, ph.url, { requireStorage: true, sample: effectiveIsSample });
            ready.push({ url: up.url, storagePath: up.storagePath, preview: up.url });
          } catch (err: unknown) {
            uploadFailure = getErrorMessage(err, 'Photo upload failed');
            ready.push(ph);
          }
        }
        // Remember successful uploads so another attempt does not upload them twice.
        setPhotos(ready);
        const photoUrls = ready.map((ph) => ph.url);
        const photoPaths = ready.map((ph) => ph.storagePath).filter((path): path is string => Boolean(path));
        payload.photo_urls = photoUrls;
        payload.photo_storage_paths = photoPaths;
        offlinePayload.photo_urls = photoUrls;
        offlinePayload.photo_storage_paths = photoPaths;
        if (uploadFailure) {
          // The offline queue keeps the photos on this device and retries; its banner shows any error.
          if (await queueOffline()) return;
          setSubmitting(false);
          setErrMsg(`Photo upload failed: ${uploadFailure}. Try again, or remove the photo.`);
          return;
        }
      }

      const { tat_justification: _omitTat, ...dbInsertPayload } = payload;
      if (p.editingActivity?.id) {
        const updatePayload: Omit<Partial<ActivitySubmitPayload>, 'tat_justification'> = {
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
          ...(sigData !== null ? { signature_data: sigData } : {}),
          status: p.editingActivity.status === 'flagged' ? 'submitted' : p.editingActivity.status,
        };
        const { data, error } = await sb
          .from('daily_activities')
          .update(updatePayload)
          .eq('id', p.editingActivity.id)
          .select(DAILY_ACTIVITY_LIST_COLUMNS)
          .single();
        if (error) throw error;
        setSubmitting(false);
        const savedRow: DailyActivityRow = {
          ...(data as unknown as DailyActivityRow),
          ...(sigData !== null ? { signature_data: sigData } : {}),
        };
        p.onSaved(savedRow);
        p.onClose();
        return;
      }

      let { data, error } = await sb
        .from('daily_activities')
        .insert({ ...dbInsertPayload, id: newLogId as string })
        .select(DAILY_ACTIVITY_LIST_COLUMNS)
        .single();
      if (error?.code === '23505') {
        // An earlier attempt reached the server but its response was lost. Apply the current form values
        // to that row instead of creating a second one.
        const {
          organization_id: _org,
          logged_by: _loggedBy,
          is_sample: _isSample,
          pm_task_id: _pmTaskId,
          job_order_id: _jobOrderId,
          signature_data: signature,
          ...latest
        } = dbInsertPayload;
        ({ data, error } = await sb
          .from('daily_activities')
          .update({ ...latest, ...(signature !== null ? { signature_data: signature } : {}) })
          .eq('id', newLogId as string)
          .select(DAILY_ACTIVITY_LIST_COLUMNS)
          .single());
      }
      if (error) throw error;

      const pmPerformers =
        !effectiveIsSample && p.linkedPmTask?.id
          ? buildPmActualPerformerIds(leadOpId, p.role === 'operator' && p.operatorId ? [...crewOpIds, p.operatorId] : crewOpIds)
          : undefined;
      let pmErrMsg: string | null = null;
      if (!effectiveIsSample && p.linkedPmTask?.id) {
        const pmBase = {
          status: 'done' as const,
          completed_at: p.date,
          remarks: notes.trim() || `Logged via field activity (${activityType})`,
        };
        let pmRes = await sb.from('pm_tasks').update({ ...pmBase, completed_by_operator_ids: pmPerformers }).eq('id', p.linkedPmTask.id);
        if (isMissingCompletedByColumnError(pmRes.error)) {
          pmRes = await sb.from('pm_tasks').update(pmBase).eq('id', p.linkedPmTask.id);
        }
        if (pmRes.error) pmErrMsg = pmRes.error.message;
      }

      let joErrMsg: string | null = null;
      if (!effectiveIsSample && p.linkedJobOrder?.id) {
        const joRes = await sb
          .from('job_orders')
          .update({ status: 'completed', completed_at: new Date().toISOString(), ...(trimmedTat ? { tat_justification: trimmedTat } : {}) })
          .eq('id', p.linkedJobOrder.id);
        if (joRes.error) joErrMsg = joRes.error.message;
      }

      const warnParts: string[] = [];
      if (pmErrMsg) warnParts.push(`PM task could not be marked done (${pmErrMsg})`);
      if (joErrMsg) warnParts.push(`Job Order could not be closed (${joErrMsg})`);
      const linkedWarning = warnParts.length > 0 ? `Activity saved, but ${warnParts.join('; ')}.` : undefined;

      setSubmitting(false);
      const savedRow: DailyActivityRow = {
        ...(data as unknown as DailyActivityRow),
        ...(sigData !== null ? { signature_data: sigData } : {}),
      };
      p.onSaved(savedRow, {
        tatJustification: trimmedTat,
        completedByIds: pmPerformers,
        pmUpdateFailed: Boolean(pmErrMsg),
        linkedWarning,
      });
      p.onClose();
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Save failed');
      const looksOffline = !navigator.onLine || isNetworkErrorMessage(message);
      if (looksOffline && (await queueOffline())) return;
      setSubmitting(false);
      setErrMsg(message);
    }
  }

  return {
    stationAreas, activityType, setActivityType, leadOpId, setLeadOpId, crewOpIds, showAllOps, setShowAllOps,
    shiftTypeId, setShiftTypeId, areaCodeId, setAreaCodeId, setAreaTouched, siteOrWell, setSiteOrWell,
    blockLot, setBlockLot, startedHHMM, setStartedHHMM, completedHHMM, setCompletedHHMM, notes, setNotes,
    gpsLat, gpsLng, gpsAccuracyM, gpsSource, handleGpsChange, photos, savedBytesTotal, uploadingPhoto,
    handlePhotoUpload, handleRemovePhoto, details, setDetails, sigCanvasRef, sigDrawingRef, setHasSignature,
    submitting, errMsg, joTatJustification, setJoTatJustification, isSample, setIsSample, openAtMs, isDirty,
    leadOpName, performedBySummary, sameShiftOps, otherOps, meterCalc, toggleCrew, handleSubmit,
  };
}
