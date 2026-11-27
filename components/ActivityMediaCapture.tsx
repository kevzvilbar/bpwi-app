'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  startHighAccuracyGpsCapture,
  type GpsSource,
} from '@/lib/gps-accuracy';
import { Badge } from '@/components/ui';

const GpsPinPickerModal = dynamic(() => import('@/components/GpsPinPickerModal'), { ssr: false });

export interface ActivityPhotoEntry {
  url: string;
  storagePath: string | null;
  preview: string;
}

interface ActivityMediaCaptureProps {
  gpsLat: number | null;
  gpsLng: number | null;
  gpsAccuracyM: number | null;
  gpsSource: GpsSource | null;
  onGpsChange: (fix: {
    lat: number | null;
    lng: number | null;
    accuracyM: number | null;
    source: GpsSource | null;
  }) => void;
  uploadingPhoto: boolean;
  onPhotoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  savedBytesTotal: number;
  photos: ActivityPhotoEntry[];
  onRemovePhoto: (index: number) => void;
  maxPhotos?: number;
  helperNote?: string;
}

export default function ActivityMediaCapture({
  gpsLat,
  gpsLng,
  gpsAccuracyM,
  gpsSource,
  onGpsChange,
  uploadingPhoto,
  onPhotoUpload,
  savedBytesTotal,
  photos,
  onRemovePhoto,
  maxPhotos = 4,
  helperNote,
}: ActivityMediaCaptureProps) {
  const limitReached = photos.length >= maxPhotos;
  const cancelGpsRef = useRef<(() => void) | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [liveStatus, setLiveStatus] = useState('');
  const [gpsError, setGpsError] = useState('');
  const [hintCoords, setHintCoords] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [pinModalOpen, setPinModalOpen] = useState(false);

  useEffect(() => {
    return () => {
      cancelGpsRef.current?.();
      cancelGpsRef.current = null;
    };
  }, []);

  function stopGpsCapture() {
    cancelGpsRef.current?.();
    cancelGpsRef.current = null;
    setCapturing(false);
    setLiveStatus('');
  }

  function handleStartGps() {
    if (capturing) {
      stopGpsCapture();
      return;
    }
    setGpsError('');
    setCapturing(true);
    setLiveStatus('Warming up satellites (target ≤3m, max 10m)…');

    cancelGpsRef.current = startHighAccuracyGpsCapture({
      onProgress: (prog) => {
        setHintCoords({ ...prog.lastCoords, accuracy: prog.bestAccuracy });
        if (prog.validCount > 0) {
          setLiveStatus(`Refining GPS… ±${prog.currentAccuracy}m (${prog.validCount}/${prog.targetSamples} tight fixes)`);
        } else {
          setLiveStatus(`Locking GPS… ±${prog.currentAccuracy}m (waiting for ≤10m · ${prog.elapsedSec}s)`);
        }
      },
      onLocked: (res) => {
        cancelGpsRef.current = null;
        setCapturing(false);
        setLiveStatus('');
        setGpsError('');
        setHintCoords({ lat: res.lat, lng: res.lng, accuracy: res.accuracy });
        onGpsChange({ lat: res.lat, lng: res.lng, accuracyM: res.accuracy, source: 'gps' });
      },
      onError: (failure) => {
        cancelGpsRef.current = null;
        setCapturing(false);
        setLiveStatus('');
        if (failure.lastCoords) {
          setHintCoords({ ...failure.lastCoords, accuracy: failure.bestAccuracy });
        }
        setGpsError(failure.message);
      },
    });
  }

  function handleClearGps() {
    stopGpsCapture();
    setGpsError('');
    onGpsChange({ lat: null, lng: null, accuracyM: null, source: null });
  }

  return (
    <div style={{ display: 'grid', gap: 8, padding: 10, borderRadius: 8, border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn" onClick={handleStartGps} style={{ fontSize: 12 }}>
            {capturing
              ? '🛰️ Locking ≤10m… (Cancel)'
              : gpsLat !== null && gpsLng !== null
                ? `📍 ${gpsLat}, ${gpsLng}`
                : '📍 Attach GPS (≤10m) *'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              stopGpsCapture();
              setPinModalOpen(true);
            }}
            style={{ fontSize: 12 }}
          >
            🗺️ Pin on Map
          </button>
          {gpsLat !== null && (
            <button
              type="button"
              className="btn"
              onClick={handleClearGps}
              aria-label="Clear GPS location"
              title="Clear location"
              style={{ fontSize: 11.5, padding: '4px 8px' }}
            >
              ✕
            </button>
          )}
          {gpsSource === 'map_pin' ? (
            <Badge size="sm" tone="warn">Map Pin (manual)</Badge>
          ) : gpsLat !== null && gpsAccuracyM !== null ? (
            <Badge size="sm" tone={gpsAccuracyM <= 3 ? 'ok' : 'info'}>
              GPS ±{gpsAccuracyM}m
            </Badge>
          ) : null}
        </div>

        <label
          className="btn"
          style={{
            fontSize: 12,
            cursor: uploadingPhoto ? 'wait' : limitReached ? 'not-allowed' : 'pointer',
            opacity: limitReached ? 0.6 : 1,
          }}
        >
          {uploadingPhoto
            ? 'Compressing & Uploading…'
            : limitReached
              ? `📷 Max ${maxPhotos} Photos (${photos.length}/${maxPhotos})`
              : `📷 Add Field Photos (${photos.length}/${maxPhotos})`}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            disabled={uploadingPhoto || limitReached}
            onChange={onPhotoUpload}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      {liveStatus && (
        <div style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 600 }}>
          {liveStatus}
        </div>
      )}

      {gpsError && (
        <div
          style={{
            fontSize: 11.5,
            padding: '6px 9px',
            borderRadius: 6,
            background: 'var(--warn-bg)',
            color: 'var(--warn-fg)',
            border: '1px solid var(--warn-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span>{gpsError}</span>
          <button
            type="button"
            className="btn"
            style={{ fontSize: 11.5, minHeight: 36, padding: '4px 10px', fontWeight: 700 }}
            onClick={() => setPinModalOpen(true)}
          >
            Pin on Satellite Map
          </button>
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <span>{helperNote ?? 'GPS location is required to save a log and is captured only when you tap a location button · Photos auto-delete after 30 days (180d for meter tests & leak repairs) · Telemetry governed by BPWI RA 10173 retention policy.'}</span>
        {savedBytesTotal > 0 && (
          <span style={{ color: 'var(--ok-fg)', fontWeight: 700 }}>
            Saved {(savedBytesTotal / 1024).toFixed(0)} KB
          </span>
        )}
      </div>

      {photos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {photos.map((ph, idx) => (
            <div key={idx} style={{ position: 'relative', width: 68, height: 68 }}>
              <img
                src={ph.preview}
                alt={`Field attachment ${idx + 1}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }}
              />
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => onRemovePhoto(idx)}
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  width: 24,
                  height: 24,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 999,
                  border: 'none',
                  background: 'var(--danger)',
                  color: 'var(--primary-fg)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {pinModalOpen && (
        <GpsPinPickerModal
          open={pinModalOpen}
          initialLat={gpsLat}
          initialLng={gpsLng}
          hintCoords={hintCoords}
          title="Pin Activity Location (Satellite Map)"
          onClose={() => setPinModalOpen(false)}
          onConfirm={({ lat, lng }) => {
            setPinModalOpen(false);
            setGpsError('');
            onGpsChange({ lat, lng, accuracyM: null, source: 'map_pin' });
          }}
        />
      )}
    </div>
  );
}
