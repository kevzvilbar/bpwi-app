import type { SupabaseClient } from '@supabase/supabase-js';
import { ACTIVITY_MEDIA_BUCKET, buildActivityPhotoUrl, samplePhotoStem } from './activity-media.ts';
import { getErrorMessage } from './error-utils.ts';

export interface CompressedImageResult {
  blob: Blob;
  dataUrl: string;
  savedBytes: number;
  mimeType: string;
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

/**
 * Compresses an image file client-side using an offscreen canvas (max 1024px, WebP/JPEG at 0.72).
 */
export async function compressImageFile(
  file: File,
  maxDim = 1024,
  quality = 0.72,
): Promise<CompressedImageResult> {
  const img = await loadImageElement(file);
  const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
  const targetW = Math.max(1, Math.round(img.width * scale));
  const targetH = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      blob: file,
      dataUrl: await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = rej;
        r.readAsDataURL(file);
      }),
      savedBytes: 0,
      mimeType: file.type || 'image/jpeg',
    };
  }

  ctx.drawImage(img, 0, 0, targetW, targetH);

  let mimeType = 'image/webp';
  let blob = await canvasToBlob(canvas, 'image/webp', quality);
  if (!blob || blob.type !== 'image/webp') {
    mimeType = 'image/jpeg';
    blob = await canvasToBlob(canvas, 'image/jpeg', quality);
  }
  const finalBlob = blob ?? file;
  const dataUrl = canvas.toDataURL(mimeType, quality);
  const savedBytes = Math.max(0, file.size - finalBlob.size);

  return { blob: finalBlob, dataUrl, savedBytes, mimeType };
}

/**
 * Compresses the image and uploads to Supabase Storage bucket 'activity-media'.
 * If the upload fails, returns the compressed image as a dataUrl with `storagePath: null` and the reason in
 * `uploadError`. That is a pending photo: it must be uploaded (or queued offline) before the log is saved,
 * and must never be written into a database row.
 */
export async function uploadActivityPhoto(
  sb: SupabaseClient,
  orgId: string,
  file: File,
  opts: { sample?: boolean } = {},
): Promise<{ url: string; storagePath: string | null; savedBytes: number; blob?: Blob; uploadError?: string }> {
  const compressed = await compressImageFile(file, 1024, 0.72);
  const ext = compressed.mimeType === 'image/webp' ? 'webp' : 'jpg';
  const rand = Math.random().toString(36).slice(2, 8);
  const dateFolder = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  const storagePath = `${orgId}/${dateFolder}/${samplePhotoStem(`${Date.now()}-${rand}`, opts.sample)}.${ext}`;

  let uploadError = 'Photo upload failed';
  try {
    const { error } = await sb.storage
      .from(ACTIVITY_MEDIA_BUCKET)
      .upload(storagePath, compressed.blob, {
        contentType: compressed.mimeType,
        cacheControl: '604800',
        upsert: false,
      });

    if (!error) {
      return {
        url: buildActivityPhotoUrl(storagePath),
        storagePath,
        savedBytes: compressed.savedBytes,
      };
    }
    uploadError = error.message || uploadError;
  } catch (err: unknown) {
    uploadError = getErrorMessage(err, uploadError);
  }

  return {
    url: compressed.dataUrl,
    storagePath: null,
    savedBytes: compressed.savedBytes,
    blob: compressed.blob,
    uploadError,
  };
}

/**
 * Decodes a base64 data URL directly into a Blob in memory so CSP `connect-src`
 * never needs `data:` and offline queue uploads do not rely on `fetch(dataUrl)`.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) {
    throw new Error('Invalid image data URL');
  }
  const mimeType = match[1] || 'image/jpeg';
  const binary = atob(match[2].replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * Uploads a compressed image Blob to Supabase Storage 'activity-media' cleanly and idempotently.
 */
export async function uploadBlobPhoto(
  sb: SupabaseClient,
  orgId: string,
  blob: Blob,
  opts: { fileStem?: string; requireStorage?: boolean; sample?: boolean } = {},
): Promise<{ url: string; storagePath: string | null }> {
  const mimeType = blob.type || 'image/jpeg';
  const ext = mimeType.includes('webp') ? 'webp' : mimeType.includes('png') ? 'png' : 'jpg';
  const rand = Math.random().toString(36).slice(2, 8);
  const dateFolder = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  const stem = opts.fileStem && /^[A-Za-z0-9_-]+$/.test(opts.fileStem) ? opts.fileStem : `${Date.now()}-${rand}`;
  const storagePath = `${orgId}/${dateFolder}/${samplePhotoStem(stem, opts.sample)}.${ext}`;

  const { error } = await sb.storage
    .from(ACTIVITY_MEDIA_BUCKET)
    .upload(storagePath, blob, {
      contentType: mimeType,
      cacheControl: '604800',
      upsert: false,
    });

  const already =
    error && (String((error as { statusCode?: string }).statusCode) === '409' || /already exists|duplicate/i.test(error.message ?? ''));
  if (!error || already) {
    return { url: buildActivityPhotoUrl(storagePath), storagePath };
  }
  if (opts.requireStorage) throw new Error(error.message || 'Photo upload failed');
  return { url: '', storagePath: null };
}

/**
 * Converts a base64 data URL (e.g. from legacy offline IndexedDB queue items) and uploads it to
 * Supabase Storage 'activity-media' when connectivity returns.
 */
export async function uploadDataUrlPhoto(
  sb: SupabaseClient,
  orgId: string,
  dataUrl: string,
  opts: { fileStem?: string; requireStorage?: boolean; sample?: boolean } = {},
): Promise<{ url: string; storagePath: string | null }> {
  if (!dataUrl.startsWith('data:image/')) {
    return { url: dataUrl, storagePath: null };
  }
  try {
    const blob = dataUrlToBlob(dataUrl);
    const res = await uploadBlobPhoto(sb, orgId, blob, opts);
    if (res.storagePath) {
      return res;
    }
  } catch (e) {
    if (opts.requireStorage) throw e instanceof Error ? e : new Error('Photo upload failed');
    /* keep dataUrl fallback if storage is still unreachable */
  }
  if (opts.requireStorage) throw new Error('Photo upload failed');
  return { url: dataUrl, storagePath: null };
}
