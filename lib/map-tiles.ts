/**
 * Configurable MapLibre map source & style configuration helper.
 * Uses free, unlimited OpenFreeMap vector tiles across all default map views
 * (`liberty`, `positron`, `bright`), with optional `NEXT_PUBLIC_MAP_*` XYZ raster tile overrides.
 */

export type MapStyle = 'street' | 'clean' | 'satellite';
export type MapTileSourceKind = 'vector-style' | 'raster-xyz';

export interface MapTileLayerConfig {
  kind: MapTileSourceKind;
  url: string;
  attribution: string;
  maxNativeZoom: number;
  maxZoom: number;
  isPublicDefault: boolean;
  providerLabel: string;
}

export interface MapTileEnvOverrides {
  streetUrl?: string;
  streetAttribution?: string;
  satelliteUrl?: string;
  satelliteAttribution?: string;
}

export interface RasterMapStyleSpecification {
  version: 8;
  sources: {
    'bpwi-raster': {
      type: 'raster';
      tiles: string[];
      tileSize: number;
      maxzoom: number;
      attribution: string;
    };
  };
  layers: Array<{
    id: string;
    type: 'raster';
    source: 'bpwi-raster';
    minzoom: number;
    maxzoom: number;
  }>;
}

export const DEFAULT_OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const DEFAULT_OPENFREEMAP_CLEAN_URL = 'https://tiles.openfreemap.org/styles/positron';
export const DEFAULT_OPENFREEMAP_BRIGHT_URL = 'https://tiles.openfreemap.org/styles/bright';

const DEFAULT_OPENFREEMAP_ATTRIBUTION =
  '&copy; <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

/** Validates that a custom tile URL template uses an allowed scheme/path and `{z}/{x}/{y}` placeholders. */
export function isValidTileUrlTemplate(url: string | undefined): boolean {
  const trimmed = url?.trim();
  if (!trimmed) return false;
  const allowedOrigin =
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://localhost') ||
    trimmed.startsWith('http://127.0.0.1') ||
    trimmed.startsWith('/');
  if (!allowedOrigin) return false;
  return trimmed.includes('{z}') && trimmed.includes('{x}') && trimmed.includes('{y}');
}

/** Returns true when a custom satellite XYZ tile URL has been explicitly configured. */
export function hasCustomSatelliteTiles(env?: MapTileEnvOverrides): boolean {
  const satUrl =
    env !== undefined ? env.satelliteUrl : process.env.NEXT_PUBLIC_MAP_SATELLITE_TILE_URL;
  return isValidTileUrlTemplate(satUrl);
}

/** Returns UI style selector items: free OpenFreeMap presets plus custom Satellite if configured. */
export function getMapStyleOptions(
  env?: MapTileEnvOverrides,
): Array<{ id: MapStyle; label: string }> {
  const items: Array<{ id: MapStyle; label: string }> = [
    { id: 'street', label: 'Street' },
    { id: 'clean', label: 'Clean' },
  ];
  if (hasCustomSatelliteTiles(env)) {
    items.push({ id: 'satellite', label: 'Satellite' });
  }
  return items;
}

/** Builds a MapLibre v8 raster style JSON object for custom XYZ tile layers. */
export function buildRasterMapStyle(config: MapTileLayerConfig): RasterMapStyleSpecification {
  return {
    version: 8,
    sources: {
      'bpwi-raster': {
        type: 'raster',
        tiles: [config.url],
        tileSize: 256,
        maxzoom: config.maxNativeZoom,
        attribution: config.attribution,
      },
    },
    layers: [
      {
        id: 'bpwi-raster-layer',
        type: 'raster',
        source: 'bpwi-raster',
        minzoom: 0,
        maxzoom: config.maxZoom,
      },
    ],
  };
}

/** Resolves MapLibre style URL or XYZ tile configuration for street, clean, or satellite view. */
export function resolveMapTileConfig(
  style: MapStyle,
  env?: MapTileEnvOverrides,
): MapTileLayerConfig {
  const streetUrl = env !== undefined ? env.streetUrl : process.env.NEXT_PUBLIC_MAP_STREET_TILE_URL;
  const streetAttr =
    env !== undefined ? env.streetAttribution : process.env.NEXT_PUBLIC_MAP_STREET_ATTRIBUTION;
  const satUrl =
    env !== undefined ? env.satelliteUrl : process.env.NEXT_PUBLIC_MAP_SATELLITE_TILE_URL;
  const satAttr =
    env !== undefined ? env.satelliteAttribution : process.env.NEXT_PUBLIC_MAP_SATELLITE_ATTRIBUTION;

  if (style === 'satellite') {
    if (isValidTileUrlTemplate(satUrl)) {
      return {
        kind: 'raster-xyz',
        url: satUrl!.trim(),
        attribution: satAttr?.trim() || 'Satellite imagery provider',
        maxNativeZoom: 18,
        maxZoom: 20,
        isPublicDefault: false,
        providerLabel: 'Custom Satellite Tiles',
      };
    }
    return {
      kind: 'vector-style',
      url: DEFAULT_OPENFREEMAP_BRIGHT_URL,
      attribution: DEFAULT_OPENFREEMAP_ATTRIBUTION,
      maxNativeZoom: 19,
      maxZoom: 20,
      isPublicDefault: false,
      providerLabel: 'OpenFreeMap (Bright)',
    };
  }

  if (style === 'clean') {
    return {
      kind: 'vector-style',
      url: DEFAULT_OPENFREEMAP_CLEAN_URL,
      attribution: DEFAULT_OPENFREEMAP_ATTRIBUTION,
      maxNativeZoom: 19,
      maxZoom: 20,
      isPublicDefault: false,
      providerLabel: 'OpenFreeMap (Positron)',
    };
  }

  if (isValidTileUrlTemplate(streetUrl)) {
    return {
      kind: 'raster-xyz',
      url: streetUrl!.trim(),
      attribution: streetAttr?.trim() || '&copy; OpenStreetMap contributors',
      maxNativeZoom: 19,
      maxZoom: 20,
      isPublicDefault: false,
      providerLabel: 'Custom Map Tiles',
    };
  }

  return {
    kind: 'vector-style',
    url: DEFAULT_OPENFREEMAP_STYLE_URL,
    attribution: DEFAULT_OPENFREEMAP_ATTRIBUTION,
    maxNativeZoom: 19,
    maxZoom: 20,
    isPublicDefault: false,
    providerLabel: 'OpenFreeMap (Liberty)',
  };
}

/**
 * Returns an admin-facing configuration notice when a rate-limited public default tile provider
 * is active (returns null for all free OpenFreeMap presets and custom providers).
 */
export function getPublicTileAdminNotice(
  style: MapStyle,
  config: MapTileLayerConfig,
): string | null {
  if (!config.isPublicDefault) return null;
  const envKey =
    style === 'satellite'
      ? 'NEXT_PUBLIC_MAP_SATELLITE_TILE_URL'
      : 'NEXT_PUBLIC_MAP_STREET_TILE_URL';
  return `Using public ${config.providerLabel} tiles (heavy daily usage may be rate-limited or blocked under provider terms). Set ${envKey} to a commercial or self-hosted XYZ tile provider.`;
}
