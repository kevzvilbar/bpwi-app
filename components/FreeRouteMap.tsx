'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as LeafletNS from 'leaflet';
import { fmtTimeManila } from '@/lib/date';
import { formatGpsBadgeLabel } from '@/lib/gps-accuracy';
import { DEFAULT_LEAFLET_TILE_OPTIONS, resolveMapTileConfig } from '@/lib/map-tiles';
import type { LatLng, RouteStop } from '@/lib/route-footprints';

export type FreeMapStyle = 'street' | 'satellite';

const DEFAULT_PH_CENTER: [number, number] = [10.7202, 122.5621];

function createPinIcon(L: typeof LeafletNS, stop: RouteStop, isSelected: boolean): LeafletNS.DivIcon {
  const isBase = stop.kind !== 'activity';
  const label = isBase ? 'HQ' : String(stop.sequence);
  const bg = isBase ? '#0f172a' : stop.color;
  const cls = isSelected ? 'bpwi-map-pin is-selected' : 'bpwi-map-pin';

  const el = document.createElement('div');
  el.className = cls;
  el.style.backgroundColor = bg;
  el.textContent = label;

  return L.divIcon({
    className: 'bpwi-map-pin-icon',
    html: el,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
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

export default function FreeRouteMap(p: {
  stops: RouteStop[];
  routePaths: LatLng[][];
  isFallbackLine: boolean;
  selectedStopId: string | null;
  onSelectStop: (id: string | null) => void;
  mapStyle: FreeMapStyle;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<typeof LeafletNS | null>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const tileLayerRef = useRef<LeafletNS.TileLayer | null>(null);
  const routeLayerGroupRef = useRef<LeafletNS.LayerGroup | null>(null);
  const markerLayerGroupRef = useRef<LeafletNS.LayerGroup | null>(null);
  const markerByIdRef = useRef<Map<string, LeafletNS.Marker>>(new Map());
  const onSelectStopRef = useRef(p.onSelectStop);
  onSelectStopRef.current = p.onSelectStop;

  const [ready, setReady] = useState(false);

  // Initialize Leaflet map client-side only
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const markerMap = markerByIdRef.current;
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;

    import('leaflet')
      .then((mod) => {
        if (disposed || !containerRef.current) return;
        const L = ((mod as unknown as { default?: typeof LeafletNS }).default ?? mod) as typeof LeafletNS;
        leafletRef.current = L;

        const map = L.map(containerRef.current, {
          zoomControl: true,
          scrollWheelZoom: true,
          center: DEFAULT_PH_CENTER,
          zoom: 13,
        });

        routeLayerGroupRef.current = L.layerGroup().addTo(map);
        markerLayerGroupRef.current = L.layerGroup().addTo(map);

        map.on('click', () => {
          onSelectStopRef.current(null);
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
        // Map initialization failed cleanly
      });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      markerMap.clear();
      tileLayerRef.current = null;
      routeLayerGroupRef.current = null;
      markerLayerGroupRef.current = null;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setReady(false);
    };
  }, []);

  // Swap free tile layer when mapStyle changes
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }

    const tileConfig = resolveMapTileConfig(p.mapStyle);
    tileLayerRef.current = L.tileLayer(tileConfig.url, {
      attribution: tileConfig.attribution,
      maxNativeZoom: tileConfig.maxNativeZoom,
      maxZoom: tileConfig.maxZoom,
      ...DEFAULT_LEAFLET_TILE_OPTIONS,
    }).addTo(map);
  }, [ready, p.mapStyle]);

  // Draw road-snapped polyline or dashed straight-line fallback
  useEffect(() => {
    const L = leafletRef.current;
    const group = routeLayerGroupRef.current;
    if (!ready || !L || !group) return;

    group.clearLayers();

    if (p.stops.length < 2) return;

    if (!p.isFallbackLine && p.routePaths.length > 0) {
      for (const path of p.routePaths) {
        if (path.length < 2) continue;
        const latLngs: LeafletNS.LatLngExpression[] = path.map((pt) => [pt.lat, pt.lng]);
        L.polyline(latLngs, {
          color: '#ffffff',
          weight: 7,
          opacity: 0.8,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(group);
        L.polyline(latLngs, {
          color: '#2563eb',
          weight: 4.5,
          opacity: 0.92,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(group);
      }
      return;
    }

    const straightLatLngs: LeafletNS.LatLngExpression[] = p.stops.map((s) => [s.lat, s.lng]);
    L.polyline(straightLatLngs, {
      color: '#64748b',
      weight: 3,
      opacity: 0.85,
      dashArray: '8 8',
    }).addTo(group);
  }, [ready, p.stops, p.routePaths, p.isFallbackLine]);

  // Create/rebuild stop markers only when stops change
  useEffect(() => {
    const L = leafletRef.current;
    const group = markerLayerGroupRef.current;
    if (!ready || !L || !group) return;

    group.clearLayers();
    markerByIdRef.current.clear();

    for (const stop of p.stops) {
      const marker = L.marker([stop.lat, stop.lng], {
        icon: createPinIcon(L, stop, false),
        title: `#${stop.sequence} ${stop.label}`,
        zIndexOffset: stop.kind !== 'activity' ? 150 : 100 + stop.sequence,
      });

      marker.bindPopup(() => buildStopPopupElement(stop), { maxWidth: 265 });
      marker.on('click', () => {
        onSelectStopRef.current(stop.id);
      });

      marker.addTo(group);
      markerByIdRef.current.set(stop.id, marker);
    }
  }, [ready, p.stops]);

  // Update active pin highlight and open popup when selectedStopId changes
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;

    for (const stop of p.stops) {
      const marker = markerByIdRef.current.get(stop.id);
      if (!marker) continue;
      const isSelected = stop.id === p.selectedStopId;
      marker.setIcon(createPinIcon(L, stop, isSelected));
      marker.setZIndexOffset(isSelected ? 500 : stop.kind !== 'activity' ? 150 : 100 + stop.sequence);
    }

    if (!p.selectedStopId) {
      map.closePopup();
      return;
    }

    const activeMarker = markerByIdRef.current.get(p.selectedStopId);
    if (activeMarker) {
      map.panTo(activeMarker.getLatLng(), { animate: true });
      activeMarker.openPopup();
    }
  }, [ready, p.stops, p.selectedStopId]);

  // Fit bounds when stop coordinates or route path geometry updates
  const boundsKey = useMemo(() => {
    const stopSig = p.stops.map((s) => `${s.id}:${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join('|');
    const pathPoints = p.routePaths.reduce((sum, path) => sum + path.length, 0);
    return `${stopSig}#${pathPoints}`;
  }, [p.stops, p.routePaths]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map || p.stops.length === 0) return;

    if (p.stops.length === 1) {
      map.setView([p.stops[0].lat, p.stops[0].lng], 16, { animate: false });
      return;
    }

    const bounds = L.latLngBounds(p.stops.map((s) => [s.lat, s.lng] as [number, number]));
    for (const path of p.routePaths) {
      for (const pt of path) {
        bounds.extend([pt.lat, pt.lng]);
      }
    }
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [44, 44], maxZoom: 16, animate: false });
    }
  }, [ready, boundsKey, p.stops, p.routePaths]);

  return (
    <div
      ref={containerRef}
      className="bpwi-leaflet-container"
      aria-label="Daily field activity route map"
      style={{ width: '100%', height: '100%' }}
    />
  );
}
