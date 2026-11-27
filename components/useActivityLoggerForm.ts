'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { extractGpsMetadata, validateRequiredGps, type GpsSource } from '@/lib/gps-accuracy';
import { getDefaultPmPerformers } from '@/lib/pm-credit';
import {
  buildActivitySubmitPayload,
  persistActivitySubmission,
  uploadPendingActivityPhotos,
  type ActivitySubmitPayload,
} from '@/lib/activity-logger-submit';
import {
  currentManilaHHMM,
  hydrateActivityDetailFields,
  INITIAL_ACTIVITY_DETAIL_FIELDS,
  type ActivityDetailFieldsState,
} from '@/lib/activity-logger-details';
import { compressImageFile, uploadActivityPhoto } from '@/lib/image-compress';
import { CHLORINE_REFILL_ACTIVITY_TYPE, validateChlorineRefill } from '@/lib/chlorine-refill';
import { extractOfflineBlobId, newClientId, OFFLINE_BLOB_PREFIX } from '@/lib/offline-sync-core';
import {
  buildActivityDraftKey,
  deleteActivityDraft,
  deleteOfflinePhotoBlobs,
  getOfflinePhotoBlob,
  loadActivityDraft,
  saveActivityDraft,
  saveOfflinePhotoBlob,
} from '@/lib/offline-queue';
import type { ActivityPhotoEntry } from '@/components/ActivityMediaCapture';

export const MAX_ACTIVITY_PHOTOS = 4;

export type LoggerOperator = { id: string; full_name: string; position: string | null; default_station?: string | null };
export type LoggerArea = { id: string; code: string; name: string | null; category: string; sub_sites?: string[] };
export type LoggerShift = { id: string; code: string; description?: string | null; start_time?: string | null; end_time?: string | null; is_off?: boolean };
export type LoggerAssignment = { operator_id: string; shift_type_id: string | null; area_code_id: string | null };

export type { ActivitySubmitPayload };

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
  const [freshSeq, setFreshSeq] = useState(0);
  const [draftRestoredAt, setDraftRestoredAt] = useState<string | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState('');
  const initPhaseRef = useRef<'closed' | 'init' | 'capture' | 'settled'>('closed');
  const lastParsedRef = useRef('');
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const draftGenRef = useRef(0);
  const skipDraftRestoreRef = useRef(false);
  const lastSavedPhotoCountRef = useRef(0);

  const trackObjectUrl = useCallback((blob: Blob): string => {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return '';
    const u = URL.createObjectURL(blob);
    objectUrlsRef.current.add(u);
    return u;
  }, []);

  const revokeAllObjectUrls = useCallback(() => {
    if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') {
      objectUrlsRef.current.clear();
      return;
    }
    for (const u of objectUrlsRef.current) {
      URL.revokeObjectURL(u);
    }
    objectUrlsRef.current.clear();
  }, []);

  useEffect(() => revokeAllObjectUrls, [revokeAllObjectUrls]);

  const draftKey = useMemo(
    () =>
      p.userId
        ? buildActivityDraftKey({
            userId: p.userId,
            editingId: p.editingActivity?.id,
            linkedPmTaskId: p.linkedPmTask?.id,
            linkedJobOrderId: p.linkedJobOrder?.id,
          })
        : '',
    [p.userId, p.editingActivity?.id, p.linkedPmTask?.id, p.linkedJobOrder?.id],
  );
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
    if (!p.open) {
      draftGenRef.current += 1;
      setDraftRestoredAt(null);
      revokeAllObjectUrls();
      return;
    }
    initPhaseRef.current = 'init';
    newLogIdRef.current = newClientId();
    setOpenSeq((n) => n + 1);
    setDraftRestoredAt(null);
    lastSavedPhotoCountRef.current = 0;
    revokeAllObjectUrls();
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

    const shouldSkipDraft = skipDraftRestoreRef.current;
    skipDraftRestoreRef.current = false;
    const restoreGen = ++draftGenRef.current;
    if (!shouldSkipDraft && draftKey && props.userId) {
      void loadActivityDraft(draftKey, props.userId).then(async (draft) => {
        if (!draft || draftGenRef.current !== restoreGen || !initCtxRef.current.p.open) return;
        const hydratedPhotos: ActivityPhotoEntry[] = await Promise.all(
          (draft.photos ?? []).map(async (ph) => {
            const blobId = extractOfflineBlobId(ph.url);
            if (blobId) {
              const blob = await getOfflinePhotoBlob(blobId);
              if (blob) {
                const previewUrl = trackObjectUrl(blob);
                return { url: ph.url, storagePath: ph.storagePath, preview: previewUrl || ph.url };
              }
            }
            const resolved = ph.url.startsWith('data:image/')
              ? ph.url
              : resolveActivityPhotoUrl(ph.url, ph.storagePath);
            return { url: resolved, storagePath: ph.storagePath, preview: resolved };
          }),
        );
        if (draftGenRef.current !== restoreGen || !initCtxRef.current.p.open) return;
        if (draft.newLogId && !props.editingActivity) {
          newLogIdRef.current = draft.newLogId;
        }
        setActivityType(draft.activityType);
        setLeadOpId(draft.leadOpId);
        setCrewOpIds(draft.crewOpIds);
        setShiftTypeId(draft.shiftTypeId);
        setAreaCodeId(draft.areaCodeId);
        setAreaTouched(true);
        setSiteOrWell(draft.siteOrWell);
        setBlockLot(draft.blockLot);
        setStartedHHMM(draft.startedHHMM);
        setCompletedHHMM(draft.completedHHMM);
        setNotes(draft.notes);
        setGpsLat(draft.gpsLat);
        setGpsLng(draft.gpsLng);
        setGpsAccuracyM(draft.gpsAccuracyM);
        setGpsSource(draft.gpsSource);
        setPhotos(hydratedPhotos);
        lastSavedPhotoCountRef.current = hydratedPhotos.length;
        setDetails(draft.details);
        setJoTatJustification(draft.joTatJustification);
        setIsSample(draft.isSample);
        setDraftRestoredAt(draft.savedAt);
      });
    }
  }, [p.open, p.editingActivity?.id, p.linkedPmTask?.id, p.linkedJobOrder?.id, p.initialActivityType, p.initialLeadOperatorId, freshSeq, draftKey, revokeAllObjectUrls, trackObjectUrl]);

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

  useEffect(() => {
    if (!p.open || !draftKey || !p.userId || initPhaseRef.current !== 'settled' || submitting) return;
    if (!isDirty && !draftRestoredAt) return;

    const photosChanged = photos.length !== lastSavedPhotoCountRef.current;
    lastSavedPhotoCountRef.current = photos.length;
    const delayMs = photosChanged ? 0 : 400;

    const timer = setTimeout(() => {
      void saveActivityDraft({
        draftKey,
        ownerUserId: p.userId,
        savedAt: new Date().toISOString(),
        newLogId: p.editingActivity ? null : newLogIdRef.current,
        activityType,
        leadOpId,
        crewOpIds,
        shiftTypeId,
        areaCodeId,
        siteOrWell,
        blockLot,
        startedHHMM,
        completedHHMM,
        notes,
        gpsLat,
        gpsLng,
        gpsAccuracyM,
        gpsSource,
        photos: photos.map((ph) => ({ url: ph.url, storagePath: ph.storagePath })),
        details,
        joTatJustification,
        isSample,
      });
    }, delayMs);

    return () => clearTimeout(timer);
  }, [
    p.open, p.userId, p.editingActivity, draftKey, submitting, isDirty, draftRestoredAt,
    activityType, leadOpId, crewOpIds, shiftTypeId, areaCodeId, siteOrWell, blockLot,
    startedHHMM, completedHHMM, notes, gpsLat, gpsLng, gpsAccuracyM, gpsSource,
    photos, details, joTatJustification, isSample,
  ]);

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
    const removed = photos[idx];
    if (removed?.preview.startsWith('blob:') && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(removed.preview);
      objectUrlsRef.current.delete(removed.preview);
    }
    const blobId = removed ? extractOfflineBlobId(removed.url) : null;
    if (blobId) {
      void deleteOfflinePhotoBlobs([blobId]);
    }
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  }

  async function discardDraft() {
    draftGenRef.current += 1;
    const blobIds = photos.map((ph) => extractOfflineBlobId(ph.url)).filter((id): id is string => Boolean(id));
    if (draftKey) await deleteActivityDraft(draftKey);
    if (blobIds.length > 0) await deleteOfflinePhotoBlobs(blobIds);
    revokeAllObjectUrls();
    setDraftRestoredAt(null);
  }

  async function startFreshDraft() {
    await discardDraft();
    skipDraftRestoreRef.current = true;
    setFreshSeq((n) => n + 1);
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

    const persistPendingBlob = async (blob: Blob, fallbackDataUrl: string): Promise<ActivityPhotoEntry> => {
      const blobRef = await saveOfflinePhotoBlob(blob, p.userId);
      if (blobRef) {
        const previewUrl = trackObjectUrl(blob);
        return { url: blobRef, storagePath: null, preview: previewUrl || fallbackDataUrl };
      }
      return { url: fallbackDataUrl, storagePath: null, preview: fallbackDataUrl };
    };

    const count = Math.min(files.length, remaining);
    for (let i = 0; i < count; i++) {
      const file = files[i];
      try {
        if (navigator.onLine) {
          const res = await uploadActivityPhoto(sb, p.orgId, file, { sample: Boolean(p.sampleOnly || isSample) });
          if (res.uploadError) {
            setErrMsg(`Photo not uploaded yet (${res.uploadError}). It will be uploaded when you submit.`);
            if (res.blob) {
              added.push(await persistPendingBlob(res.blob, res.url));
            } else {
              added.push({ url: res.url, storagePath: res.storagePath, preview: res.url });
            }
          } else {
            added.push({ url: res.url, storagePath: res.storagePath, preview: res.url });
          }
          totalSaved += res.savedBytes;
        } else {
          const compact = await compressImageFile(file, 1024, 0.70);
          added.push(await persistPendingBlob(compact.blob, compact.dataUrl));
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
    if (activityType === CHLORINE_REFILL_ACTIVITY_TYPE) {
      const problem = validateChlorineRefill(details.chlorine, details.chlorineResidual);
      if (problem) {
        setErrMsg(problem);
        return;
      }
    }
    const gpsProblem = validateRequiredGps(gpsLat, gpsLng, p.editingActivity);
    if (gpsProblem) {
      setErrMsg(gpsProblem);
      return;
    }

    setSubmitting(true);
    const sigData =
      activityType === 'meter_test' && hasSignature && sigCanvasRef.current
        ? sigCanvasRef.current.toDataURL('image/png')
        : null;

    const { payload, resolvedCompletedAt, effectiveIsSample } = buildActivitySubmitPayload({
      orgId: p.orgId,
      userId: p.userId,
      date: p.date,
      activityType,
      leadOpId,
      crewOpIds,
      leadOpName,
      performedBySummary,
      shiftTypeId,
      areaCodeId,
      siteOrWell,
      blockLot,
      startedHHMM,
      completedHHMM,
      notes,
      details,
      meterCalc,
      gpsLat,
      gpsLng,
      gpsAccuracyM,
      gpsSource,
      photos,
      sigData,
      isSample,
      sampleOnly: p.sampleOnly,
      editingActivity: p.editingActivity,
      linkedPmTask: p.linkedPmTask,
      linkedJobOrder: p.linkedJobOrder,
    });

    const trimmedTat = joTatJustification.trim() || null;
    const capturedAtIso = new Date().toISOString();
    const newLogId = p.editingActivity ? null : newLogIdRef.current || (newLogIdRef.current = newClientId());
    const offlinePayload: ActivitySubmitPayload & { id?: string; created_at?: string } = {
      ...payload,
      ...(newLogId ? { id: newLogId, created_at: capturedAtIso } : {}),
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
      created_at: capturedAtIso,
      updated_at: capturedAtIso,
    });

    const queueOffline = async () => {
      if (!p.onQueuedOffline) return false;
      await p.onQueuedOffline(offlinePayload, queueOpts);
      draftGenRef.current += 1;
      if (draftKey) void deleteActivityDraft(draftKey);
      revokeAllObjectUrls();
      setDraftRestoredAt(null);
      setSubmitting(false);
      p.onSaved(buildOfflineActivityRow(), { offline: true });
      p.onClose();
      return true;
    };

    if (!navigator.onLine && (await queueOffline())) return;

    try {
      const sb = supabaseBrowser();
      let uploadedBlobIds: string[] = [];

      // Photos still held locally (IndexedDB blobs or data URLs) failed to upload earlier.
      // Upload them now; base64 image data must never be written into the database row.
      if (payload.photo_urls.some((u) => u.startsWith('data:') || u.startsWith(OFFLINE_BLOB_PREFIX))) {
        const upRes = await uploadPendingActivityPhotos(sb, p.orgId, photos, effectiveIsSample);
        uploadedBlobIds = upRes.uploadedBlobIds;
        setPhotos(upRes.ready);
        const photoUrls = upRes.ready.map((ph) => ph.url);
        const photoPaths = upRes.ready.map((ph) => ph.storagePath).filter((path): path is string => Boolean(path));
        payload.photo_urls = photoUrls;
        payload.photo_storage_paths = photoPaths;
        offlinePayload.photo_urls = photoUrls;
        offlinePayload.photo_storage_paths = photoPaths;
        if (upRes.uploadFailure) {
          if (await queueOffline()) return;
          setSubmitting(false);
          setErrMsg(`Photo upload failed: ${upRes.uploadFailure}. Try again, or remove the photo.`);
          return;
        }
      }

      const result = await persistActivitySubmission(sb, {
        payload,
        resolvedCompletedAt,
        trimmedTat,
        sigData,
        newLogId,
        effectiveIsSample,
        role: p.role,
        operatorId: p.operatorId,
        leadOpId,
        crewOpIds,
        date: p.date,
        activityType,
        notes,
        editingActivity: p.editingActivity,
        linkedPmTask: p.linkedPmTask,
        linkedJobOrder: p.linkedJobOrder,
      });

      draftGenRef.current += 1;
      if (draftKey) void deleteActivityDraft(draftKey);
      if (uploadedBlobIds.length > 0) void deleteOfflinePhotoBlobs(uploadedBlobIds);
      revokeAllObjectUrls();
      setDraftRestoredAt(null);
      setSubmitting(false);
      if (result.isEdit) {
        p.onSaved(result.savedRow);
      } else {
        p.onSaved(result.savedRow, {
          tatJustification: trimmedTat,
          completedByIds: result.pmPerformers,
          pmUpdateFailed: result.pmUpdateFailed,
          linkedWarning: result.linkedWarning,
        });
      }
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
    draftRestoredAt, discardDraft, startFreshDraft,
    leadOpName, performedBySummary, sameShiftOps, otherOps, meterCalc, toggleCrew, handleSubmit,
  };
}
