'use client';

export interface ActivityPhotoEntry {
  url: string;
  storagePath: string | null;
  preview: string;
}

interface ActivityMediaCaptureProps {
  gpsLat: number | null;
  gpsLng: number | null;
  gpsStatus: string;
  onCaptureGps: () => void;
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
  gpsStatus,
  onCaptureGps,
  uploadingPhoto,
  onPhotoUpload,
  savedBytesTotal,
  photos,
  onRemovePhoto,
  maxPhotos = 4,
  helperNote,
}: ActivityMediaCaptureProps) {
  const limitReached = photos.length >= maxPhotos;
  return (
    <div style={{ display: 'grid', gap: 8, padding: 10, borderRadius: 8, border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <button type="button" className="btn" onClick={onCaptureGps} style={{ fontSize: 12 }}>
          {gpsLat !== null ? `📍 ${gpsLat}, ${gpsLng}` : '📍 Attach GPS Location'}
        </button>
        {gpsStatus && <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{gpsStatus}</span>}

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

      <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <span>{helperNote ?? 'Compressed client-side · Photos auto-deleted after 30 days to conserve storage limits.'}</span>
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
                  top: -5,
                  right: -5,
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  border: 'none',
                  background: 'var(--danger)',
                  color: 'var(--primary-fg)',
                  fontSize: 11,
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
    </div>
  );
}
