import { haversineMeters, isValidCoordinate } from './route-footprints.ts';

export const GPS_IDEAL_ACCURACY_M = 3;
export const GPS_MAX_ACCURACY_M = 10;
export const GPS_TARGET_SAMPLES = 4;
export const GPS_MAX_WAIT_MS = 20_000;
export const GPS_OUTLIER_MAX_JUMP_M = 15;

export type GpsSource = 'gps' | 'map_pin';

export interface GpsSample {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

export interface GpsLockResult {
  lat: number;
  lng: number;
  accuracy: number;
  sampleCount: number;
  source: 'gps';
}

export interface GpsMetadata {
  gpsAccuracyM: number | null;
  gpsSource: GpsSource | null;
}

export interface GpsCaptureProgress {
  currentAccuracy: number;
  bestAccuracy: number;
  validCount: number;
  targetSamples: number;
  elapsedSec: number;
  lastCoords: { lat: number; lng: number };
}

export interface GpsCaptureFailure {
  code: 'unsupported' | 'permission_denied' | 'timeout_coarse' | 'unavailable';
  message: string;
  bestAccuracy?: number;
  lastCoords?: { lat: number; lng: number };
}

export function isAcceptableGpsSample(
  sample: GpsSample,
  maxAccuracyM: number = GPS_MAX_ACCURACY_M,
): boolean {
  return (
    isValidCoordinate(sample.lat, sample.lng) &&
    Number.isFinite(sample.accuracy) &&
    sample.accuracy > 0 &&
    sample.accuracy <= maxAccuracyM
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Removes spatial multipath outliers (> `maxDeviationM` from sample-cluster median).
 * If every reading disagrees beyond `maxDeviationM`, falls back to the tightest reported accuracy.
 */
export function filterSpatialOutliers(
  samples: readonly GpsSample[],
  maxDeviationM: number = GPS_OUTLIER_MAX_JUMP_M,
): GpsSample[] {
  if (samples.length < 3) return [...samples];
  const medLat = median(samples.map((s) => s.lat));
  const medLng = median(samples.map((s) => s.lng));
  const center = { lat: medLat, lng: medLng };
  const inliers = samples.filter((s) => haversineMeters(center, { lat: s.lat, lng: s.lng }) <= maxDeviationM);
  if (inliers.length > 0) return inliers;

  let best = samples[0];
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i].accuracy < best.accuracy) best = samples[i];
  }
  return [best];
}

/**
 * Computes an inverse-variance (`1 / accuracy^2`) weighted fix over valid `<= maxAccuracyM` samples.
 * Returns `null` when no acceptable samples exist.
 */
export function computeWeightedGpsFix(
  samples: readonly GpsSample[],
  maxAccuracyM: number = GPS_MAX_ACCURACY_M,
): GpsLockResult | null {
  const acceptable = samples.filter((s) => isAcceptableGpsSample(s, maxAccuracyM));
  if (acceptable.length === 0) return null;

  const filtered = filterSpatialOutliers(acceptable);
  let sumWeight = 0;
  let sumLat = 0;
  let sumLng = 0;
  let sumAcc = 0;

  for (const s of filtered) {
    const clampedAcc = Math.max(1, s.accuracy);
    const w = 1 / (clampedAcc * clampedAcc);
    sumWeight += w;
    sumLat += s.lat * w;
    sumLng += s.lng * w;
    sumAcc += s.accuracy * w;
  }

  return {
    lat: Number((sumLat / sumWeight).toFixed(6)),
    lng: Number((sumLng / sumWeight).toFixed(6)),
    accuracy: Number((sumAcc / sumWeight).toFixed(1)),
    sampleCount: filtered.length,
    source: 'gps',
  };
}

export function extractGpsMetadata(details: Record<string, unknown> | null | undefined): GpsMetadata {
  if (!details || typeof details !== 'object') {
    return { gpsAccuracyM: null, gpsSource: null };
  }
  const rawAcc = details.gpsAccuracyM;
  const parsedAcc =
    typeof rawAcc === 'number' && Number.isFinite(rawAcc) && rawAcc > 0
      ? Math.round(rawAcc * 10) / 10
      : null;
  const rawSrc = details.gpsSource;
  const gpsSource: GpsSource | null = rawSrc === 'gps' || rawSrc === 'map_pin' ? rawSrc : null;
  return { gpsAccuracyM: parsedAcc, gpsSource };
}

export const GPS_INTERNAL_DETAIL_KEYS: ReadonlySet<string> = new Set(['gpsSource', 'gpsAccuracyM']);

export interface TaggedGpsDisplay {
  coords: string;
  sourceLabel: string;
  fullText: string;
  mapUrl: string;
}

export function formatGpsBadgeLabel(details: Record<string, unknown> | null | undefined): string | null {
  const { gpsAccuracyM, gpsSource } = extractGpsMetadata(details);
  if (gpsSource === 'map_pin') return 'Map Pin';
  if (gpsAccuracyM !== null) return `GPS ±${gpsAccuracyM}m`;
  return null;
}

/**
 * Formats an activity's tagged latitude/longitude and capture metadata for printable reports
 * and detail views. Returns `null` when coordinates are missing or invalid.
 */
export function formatTaggedGpsPosition(
  lat: number | null | undefined,
  lng: number | null | undefined,
  details?: Record<string, unknown> | null,
): TaggedGpsDisplay | null {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !isValidCoordinate(lat, lng)) {
    return null;
  }
  const latStr = lat.toFixed(6);
  const lngStr = lng.toFixed(6);
  const coords = `${latStr}, ${lngStr}`;
  const { gpsAccuracyM, gpsSource } = extractGpsMetadata(details);
  const sourceLabel =
    gpsSource === 'map_pin'
      ? 'Map Pin'
      : gpsAccuracyM !== null
        ? `GPS (±${gpsAccuracyM}m)`
        : 'GPS';
  return {
    coords,
    sourceLabel,
    fullText: `${coords} (${sourceLabel})`,
    mapUrl: `https://www.google.com/maps?q=${latStr},${lngStr}`,
  };
}

export interface HighAccuracyGpsCaptureOptions {
  idealAccuracyM?: number;
  maxAccuracyM?: number;
  targetSamples?: number;
  timeoutMs?: number;
  onProgress?: (progress: GpsCaptureProgress) => void;
  onLocked: (result: GpsLockResult) => void;
  onError: (failure: GpsCaptureFailure) => void;
}

/**
 * Starts continuous GNSS satellite warmup (`watchPosition`, `maximumAge: 0`),
 * rejecting coarse readings `> maxAccuracyM` (10m), locking immediately on `<= idealAccuracyM` (3m),
 * and weighted-averaging up to `targetSamples` tight readings. Returns a `cancel()` callback.
 */
export function startHighAccuracyGpsCapture(opts: HighAccuracyGpsCaptureOptions): () => void {
  const idealAccuracyM = opts.idealAccuracyM ?? GPS_IDEAL_ACCURACY_M;
  const maxAccuracyM = opts.maxAccuracyM ?? GPS_MAX_ACCURACY_M;
  const targetSamples = opts.targetSamples ?? GPS_TARGET_SAMPLES;
  const timeoutMs = opts.timeoutMs ?? GPS_MAX_WAIT_MS;

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    opts.onError({
      code: 'unsupported',
      message: 'Geolocation is not supported in this browser.',
    });
    return () => {};
  }

  let done = false;
  let watchId: number | null = null;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  const startMs = Date.now();
  const validSamples: GpsSample[] = [];
  let bestRawAccuracy: number | null = null;
  let lastRawCoords: { lat: number; lng: number } | undefined;

  const cleanup = () => {
    if (watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  const finishSuccess = (result: GpsLockResult) => {
    if (done) return;
    done = true;
    cleanup();
    opts.onLocked(result);
  };

  const finishFailure = (failure: GpsCaptureFailure) => {
    if (done) return;
    done = true;
    cleanup();
    opts.onError(failure);
  };

  timerId = setTimeout(() => {
    if (done) return;
    const weighted = computeWeightedGpsFix(validSamples, maxAccuracyM);
    if (weighted) {
      finishSuccess(weighted);
      return;
    }
    const bestLabel = bestRawAccuracy !== null ? ` Best signal was ±${Math.round(bestRawAccuracy)}m.` : '';
    finishFailure({
      code: 'timeout_coarse',
      message: `Could not reach ≤${maxAccuracyM}m GPS accuracy within ${Math.round(timeoutMs / 1000)}s.${bestLabel} Step outside for clear sky or use "Pin on Map".`,
      bestAccuracy: bestRawAccuracy ?? undefined,
      lastCoords: lastRawCoords,
    });
  }, timeoutMs);

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (done) return;
      if (typeof pos.timestamp === 'number' && pos.timestamp > 0 && pos.timestamp < startMs - 5_000) {
        return;
      }

      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = pos.coords.accuracy;
      if (!isValidCoordinate(lat, lng) || !Number.isFinite(accuracy) || accuracy <= 0) return;

      lastRawCoords = { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
      if (bestRawAccuracy === null || accuracy < bestRawAccuracy) {
        bestRawAccuracy = accuracy;
      }

      const sample: GpsSample = {
        lat,
        lng,
        accuracy,
        timestamp: pos.timestamp || Date.now(),
      };

      if (accuracy <= idealAccuracyM) {
        opts.onProgress?.({
          currentAccuracy: Math.round(accuracy * 10) / 10,
          bestAccuracy: Math.round((bestRawAccuracy ?? accuracy) * 10) / 10,
          validCount: validSamples.length + 1,
          targetSamples,
          elapsedSec: Math.round((Date.now() - startMs) / 1000),
          lastCoords: lastRawCoords,
        });
        finishSuccess({
          lat: Number(lat.toFixed(6)),
          lng: Number(lng.toFixed(6)),
          accuracy: Number(accuracy.toFixed(1)),
          sampleCount: 1,
          source: 'gps',
        });
        return;
      }

      if (accuracy <= maxAccuracyM) {
        validSamples.push(sample);
      }

      opts.onProgress?.({
        currentAccuracy: Math.round(accuracy * 10) / 10,
        bestAccuracy: Math.round((bestRawAccuracy ?? accuracy) * 10) / 10,
        validCount: validSamples.length,
        targetSamples,
        elapsedSec: Math.round((Date.now() - startMs) / 1000),
        lastCoords: lastRawCoords,
      });

      if (validSamples.length >= targetSamples) {
        const weighted = computeWeightedGpsFix(validSamples, maxAccuracyM);
        if (weighted) finishSuccess(weighted);
      }
    },
    (err) => {
      if (done) return;
      if (err.code === 1) {
        finishFailure({
          code: 'permission_denied',
          message: 'Location permission denied. Enable Precise Location in browser settings or use "Pin on Map".',
          bestAccuracy: bestRawAccuracy ?? undefined,
          lastCoords: lastRawCoords,
        });
      }
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
  );

  return () => {
    done = true;
    cleanup();
  };
}
