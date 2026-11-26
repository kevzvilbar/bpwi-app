'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as MapLibreGL from 'maplibre-gl';
import { fmtTimeManila } from '@/lib/date';
import { formatGpsBadgeLabel } from '@/lib/gps-accuracy';
import { buildRasterMapStyle, resolveMapTileConfig, type MapStyle } from '@/lib/map-tiles';
import type { LatLng, RouteStop } from '@/lib/route-footprints';

export type FreeMapStyle = MapStyle;

// MapLibre uses [lng, lat] coordinates
const DEFAULT_PH_CENTER: [number, number] = [122.5621, 10.7202];
const ROUTE_SOURCE_ID = 'bpwi-route';
const ROUTE_CASING_LAYER_ID = 'bpwi-route-casing';
const ROUTE_ROAD_LAYER_ID = 'bpwi-route-road';
const ROUTE_FALLBACK_LAYER_ID = 'bpwi-route-fallback';

function resolveMapStyleInput(style: FreeMapStyle): string | MapLibreGL.StyleSpecification {
  const tileConfig = resolveMapTileConfig(style);
  if (tileConfig.kind === 'vector-style') {
    return tileConfig.url;
  }
  return buildRasterMapStyle(tileConfig) as unknown as MapLibreGL.StyleSpecification;
}

function createPinElement(stop: RouteStop, isSelected: boolean): HTMLDivElement {
  const isBase = stop.kind !== 'activity';
  const el = document.createElement('div');
  el.className = isSelected ? 'bpwi-map-pin is-selected' : 'bpwi-map-pin';
  el.style.backgroundColor = isBase ? '#0f172a' : stop.color;
  el.textContent = isBase ? 'HQ' : String(stop.sequence);
  el.title = `#${stop.sequence} ${stop.label}`;
  el.setAttribute('aria-label', `#${stop.sequence} ${stop.label}`);
  return el;
}

function appendExternalLink(parent: HTMLElement, label: string, href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = label;
  a.style.color = 'var(--accent)';
  a.style.fontWeight = '700';
  a.style.textDecoration = 'none';
  parent.appendChild(a);
}

function buildStopPopupElement(stop: RouteStop): HTMLDivElement {
  const root = document.createElement('div');
  root.style.display = 'grid';
  root.style.gap = '4px';
  root.style.fontSize = '12.5px';
  root.style.minWidth = '185px';
  root.style.maxWidth = '250px';
  root.style.color = 'var(--text)';

  const title = document.createElement('div');
  title.style.fontWeight = '800';
  title.textContent = `#${stop.sequence} · ${stop.label}`;
  root.appendChild(title);

  if (stop.sublabel) {
    const sub = document.createElement('div');
    sub.style.color = 'var(--text-secondary)';
    sub.textContent = stop.sublabel;
    root.appendChild(sub);
  }

  if (stop.timestamp) {
    const meta = document.createElement('div');
    meta.style.fontSize = '11.5px';
    meta.style.color = 'var(--text-secondary)';
    const roleSuffix = stop.roleInActivity
      ? ` · ${stop.roleInActivity === 'lead' ? 'Lead' : 'Crew'}`
      : '';
    meta.textContent = `Logged: ${fmtTimeManila(stop.timestamp)}${roleSuffix}`;
    root.appendChild(meta);
  }

  if (stop.activity?.notes) {
    const notes = document.createElement('div');
    notes.style.fontSize = '11.5px';
    notes.style.color = 'var(--text-secondary)';
    notes.style.whiteSpace = 'pre-wrap';
    const raw = stop.activity.notes;
    notes.textContent = raw.length > 140 ? `${raw.slice(0, 140)}…` : raw;
    root.appendChild(notes);
  }

  const coordsRow = document.createElement('div');
  coordsRow.style.fontSize = '11px';
  coordsRow.style.color = 'var(--text-muted)';
  coordsRow.style.fontFamily = 'monospace';
  const gpsQuality = formatGpsBadgeLabel(stop.activity?.details);
  coordsRow.textContent = `${stop.lat.toFixed(5)}, ${stop.lng.toFixed(5)}${gpsQuality ? ` · ${gpsQuality}` : ''}`;
  root.appendChild(coordsRow);

  const linksRow = document.createElement('div');
  linksRow.style.display = 'flex';
  linksRow.style.gap = '10px';
  linksRow.style.flexWrap = 'wrap';
  linksRow.style.fontSize = '11.5px';
  linksRow.style.marginTop = '2px';

  appendExternalLink(
    linksRow,
    'OpenStreetMap ↗',
    `https://www.openstreetmap.org/?mlat=${stop.lat}&mlon=${stop.lng}#map=17/${stop.lat}/${stop.lng}`,
  );
  appendExternalLink(
    linksRow,
    'Google Maps ↗',
    `https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`,
  );
  root.appendChild(linksRow);

  return root;
}

function buildRouteGeoJson(stops: RouteStop[], routePaths: LatLng[][], isFallbackLine: boolean) {
  const features: Array<{
    type: 'Feature';
    properties: { kind: 'road' | 'fallback' };
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  }> = [];

  if (stops.length >= 2) {
    if (!isFallbackLine && routePaths.length > 0) {
      for (const path of routePaths) {
        if (path.length < 2) continue;
        features.push({
          type: 'Feature',
          properties: { kind: 'road' },
          geometry: {
            type: 'LineString',
            coordinates: path.map((pt) => [pt.lng, pt.lat]),
          },
        });
      }
    } else {
      features.push({
        type: 'Feature',
        properties: { kind: 'fallback' },
        geometry: {
          type: 'LineString',
          coordinates: stops.map((s) => [s.lng, s.lat]),
        },
      });
    }
  }

  return {
    type: 'FeatureCollection' as const,
    features,
  };
}

function syncRouteLayersOnMap(
  map: MapLibreGL.Map,
  stops: RouteStop[],
  routePaths: LatLng[][],
  isFallbackLine: boolean,
) {
  if (!map.isStyleLoaded()) return;

  const data = buildRouteGeoJson(stops, routePaths, isFallbackLine);
  const existingSource = map.getSource(ROUTE_SOURCE_ID) as MapLibreGL.GeoJSONSource | undefined;
  if (existingSource) {
    existingSource.setData(data);
  } else {
    map.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      data,
    });
  }

  if (!map.getLayer(ROUTE_CASING_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_CASING_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'road'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.85 },
    });
  }

  if (!map.getLayer(ROUTE_ROAD_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_ROAD_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'road'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#2563eb', 'line-width': 4.5, 'line-opacity': 0.92 },
    });
  }

  if (!map.getLayer(ROUTE_FALLBACK_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_FALLBACK_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'fallback'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#64748b',
        'line-width': 3,
        'line-opacity': 0.85,
        'line-dasharray': [4, 4],
      },
    });
  }
}

export default function FreeRouteMap(p: {
  stops: RouteStop[];
  routePaths: LatLng[][];
  isFallbackLine: boolean;
  selectedStopId: string | null;
  onSelectStop: (id: string | null) => void;
  mapStyle: FreeMapStyle;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const maplibreRef = useRef<typeof MapLibreGL | null>(null);
  const mapRef = useRef<MapLibreGL.Map | null>(null);
  const activeStyleRef = useRef<FreeMapStyle>(p.mapStyle);
  const markerByIdRef = useRef<Map<string, { marker: MapLibreGL.Marker; el: HTMLDivElement; popup: MapLibreGL.Popup }>>(
    new Map(),
  );
  const onSelectStopRef = useRef(p.onSelectStop);
  onSelectStopRef.current = p.onSelectStop;

  const latestRouteRef = useRef({
    stops: p.stops,
    routePaths: p.routePaths,
    isFallbackLine: p.isFallbackLine,
  });
  latestRouteRef.current = {
    stops: p.stops,
    routePaths: p.routePaths,
    isFallbackLine: p.isFallbackLine,
  };

  const [ready, setReady] = useState(false);

  // Initialize MapLibre GL map client-side only
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const markerMap = markerByIdRef.current;
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    const initialStyle = activeStyleRef.current;

    import('maplibre-gl')
      .then((mod) => {
        if (disposed || !containerRef.current) return;
        const maplibregl = ((mod as unknown as { default?: typeof MapLibreGL }).default ?? mod) as typeof MapLibreGL;
        maplibreRef.current = maplibregl;

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: resolveMapStyleInput(initialStyle),
          center: DEFAULT_PH_CENTER,
          zoom: 13,
          attributionControl: { compact: true },
        });

        map.scrollZoom.disable();
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

        map.on('style.load', () => {
          const cur = latestRouteRef.current;
          syncRouteLayersOnMap(map, cur.stops, cur.routePaths, cur.isFallbackLine);
        });

        map.on('click', () => {
          onSelectStopRef.current(null);
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
        // Map initialization failed cleanly
      });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      for (const entry of markerMap.values()) {
        entry.popup.remove();
        entry.marker.remove();
      }
      markerMap.clear();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setReady(false);
    };
  }, []);

  // Swap vector / raster style when mapStyle changes after initial mount
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || activeStyleRef.current === p.mapStyle) return;
    activeStyleRef.current = p.mapStyle;
    map.setStyle(resolveMapStyleInput(p.mapStyle));
  }, [ready, p.mapStyle]);

  // Update route polylines whenever route data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    syncRouteLayersOnMap(map, p.stops, p.routePaths, p.isFallbackLine);
  }, [ready, p.stops, p.routePaths, p.isFallbackLine]);

  // Create/rebuild stop markers when stops change
  useEffect(() => {
    const maplibregl = maplibreRef.current;
    const map = mapRef.current;
    if (!ready || !maplibregl || !map) return;

    for (const entry of markerByIdRef.current.values()) {
      entry.popup.remove();
      entry.marker.remove();
    }
    markerByIdRef.current.clear();

    for (const stop of p.stops) {
      const pinEl = createPinElement(stop, false);
      pinEl.style.zIndex = String(stop.kind !== 'activity' ? 15 : 10 + stop.sequence);

      const popup = new maplibregl.Popup({
        offset: 18,
        maxWidth: '275px',
        closeOnClick: false,
      }).setDOMContent(buildStopPopupElement(stop));

      const marker = new maplibregl.Marker({ element: pinEl, anchor: 'center' })
        .setLngLat([stop.lng, stop.lat])
        .setPopup(popup)
        .addTo(map);

      pinEl.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onSelectStopRef.current(stop.id);
      });

      markerByIdRef.current.set(stop.id, { marker, el: pinEl, popup });
    }
  }, [ready, p.stops]);

  // Highlight active pin and toggle popup when selectedStopId changes
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;

    for (const stop of p.stops) {
      const entry = markerByIdRef.current.get(stop.id);
      if (!entry) continue;
      const isSelected = stop.id === p.selectedStopId;
      entry.el.className = isSelected ? 'bpwi-map-pin is-selected' : 'bpwi-map-pin';
      entry.el.style.zIndex = String(isSelected ? 50 : stop.kind !== 'activity' ? 15 : 10 + stop.sequence);
      if (!isSelected && entry.popup.isOpen()) {
        entry.popup.remove();
      }
    }

    if (!p.selectedStopId) return;

    const active = markerByIdRef.current.get(p.selectedStopId);
    if (active) {
      map.easeTo({ center: active.marker.getLngLat(), duration: 300 });
      if (!active.popup.isOpen()) {
        active.marker.togglePopup();
      }
    }
  }, [ready, p.stops, p.selectedStopId]);

  // Fit bounds when stop coordinates or route path geometry updates
  const boundsKey = useMemo(() => {
    const stopSig = p.stops.map((s) => `${s.id}:${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join('|');
    const pathPoints = p.routePaths.reduce((sum, path) => sum + path.length, 0);
    return `${stopSig}#${pathPoints}`;
  }, [p.stops, p.routePaths]);

  useEffect(() => {
    const maplibregl = maplibreRef.current;
    const map = mapRef.current;
    if (!ready || !maplibregl || !map || p.stops.length === 0) return;

    if (p.stops.length === 1) {
      map.jumpTo({ center: [p.stops[0].lng, p.stops[0].lat], zoom: 16 });
      return;
    }

    const bounds = new maplibregl.LngLatBounds();
    for (const stop of p.stops) {
      bounds.extend([stop.lng, stop.lat]);
    }
    for (const path of p.routePaths) {
      for (const pt of path) {
        bounds.extend([pt.lng, pt.lat]);
      }
    }
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 });
    }
  }, [ready, boundsKey, p.stops, p.routePaths]);

  return (
    <div
      ref={containerRef}
      className="bpwi-map-container"
      aria-label="Daily field activity route map"
      style={{ width: '100%', height: '100%' }}
    />
  );
}
