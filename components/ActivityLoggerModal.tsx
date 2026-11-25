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
  type LinkedJobOrder,
  type LinkedPmTask,
} from '@/lib/activity-types';
export type { LinkedJobOrder, LinkedPmTask };
import { getErrorMessage } from '@/lib/error-utils';
import { resolveActivityPhotoUrl } from '@/lib/activity-media';
import { extractGpsMetadata, type GpsSource } from '@/lib/gps-accuracy';
import { buildPmActualPerformerIds, getDefaultPmPerformers, isMissingCompletedByColumnError } from '@/lib/pm-credit';
import { DAILY_ACTIVITY_LIST_COLUMNS } from '@/lib/query-columns';
import {
  buildActivityDetailsPayload,
  calcDurationMinutes,
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
import { compressImageFile, uploadActivityPhoto } from '@/lib/image-compress';
import ActivityCategoryFields from '@/components/ActivityCategoryFields';
import ActivityMediaCapture, { type ActivityPhotoEntry } from '@/components/ActivityMediaCapture';

const MAX_ACTIVITY_PHOTOS = 4;

export type LoggerOperator = { id: string; full_name: string; position: string | null; default_station?: string | null };
export type LoggerArea = { id: string; code: string; name: string | null; category: string; sub_sites?: string[] };
export type LoggerShift = { id: string; code: string; description?: string | null; start_time?: string | null; end_time?: string | null; is_off?: boolean };
export type LoggerAssignment = { operator_id: string; shift_type_id: string | null; area_code_id: string | null };

export default function ActivityLoggerModal(p: {
  open: boolean;
  onClose: () => void;
  onSaved: (
    activity: DailyActivityRow,
    opts?: { offline?: boolean; tatJustification?: string | null; completedByIds?: string[] },
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
  const [gpsAccuracyM, setGpsAccuracyM] = useState<number | null>(null);
  const [gpsSource, setGpsSource] = useState<GpsSource | null>(null);

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
  const [joTatJustification, setJoTatJustification] = useState('');
  const [isSample, setIsSample] = useState(Boolean(p.sampleOnly));
  const [openAtMs, setOpenAtMs] = useState(0);
  const lastParsedRef = useRef('');
  const initCtxRef = useRef({ p, asgByOp, stationAreas, stationIdSet });
  initCtxRef.current = { p, asgByOp, stationAreas, stationIdSet };

  // Initialize defaults whenever modal opens
  useEffect(() => {
    if (!p.open) return;
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

    // Reset all activity-specific telemetry fields so previous submissions never bleed over
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
      const toHHMM = (iso: string | null) => {
        if (!iso) return '';
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
        const hh = parts.find((x) => x.type === 'hour')?.value ?? '';
        const mm = parts.find((x) => x.type === 'minute')?.value ?? '';
        return hh && mm ? `${hh === '24' ? '00' : hh}:${mm}` : '';
      };
      setStartedHHMM(toHHMM(ea.started_at));
      setCompletedHHMM(toHHMM(ea.completed_at) || currentManilaHHMM());
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
          timeStarted: hydrated.wellPullout.timeStarted || toHHMM(ea.started_at),
          timeFinished: hydrated.wellPullout.timeFinished || toHHMM(ea.completed_at),
          overallRemarks: hydrated.wellPullout.overallRemarks || (ea.notes ?? ''),
        };
      } else if (ea.activity_type === 'tank_cleaning') {
        hydrated.tankCleaning = {
          ...hydrated.tankCleaning,
          dateStarted: hydrated.tankCleaning.dateStarted || ea.activity_date,
          timeStarted: hydrated.tankCleaning.timeStarted || toHHMM(ea.started_at),
          timeFinished: hydrated.tankCleaning.timeFinished || toHHMM(ea.completed_at),
          conclusionRecommendations: hydrated.tankCleaning.conclusionRecommendations || (ea.notes ?? ''),
        };
      }
      setDetails(hydrated);
      return;
    }

    // Determine initial activity type (reconciles preset codes, custom PM types, and title keywords)
    const pmMapped = props.linkedPmTask ? resolveActivityTypeFromPm(props.linkedPmTask, props.pmActivityTypes) : undefined;
    const initAct = props.linkedJobOrder?.activity_type || pmMapped || props.initialActivityType || 'pump_monitoring';
    setActivityType(ACTIVITY_TYPES.some((a) => a.id === initAct) ? initAct : 'pump_monitoring');

    const pmDefaults = props.linkedPmTask ? getDefaultPmPerformers(props.linkedPmTask, props.operatorId) : [];
    const defaultLead = props.initialLeadOperatorId ?? props.linkedJobOrder?.assigned_operator_ids?.[0] ?? pmDefaults[0] ?? props.operatorId ?? '';
    setLeadOpId(defaultLead);
    const linkedCrew = props.linkedJobOrder?.assigned_operator_ids ?? pmDefaults;
    setCrewOpIds(linkedCrew.filter((id) => id && id !== defaultLead));

    // Area & Shift from linked JO, PM location match, or Roster assignment
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

    // Site / BlockLot / Account fields
    setSiteOrWell(
      props.linkedJobOrder?.site_or_well ??
        (props.linkedPmTask
          ? [props.linkedPmTask.locations?.join(', '), props.linkedPmTask.asset].filter(Boolean).join(' · ')
          : ''),
    );
    setBlockLot(props.linkedJobOrder?.block_lot ?? '');

    // Clear signature canvas if present
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
    const added: Array<{ url: string; storagePath: string | null; preview: string }> = [];

    const count = Math.min(files.length, remaining);
    for (let i = 0; i < count; i++) {
      const file = files[i];
      try {
        if (navigator.onLine) {
          const res = await uploadActivityPhoto(sb, p.orgId, file, { sample: Boolean(p.sampleOnly || isSample) });
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
    type ActivitySubmitPayload = Omit<
      DailyActivityRow,
      'id' | 'verified_by' | 'verified_at' | 'review_note' | 'photos_purged_at' | 'created_at' | 'updated_at'
    >;
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

      const { data, error } = await sb.from('daily_activities').insert(payload).select(DAILY_ACTIVITY_LIST_COLUMNS).single();
      if (error) throw error;

      const pmPerformers = !effectiveIsSample && p.linkedPmTask?.id ? buildPmActualPerformerIds(leadOpId, p.role === 'operator' && p.operatorId ? [...crewOpIds, p.operatorId] : crewOpIds) : undefined;
      if (!effectiveIsSample && p.linkedPmTask?.id) {
        const pmBase = { status: 'done', completed_at: p.date, remarks: notes.trim() || `Logged via field activity (${activityType})` };
        const pmRes = await sb.from('pm_tasks').update({ ...pmBase, completed_by_operator_ids: pmPerformers }).eq('id', p.linkedPmTask.id);
        if (isMissingCompletedByColumnError(pmRes.error)) await sb.from('pm_tasks').update(pmBase).eq('id', p.linkedPmTask.id);
      }

      const trimmedTat = joTatJustification.trim() || null;
      if (!effectiveIsSample && p.linkedJobOrder?.id) {
        await sb
          .from('job_orders')
          .update({ status: 'completed', completed_at: new Date().toISOString(), ...(trimmedTat ? { tat_justification: trimmedTat } : {}) })
          .eq('id', p.linkedJobOrder.id);
      }

      setSubmitting(false);
      const savedRow: DailyActivityRow = {
        ...(data as unknown as DailyActivityRow),
        ...(sigData !== null ? { signature_data: sigData } : {}),
      };
      p.onSaved(savedRow, { tatJustification: trimmedTat, completedByIds: pmPerformers });
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
                        className="chip-btn"
                        aria-pressed={siteOrWell === s}
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
              {sameShiftOps.concat(showAllOps ? otherOps : []).map((op) => {
                const selected = crewOpIds.includes(op.id);
                const dashed = !sameShiftOps.includes(op);
                return (
                  <button
                    key={op.id}
                    type="button"
                    className="chip-btn"
                    aria-pressed={selected}
                    onClick={() => toggleCrew(op.id)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 999,
                      fontSize: 11.5,
                      fontWeight: 600,
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
              {sameShiftOps.length === 0 && otherOps.length === 0 && (
                <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>No other active operators available.</span>
              )}
            </div>
          </div>
        </div>

        {/* Dynamic Specialized Fields based on activityType */}
        <ActivityCategoryFields
          activityType={activityType} fields={details} setFields={setDetails} meterCalc={meterCalc}
          sigCanvasRef={sigCanvasRef} sigDrawingRef={sigDrawingRef} setHasSignature={setHasSignature}
          activityDate={p.date} leadOpName={leadOpName} performedBySummary={performedBySummary}
        />

        {/* Times + Notes (Pull-Out and Tank Cleaning collect start/finish & notes inside their structured forms) */}
        {activityType !== 'well_pull_out' && activityType !== 'tank_cleaning' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                Start Time (optional)
                <input
                  className="input" type="time" value={startedHHMM}
                  onChange={(e) => {
                    const nextStart = e.target.value;
                    setStartedHHMM(nextStart);
                    if (activityType === 'backwash') {
                      const mins = calcDurationMinutes(nextStart, completedHHMM);
                      if (mins) setDetails((prev) => ({ ...prev, backwashDurationMin: mins }));
                    }
                  }}
                />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                Completion Time
                <input
                  className="input" type="time" value={completedHHMM}
                  onChange={(e) => {
                    const nextEnd = e.target.value;
                    setCompletedHHMM(nextEnd);
                    if (activityType === 'backwash') {
                      const mins = calcDurationMinutes(startedHHMM, nextEnd);
                      if (mins) setDetails((prev) => ({ ...prev, backwashDurationMin: mins }));
                    }
                  }}
                />
              </label>
            </div>

            <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600 }}>
              Field Notes / Observations
              <textarea
                className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Work performed, pressure/reading summary, follow-ups needed…" style={{ minHeight: 58 }}
              />
            </label>
          </>
        )}

        {/* GPS & 30-day Expiring Photo Capture */}
        <ActivityMediaCapture
          gpsLat={gpsLat}
          gpsLng={gpsLng}
          gpsAccuracyM={gpsAccuracyM}
          gpsSource={gpsSource}
          onGpsChange={(fix) => {
            setGpsLat(fix.lat);
            setGpsLng(fix.lng);
            setGpsAccuracyM(fix.accuracyM);
            setGpsSource(fix.source);
          }}
          uploadingPhoto={uploadingPhoto} onPhotoUpload={handlePhotoUpload} savedBytesTotal={savedBytesTotal}
          photos={photos} onRemovePhoto={(idx) => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
          maxPhotos={MAX_ACTIVITY_PHOTOS}
          helperNote={activityType === 'tank_cleaning' ? 'Photo 1 = Start (Pre-Cleaning) · Photo 2 = End (Post-Cleaning). Auto-deleted after 30 days.' : undefined}
        />

        {p.linkedJobOrder?.deadline && openAtMs > new Date(p.linkedJobOrder.deadline).getTime() && (
          <label className="card" style={{ padding: 10, display: 'grid', gap: 4, fontSize: 12, fontWeight: 600, background: 'var(--warn-bg)', borderColor: 'var(--warn-border)', color: 'var(--warn-fg)' }}>
            <span>⚠️ Job Order {p.linkedJobOrder.jo_number} is past its SLA deadline — TAT Justification (optional)</span>
            <input className="input" value={joTatJustification} onChange={(e) => setJoTatJustification(e.target.value)} placeholder="e.g. Awaited customer access / materials…" />
          </label>
        )}

        {!p.editingActivity && (p.sampleOnly || p.canLogSample) && (
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '7px 10px', borderRadius: 6, background: 'var(--warn-bg)', color: 'var(--warn-fg)', border: '1px solid var(--warn-border)', fontSize: 12, fontWeight: 600, cursor: p.sampleOnly ? 'default' : 'pointer' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={Boolean(p.sampleOnly || isSample)} disabled={Boolean(p.sampleOnly)} onChange={(e) => setIsSample(e.target.checked)} />
              <span>Log as sample (auto-deletes in 24h){p.sampleOnly ? ' · Required for department heads' : ''}</span>
            </span>
          </label>
        )}

        {errMsg && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: 'var(--danger)', fontWeight: 600 }}>{errMsg}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button type="button" className="btn" onClick={p.onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={submitting || uploadingPhoto}>
            {submitting ? 'Saving Activity…' : p.editingActivity ? 'Save Changes' : p.linkedPmTask ? 'Log Activity & Complete PM' : p.linkedJobOrder ? 'Log Activity & Close JO' : 'Submit Activity Log'}
          </button>
        </div>
      </form>
    </div>
  );
}
