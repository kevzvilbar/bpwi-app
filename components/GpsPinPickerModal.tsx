'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import type * as LeafletNS from 'leaflet';
import { SegmentedTabs } from '@/components/ui';
import { DEFAULT_LEAFLET_TILE_OPTIONS, getPublicTileAdminNotice, resolveMapTileConfig } from '@/lib/map-tiles';
import type { FreeMapStyle } from '@/components/FreeRouteMap';

const DEFAULT_PH_CENTER: [number, number] = [10.7202, 122.5621];

function createPickerIcon(L: typeof LeafletNS): LeafletNS.DivIcon {
  const el = document.createElement('div');
  el.style.width = '22px';
  el.style.height = '22px';
  el.style.borderRadius = '50%';
  el.style.background = '#0284c7';
  el.style.border = '3px solid #ffffff';
  el.style.boxShadow = '0 2px 8px rgba(15, 23, 42, 0.55)';
  return L.divIcon({
    className: 'bpwi-pin-picker-marker',
    html: el,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

export default function GpsPinPickerModal(p: {
  open: boolean;
  isAdmin?: boolean;
  initialLat: number | null;
  initialLng: number | null;
  hintCoords?: { lat: number; lng: number; accuracy?: number } | null;
  title?: string;
  onConfirm: (coords: { lat: number; lng: number }) => void;
  onClose: () => void;
}) {
  const [mapStyle, setMapStyle] = useState<FreeMapStyle>('satellite');
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(() =>
    p.initialLat !== null && p.initialLng !== null
      ? { lat: Number(p.initialLat.toFixed(6)), lng: Number(p.initialLng.toFixed(6)) }
      : p.hintCoords
        ? { lat: Number(p.hintCoords.lat.toFixed(6)), lng: Number(p.hintCoords.lng.toFixed(6)) }
        : null,
  );
  const [ready, setReady] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<typeof LeafletNS | null>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const tileLayerRef = useRef<LeafletNS.TileLayer | null>(null);
  const markerRef = useRef<LeafletNS.Marker | null>(null);

  useEffect(() => {
    if (!p.open) return;
    if (p.initialLat !== null && p.initialLng !== null) {
      setPicked({ lat: Number(p.initialLat.toFixed(6)), lng: Number(p.initialLng.toFixed(6)) });
    } else if (p.hintCoords) {
      setPicked({ lat: Number(p.hintCoords.lat.toFixed(6)), lng: Number(p.hintCoords.lng.toFixed(6)) });
    } else {
      setPicked(null);
    }
  }, [p.open, p.initialLat, p.initialLng, p.hintCoords]);

  useEffect(() => {
    if (!p.open) return;
    const el = containerRef.current;
    if (!el) return;

    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;

    import('leaflet')
      .then((mod) => {
        if (disposed || !containerRef.current) return;
        const L = ((mod as unknown as { default?: typeof LeafletNS }).default ?? mod) as typeof LeafletNS;
        leafletRef.current = L;

        const startLat = p.initialLat ?? p.hintCoords?.lat ?? DEFAULT_PH_CENTER[0];
        const startLng = p.initialLng ?? p.hintCoords?.lng ?? DEFAULT_PH_CENTER[1];
        const startZoom = p.initialLat !== null || p.hintCoords ? 18 : 13;

        const map = L.map(containerRef.current, {
          zoomControl: true,
          scrollWheelZoom: true,
          center: [startLat, startLng],
          zoom: startZoom,
        });

        if (p.hintCoords && p.hintCoords.accuracy && p.hintCoords.accuracy > 0) {
          L.circle([p.hintCoords.lat, p.hintCoords.lng], {
            radius: Math.min(250, p.hintCoords.accuracy),
            color: '#f59e0b',
            weight: 1.5,
            dashArray: '4 4',
            fillOpacity: 0.08,
          }).addTo(map);
        }

        const placeMarker = (lat: number, lng: number) => {
          const roundedLat = Number(lat.toFixed(6));
          const roundedLng = Number(lng.toFixed(6));
          setPicked({ lat: roundedLat, lng: roundedLng });
          if (markerRef.current) {
            markerRef.current.setLatLng([roundedLat, roundedLng]);
          } else {
            const m = L.marker([roundedLat, roundedLng], {
              icon: createPickerIcon(L),
              draggable: true,
            }).addTo(map);
            m.on('dragend', () => {
              const ll = m.getLatLng();
              setPicked({ lat: Number(ll.lat.toFixed(6)), lng: Number(ll.lng.toFixed(6)) });
            });
            markerRef.current = m;
          }
        };

        if (p.initialLat !== null && p.initialLng !== null) {
          placeMarker(p.initialLat, p.initialLng);
        } else if (p.hintCoords) {
          placeMarker(p.hintCoords.lat, p.hintCoords.lng);
        }

        map.on('click', (ev: LeafletNS.LeafletMouseEvent) => {
          placeMarker(ev.latlng.lat, ev.latlng.lng);
        });

        mapRef.current = map;

        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            map.invalidateSize({ animate: false });
          });
          resizeObserver.observe(containerRef.current);
        }

        setReady(true);
      })
      .catch(() => {
        /* ignore Leaflet load error */
      });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      markerRef.current = null;
      tileLayerRef.current = null;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setReady(false);
    };
  }, [p.open, p.initialLat, p.initialLng, p.hintCoords]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }

    const tileConfig = resolveMapTileConfig(mapStyle);
    tileLayerRef.current = L.tileLayer(tileConfig.url, {
      attribution: tileConfig.attribution,
      maxNativeZoom: tileConfig.maxNativeZoom,
      maxZoom: tileConfig.maxZoom,
      ...DEFAULT_LEAFLET_TILE_OPTIONS,
    }).addTo(map);
  }, [ready, mapStyle]);

  if (!p.open) return null;

  const activeTileConfig = resolveMapTileConfig(mapStyle);
  const publicTileNotice = p.isAdmin ? getPublicTileAdminNotice(mapStyle, activeTileConfig) : null;

  return (
    <div
      className="modal-overlay no-print"
      role="dialog"
      aria-modal="true"
      aria-label={p.title ?? 'Pin exact location on map'}
      onClick={p.onClose}
      style={{ zIndex: 95 }}
    >
      <div
        className="modal-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 820, width: '100%', display: 'grid', gap: 10 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16.5 }}>{p.title ?? 'Pin Exact Location on Map'}</h2>
            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
              Tap or drag the blue pin directly over the structure, well, or meter.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SegmentedTabs
              ariaLabel="Pin picker map style"
              size="sm"
              value={mapStyle}
              onChange={(v) => setMapStyle(v)}
              items={[
                { id: 'satellite', label: 'Satellite' },
                { id: 'street', label: 'Street' },
              ]}
            />
            <button type="button" className="btn" onClick={p.onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </div>

        {publicTileNotice && (
          <div
            role="note"
            style={{
              fontSize: 11.5,
              padding: '6px 10px',
              borderRadius: 6,
              background: 'var(--warn-bg)',
              color: 'var(--warn-fg)',
              border: '1px solid var(--warn-border)',
              fontWeight: 600,
            }}
          >
            {publicTileNotice}
          </div>
        )}

        <div
          ref={containerRef}
          style={{
            width: '100%',
            height: 'clamp(240px, 52vh, 460px)',
            borderRadius: 8,
            overflow: 'hidden',
            border: '1px solid var(--border)',
            background: 'var(--surface-muted)',
          }}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {picked ? (
              <span>
                Selected pin: <b className="tabular-nums">{picked.lat}, {picked.lng}</b> · Tagged as <b>Map Pin</b>
              </span>
            ) : (
              <span>Click anywhere on the map to place a pin.</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={p.onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!picked}
              onClick={() => picked && p.onConfirm(picked)}
            >
              Confirm Map Pin
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
