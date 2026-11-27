import { supabaseBrowser } from '@/lib/supabase/client';
import type { DailyActivityRow, LinkedJobOrder, LinkedPmTask } from '@/lib/activity-types';
import { getErrorMessage } from '@/lib/error-utils';
import { type GpsSource } from '@/lib/gps-accuracy';
import { buildPmActualPerformerIds, isMissingCompletedByColumnError } from '@/lib/pm-credit';
import { DAILY_ACTIVITY_LIST_COLUMNS } from '@/lib/query-columns';
import { computePhotoExpiryIso } from '@/lib/photo-retention';
import {
  buildActivityDetailsPayload,
  toManilaTimestampIso,
  type ActivityDetailFieldsState,
} from '@/lib/activity-logger-details';
import { normalizePulloutDateYMD, normalizePulloutTimeHHMM } from '@/lib/well-pullout-types';
import { uploadBlobPhoto, uploadDataUrlPhoto } from '@/lib/image-compress';
import { extractOfflineBlobId, OFFLINE_BLOB_PREFIX } from '@/lib/offline-sync-core';
import { getOfflinePhotoBlob } from '@/lib/offline-queue';
import type { ActivityPhotoEntry } from '@/components/ActivityMediaCapture';

export type ActivitySubmitPayload = Omit<
  DailyActivityRow,
  'id' | 'verified_by' | 'verified_at' | 'review_note' | 'photos_purged_at' | 'created_at' | 'updated_at'
> & {
  tat_justification?: string | null;
};

export interface BuildActivitySubmitPayloadInput {
  orgId: string;
  userId: string;
  date: string;
  activityType: string;
  leadOpId: string;
  crewOpIds: string[];
  leadOpName: string;
  performedBySummary: string;
  shiftTypeId: string;
  areaCodeId: string;
  siteOrWell: string;
  blockLot: string;
  startedHHMM: string;
  completedHHMM: string;
  notes: string;
  details: ActivityDetailFieldsState;
  meterCalc: ReturnType<typeof import('@/lib/activity-types').computeMeterTestResult>;
  gpsLat: number | null;
  gpsLng: number | null;
  gpsAccuracyM: number | null;
  gpsSource: GpsSource | null;
  photos: ActivityPhotoEntry[];
  sigData: string | null;
  isSample: boolean;
  sampleOnly?: boolean;
  editingActivity?: DailyActivityRow | null;
  linkedPmTask?: LinkedPmTask | null;
  linkedJobOrder?: LinkedJobOrder | null;
}

/**
 * Builds the normalized `daily_activities` insert/update payload along with resolved
 * completion timestamp and effective sample flag.
 */
export function buildActivitySubmitPayload(input: BuildActivitySubmitPayloadInput): {
  payload: ActivitySubmitPayload;
  resolvedCompletedAt: string;
  effectiveIsSample: boolean;
} {
  const { activityType, details, date, startedHHMM, completedHHMM, notes, siteOrWell, blockLot } = input;
  const isPullout = activityType === 'well_pull_out';
  const isTankClean = activityType === 'tank_cleaning';

  const wpStartYmd = normalizePulloutDateYMD(details.wellPullout.dateStarted, date);
  const wpEndYmd = normalizePulloutDateYMD(details.wellPullout.dateFinished, wpStartYmd);
  const tcStartYmd = normalizePulloutDateYMD(details.tankCleaning.dateStarted, date);
  const tcEndYmd = normalizePulloutDateYMD(details.tankCleaning.dateFinished, tcStartYmd);

  const resolvedStartedAt = isPullout
    ? toManilaTimestampIso(wpStartYmd, normalizePulloutTimeHHMM(details.wellPullout.timeStarted))
    : isTankClean
      ? toManilaTimestampIso(tcStartYmd, normalizePulloutTimeHHMM(details.tankCleaning.timeStarted))
      : toManilaTimestampIso(date, startedHHMM);

  const resolvedCompletedAt = isPullout
    ? toManilaTimestampIso(wpEndYmd, normalizePulloutTimeHHMM(details.wellPullout.timeFinished)) ?? new Date().toISOString()
    : isTankClean
      ? toManilaTimestampIso(tcEndYmd, normalizePulloutTimeHHMM(details.tankCleaning.timeFinished)) ?? new Date().toISOString()
      : toManilaTimestampIso(date, completedHHMM) ?? new Date().toISOString();

  const resolvedNotes = isPullout
    ? details.wellPullout.overallRemarks.trim() || notes.trim() || null
    : isTankClean
      ? details.tankCleaning.conclusionRecommendations.trim() || notes.trim() || null
      : notes.trim() || null;

  const siteText = siteOrWell.trim();
  const locText = [siteText, blockLot.trim()].filter(Boolean).join(' · ');
  const detailsForSubmit: ActivityDetailFieldsState = isPullout
    ? {
        ...details,
        wellPullout: {
          ...details.wellPullout,
          dateStarted: wpStartYmd,
          dateFinished: wpEndYmd,
          performedByContractor: input.performedBySummary || details.wellPullout.performedByContractor,
        },
      }
    : isTankClean
      ? {
          ...details,
          tankCleaning: {
            ...details.tankCleaning,
            tankId: siteText || details.tankCleaning.tankId,
            dateStarted: tcStartYmd,
            dateFinished: tcEndYmd,
          },
        }
      : {
          ...details,
          samplePoint: activityType === 'water_sampling' ? locText || details.samplePoint : details.samplePoint,
          filterUnit: activityType === 'backwash' ? siteText || details.filterUnit : details.filterUnit,
          scannedEquipment: activityType === 'thermal_scanning' ? siteText || details.scannedEquipment : details.scannedEquipment,
          driverName: activityType === 'tankering' ? input.leadOpName || details.driverName : details.driverName,
        };

  const preservedExpiry =
    input.editingActivity?.photos_expires_at ??
    (input.editingActivity?.created_at
      ? computePhotoExpiryIso(activityType, new Date(input.editingActivity.created_at).getTime())
      : computePhotoExpiryIso(activityType));

  const baseDetails = buildActivityDetailsPayload(activityType, detailsForSubmit, input.meterCalc);
  const gpsMetaPayload =
    input.gpsLat !== null && input.gpsLng !== null
      ? {
          ...(input.gpsSource ? { gpsSource: input.gpsSource } : {}),
          ...(input.gpsAccuracyM !== null ? { gpsAccuracyM: input.gpsAccuracyM } : {}),
        }
      : {};

  const effectiveIsSample = input.editingActivity
    ? Boolean(input.editingActivity.is_sample)
    : Boolean(input.sampleOnly || input.isSample);

  const payload: ActivitySubmitPayload = {
    organization_id: input.orgId,
    activity_date: date,
    logged_by: input.userId,
    lead_operator_id: input.leadOpId || null,
    crew_operator_ids: input.crewOpIds.filter((id) => id && id !== input.leadOpId),
    shift_type_id: input.shiftTypeId || null,
    area_code_id: input.areaCodeId || null,
    site_or_well: siteText || null,
    block_lot: blockLot.trim() || null,
    activity_type: activityType,
    pm_task_id: input.linkedPmTask?.id ?? null,
    status: 'submitted',
    started_at: resolvedStartedAt,
    completed_at: resolvedCompletedAt,
    gps_lat: input.gpsLat,
    gps_lng: input.gpsLng,
    notes: resolvedNotes,
    details: { ...baseDetails, ...gpsMetaPayload },
    photo_urls: input.photos.map((ph) => ph.url),
    photo_storage_paths: input.photos.map((ph) => ph.storagePath).filter((sp): sp is string => Boolean(sp)),
    photos_expires_at: input.photos.length > 0 ? preservedExpiry : null,
    signature_data: input.sigData,
    is_sample: effectiveIsSample,
    ...(input.linkedJobOrder?.id ? { job_order_id: input.linkedJobOrder.id } : {}),
  };

  return { payload, resolvedCompletedAt, effectiveIsSample };
}

/**
 * Uploads any pending offline photo blobs or legacy data URLs to Storage before DB write.
 * Preserves already-uploaded photos on partial failure so retries never double-upload.
 */
export async function uploadPendingActivityPhotos(
  sb: ReturnType<typeof supabaseBrowser>,
  orgId: string,
  photos: ActivityPhotoEntry[],
  effectiveIsSample: boolean,
): Promise<{
  ready: ActivityPhotoEntry[];
  uploadedBlobIds: string[];
  uploadFailure: string;
}> {
  const ready: ActivityPhotoEntry[] = [];
  const uploadedBlobIds: string[] = [];
  let uploadFailure = '';

  for (const ph of photos) {
    const isPending = ph.url.startsWith('data:') || ph.url.startsWith(OFFLINE_BLOB_PREFIX);
    if (!isPending || uploadFailure) {
      ready.push(ph);
      continue;
    }
    try {
      const blobId = extractOfflineBlobId(ph.url);
      let up: { url: string; storagePath: string | null };
      if (blobId) {
        const blob = await getOfflinePhotoBlob(blobId);
        if (!blob) {
          throw new Error('Queued photo file is missing from device storage');
        }
        up = await uploadBlobPhoto(sb, orgId, blob, { requireStorage: true, sample: effectiveIsSample });
        if (up.storagePath) uploadedBlobIds.push(blobId);
      } else {
        up = await uploadDataUrlPhoto(sb, orgId, ph.url, { requireStorage: true, sample: effectiveIsSample });
      }
      ready.push({ url: up.url, storagePath: up.storagePath, preview: up.url });
    } catch (err: unknown) {
      uploadFailure = getErrorMessage(err, 'Photo upload failed');
      ready.push(ph);
    }
  }

  return { ready, uploadedBlobIds, uploadFailure };
}

export interface PersistActivitySubmissionParams {
  payload: ActivitySubmitPayload;
  resolvedCompletedAt: string;
  trimmedTat: string | null;
  sigData: string | null;
  newLogId: string | null;
  effectiveIsSample: boolean;
  role?: string;
  operatorId: string | null;
  leadOpId: string;
  crewOpIds: string[];
  date: string;
  activityType: string;
  notes: string;
  editingActivity?: DailyActivityRow | null;
  linkedPmTask?: LinkedPmTask | null;
  linkedJobOrder?: LinkedJobOrder | null;
}

/**
 * Persists an activity edit or idempotent insert (`23505` recovery) and closes any linked PM task or Job Order.
 */
export async function persistActivitySubmission(
  sb: ReturnType<typeof supabaseBrowser>,
  params: PersistActivitySubmissionParams,
): Promise<{
  savedRow: DailyActivityRow;
  isEdit: boolean;
  pmPerformers?: string[];
  pmUpdateFailed: boolean;
  linkedWarning?: string;
}> {
  const { payload, sigData, editingActivity, newLogId, effectiveIsSample } = params;
  const { tat_justification: _omitTat, ...dbInsertPayload } = payload;

  if (editingActivity?.id) {
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
      status: editingActivity.status === 'flagged' ? 'submitted' : editingActivity.status,
    };
    const { data, error } = await sb
      .from('daily_activities')
      .update(updatePayload)
      .eq('id', editingActivity.id)
      .select(DAILY_ACTIVITY_LIST_COLUMNS)
      .single();
    if (error) throw error;
    const savedRow: DailyActivityRow = {
      ...(data as unknown as DailyActivityRow),
      ...(sigData !== null ? { signature_data: sigData } : {}),
    };
    return { savedRow, isEdit: true, pmUpdateFailed: false };
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
    !effectiveIsSample && params.linkedPmTask?.id
      ? buildPmActualPerformerIds(
          params.leadOpId,
          params.role === 'operator' && params.operatorId ? [...params.crewOpIds, params.operatorId] : params.crewOpIds,
        )
      : undefined;

  let pmErrMsg: string | null = null;
  if (!effectiveIsSample && params.linkedPmTask?.id) {
    const pmBase = {
      status: 'done' as const,
      completed_at: params.date,
      remarks: params.notes.trim() || `Logged via field activity (${params.activityType})`,
    };
    let pmRes = await sb.from('pm_tasks').update({ ...pmBase, completed_by_operator_ids: pmPerformers }).eq('id', params.linkedPmTask.id);
    if (isMissingCompletedByColumnError(pmRes.error)) {
      pmRes = await sb.from('pm_tasks').update(pmBase).eq('id', params.linkedPmTask.id);
    }
    if (pmRes.error) pmErrMsg = pmRes.error.message;
  }

  let joErrMsg: string | null = null;
  if (!effectiveIsSample && params.linkedJobOrder?.id) {
    const joRes = await sb
      .from('job_orders')
      .update({
        status: 'completed',
        completed_at: params.resolvedCompletedAt,
        ...(params.trimmedTat ? { tat_justification: params.trimmedTat } : {}),
      })
      .eq('id', params.linkedJobOrder.id);
    if (joRes.error) joErrMsg = joRes.error.message;
  }

  const warnParts: string[] = [];
  if (pmErrMsg) warnParts.push(`PM task could not be marked done (${pmErrMsg})`);
  if (joErrMsg) warnParts.push(`Job Order could not be closed (${joErrMsg})`);
  const linkedWarning = warnParts.length > 0 ? `Activity saved, but ${warnParts.join('; ')}.` : undefined;

  const savedRow: DailyActivityRow = {
    ...(data as unknown as DailyActivityRow),
    ...(sigData !== null ? { signature_data: sigData } : {}),
  };

  return {
    savedRow,
    isEdit: false,
    pmPerformers,
    pmUpdateFailed: Boolean(pmErrMsg),
    linkedWarning,
  };
}
