'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type * as MapLibreGL from 'maplibre-gl';
import { SegmentedTabs } from '@/components/ui';
import { buildRasterMapStyle, getMapStyleOptions, getPublicTileAdminNotice, resolveMapTileConfig } from '@/lib/map-tiles';
import type { FreeMapStyle } from '@/components/FreeRouteMap';

const DEFAULT_PH_CENTER: [number, number] = [122.5621, 10.7202];
const ACCURACY_SOURCE_ID = 'bpwi-gps-accuracy';
const ACCURACY_FILL_LAYER_ID = 'bpwi-gps-accuracy-fill';
const ACCURACY_LINE_LAYER_ID = 'bpwi-gps-accuracy-line';

function resolveModalStyleSpec(style: FreeMapStyle): string | MapLibreGL.StyleSpecification {
  const tileConfig = resolveMapTileConfig(style);
  if (tileConfig.kind === 'vector-style') {
    return tileConfig.url;
  }
  return buildRasterMapStyle(tileConfig) as unknown as MapLibreGL.StyleSpecification;
}

function createPickerElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.width = '22px';
  el.style.height = '22px';
  el.style.borderRadius = '50%';
  el.style.background = '#0284c7';
  el.style.border = '3px solid #ffffff';
  el.style.boxShadow = '0 2px 8px rgba(15, 23, 42, 0.55)';
  el.style.cursor = 'grab';
  return el;
}

function buildAccuracyCircleGeoJson(lat: number, lng: number, radiusMeters: number) {
  const steps = 48;
  const clamped = Math.min(250, Math.max(1, radiusMeters));
  const dLat = clamped / 111320;
  const dLng = clamped / (111320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const theta = (i / steps) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(theta), lat + dLat * Math.sin(theta)]);
  }
  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'Polygon' as const,
          coordinates: [ring],
        },
      },
    ],
  };
}

function syncAccuracyCircleOnMap(
  map: MapLibreGL.Map,
  hintCoords: { lat: number; lng: number; accuracy?: number } | null | undefined,
) {
  if (!map.isStyleLoaded() || !hintCoords || !hintCoords.accuracy || hintCoords.accuracy <= 0) return;

  const data = buildAccuracyCircleGeoJson(hintCoords.lat, hintCoords.lng, hintCoords.accuracy);
  const existing = map.getSource(ACCURACY_SOURCE_ID) as MapLibreGL.GeoJSONSource | undefined;
  if (existing) {
    existing.setData(data);
  } else {
    map.addSource(ACCURACY_SOURCE_ID, { type: 'geojson', data });
  }

  if (!map.getLayer(ACCURACY_FILL_LAYER_ID)) {
    map.addLayer({
      id: ACCURACY_FILL_LAYER_ID,
      type: 'fill',
      source: ACCURACY_SOURCE_ID,
      paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.1 },
    });
  }

  if (!map.getLayer(ACCURACY_LINE_LAYER_ID)) {
    map.addLayer({
      id: ACCURACY_LINE_LAYER_ID,
      type: 'line',
      source: ACCURACY_SOURCE_ID,
      paint: { 'line-color': '#f59e0b', 'line-width': 1.5, 'line-dasharray': [3, 3] },
    });
  }
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
  const [mapStyle, setMapStyle] = useState<FreeMapStyle>('street');
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(() =>
    p.initialLat !== null && p.initialLng !== null
      ? { lat: Number(p.initialLat.toFixed(6)), lng: Number(p.initialLng.toFixed(6)) }
      : p.hintCoords
        ? { lat: Number(p.hintCoords.lat.toFixed(6)), lng: Number(p.hintCoords.lng.toFixed(6)) }
        : null,
  );
  const [ready, setReady] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const maplibreRef = useRef<typeof MapLibreGL | null>(null);
  const mapRef = useRef<MapLibreGL.Map | null>(null);
  const markerRef = useRef<MapLibreGL.Marker | null>(null);
  const activeStyleRef = useRef<FreeMapStyle>(mapStyle);
  const hintCoordsRef = useRef(p.hintCoords);
  hintCoordsRef.current = p.hintCoords;

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
    const initialStyle = activeStyleRef.current;

    import('maplibre-gl')
      .then((mod) => {
        if (disposed || !containerRef.current) return;
        const maplibregl = ((mod as unknown as { default?: typeof MapLibreGL }).default ?? mod) as typeof MapLibreGL;
        maplibreRef.current = maplibregl;

        const startLat = p.initialLat ?? p.hintCoords?.lat ?? DEFAULT_PH_CENTER[1];
        const startLng = p.initialLng ?? p.hintCoords?.lng ?? DEFAULT_PH_CENTER[0];
        const startZoom = p.initialLat !== null || p.hintCoords ? 18 : 13;

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: resolveModalStyleSpec(initialStyle),
          center: [startLng, startLat],
          zoom: startZoom,
          attributionControl: { compact: true },
        });

        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

        map.on('style.load', () => {
          syncAccuracyCircleOnMap(map, hintCoordsRef.current);
        });

        const placeMarker = (lat: number, lng: number) => {
          const roundedLat = Number(lat.toFixed(6));
          const roundedLng = Number(lng.toFixed(6));
          setPicked({ lat: roundedLat, lng: roundedLng });
          if (markerRef.current) {
            markerRef.current.setLngLat([roundedLng, roundedLat]);
          } else {
            const m = new maplibregl.Marker({
              element: createPickerElement(),
              anchor: 'center',
              draggable: true,
            })
              .setLngLat([roundedLng, roundedLat])
              .addTo(map);
            m.on('dragend', () => {
              const ll = m.getLngLat();
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

        map.on('click', (ev: MapLibreGL.MapMouseEvent) => {
          placeMarker(ev.lngLat.lat, ev.lngLat.lng);
        });

        mapRef.current = map;

        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            map.resize();
          });
          resizeObserver.observe(containerRef.current);
        }

        setReady(true);
      })
      .catch(() => {
        /* ignore MapLibre load error */
      });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      markerRef.current?.remove();
      markerRef.current = null;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setReady(false);
    };
  }, [p.open, p.initialLat, p.initialLng, p.hintCoords]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || activeStyleRef.current === mapStyle) return;
    activeStyleRef.current = mapStyle;
    map.setStyle(resolveModalStyleSpec(mapStyle));
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
              items={getMapStyleOptions()}
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
          className="bpwi-map-container"
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
