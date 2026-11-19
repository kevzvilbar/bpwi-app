import type { SupabaseClient } from '@supabase/supabase-js';
import { ACTIVITY_MEDIA_BUCKET, buildActivityPhotoUrl } from './activity-media';

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
 * If the storage bucket is not yet provisioned or inaccessible, gracefully falls back
 * to a compact 480px JPEG dataUrl so offline/unconfigured environments keep working.
 */
export async function uploadActivityPhoto(
  sb: SupabaseClient,
  orgId: string,
  file: File,
): Promise<{ url: string; storagePath: string | null; savedBytes: number }> {
  const compressed = await compressImageFile(file, 1024, 0.72);
  const ext = compressed.mimeType === 'image/webp' ? 'webp' : 'jpg';
  const rand = Math.random().toString(36).slice(2, 8);
  const dateFolder = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  const storagePath = `${orgId}/${dateFolder}/${Date.now()}-${rand}.${ext}`;

  try {
    const { error } = await sb.storage
      .from(ACTIVITY_MEDIA_BUCKET)
      .upload(storagePath, compressed.blob, {
        contentType: compressed.mimeType,
        cacheControl: '3600',
        upsert: false,
      });

    if (!error) {
      return {
        url: buildActivityPhotoUrl(storagePath),
        storagePath,
        savedBytes: compressed.savedBytes,
      };
    }
  } catch {
    /* Bucket missing or offline — use compact fallback */
  }

  const fallback = await compressImageFile(file, 480, 0.65);
  return {
    url: fallback.dataUrl,
    storagePath: null,
    savedBytes: Math.max(compressed.savedBytes, fallback.savedBytes),
  };
}

/**
 * Converts a base64 data URL (e.g. from offline IndexedDB queue) and uploads it to
 * Supabase Storage 'activity-media' when connectivity returns.
 */
export async function uploadDataUrlPhoto(
  sb: SupabaseClient,
  orgId: string,
  dataUrl: string,
): Promise<{ url: string; storagePath: string | null }> {
  if (!dataUrl.startsWith('data:image/')) {
    return { url: dataUrl, storagePath: null };
  }
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const mimeType = blob.type || 'image/jpeg';
    const ext = mimeType.includes('webp') ? 'webp' : mimeType.includes('png') ? 'png' : 'jpg';
    const rand = Math.random().toString(36).slice(2, 8);
    const dateFolder = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
    const storagePath = `${orgId}/${dateFolder}/${Date.now()}-${rand}.${ext}`;

    const { error } = await sb.storage
      .from(ACTIVITY_MEDIA_BUCKET)
      .upload(storagePath, blob, {
        contentType: mimeType,
        cacheControl: '3600',
        upsert: false,
      });

    if (!error) {
      return { url: buildActivityPhotoUrl(storagePath), storagePath };
    }
  } catch {
    /* keep dataUrl fallback if storage is still unreachable */
  }
  return { url: dataUrl, storagePath: null };
}
