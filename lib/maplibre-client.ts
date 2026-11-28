'use client';

import type * as MapLibreGL from 'maplibre-gl';

export const MAPLIBRE_WORKER_PATH = '/maplibre-gl-worker.mjs';

let cachedPromise: Promise<typeof MapLibreGL> | null = null;

/**
 * Dynamically loads MapLibre GL JS and pins its Web Worker URL to the static asset under `public/`.
 * MapLibre v6 resolves `./maplibre-gl-worker.mjs` relative to `import.meta.url`, which 404s under
 * Next.js hashed chunk URLs unless explicitly overridden.
 */
export function loadMapLibre(): Promise<typeof MapLibreGL> {
  if (!cachedPromise) {
    cachedPromise = import('maplibre-gl')
      .then((mod) => {
        const maplibregl = ((mod as unknown as { default?: typeof MapLibreGL }).default ?? mod) as typeof MapLibreGL;
        if (typeof maplibregl.setWorkerUrl === 'function') {
          const version = typeof maplibregl.getVersion === 'function' ? maplibregl.getVersion() : '';
          const workerUrl = version
            ? `${MAPLIBRE_WORKER_PATH}?v=${encodeURIComponent(version)}`
            : MAPLIBRE_WORKER_PATH;
          maplibregl.setWorkerUrl(workerUrl);
        }
        return maplibregl;
      })
      .catch((err) => {
        cachedPromise = null;
        throw err;
      });
  }
  return cachedPromise;
}
