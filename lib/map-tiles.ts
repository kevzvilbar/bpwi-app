/**
 * Configurable Leaflet map tile configuration helper.
 * Supports self-hosted or commercial tile providers via `NEXT_PUBLIC_MAP_*` environment variables,
 * falling back to OpenStreetMap / Esri public tiles when unset.
 */

export type MapStyle = 'street' | 'satellite';

export interface MapTileLayerConfig {
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

const DEFAULT_STREET_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_STREET_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

const DEFAULT_SATELLITE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const DEFAULT_SATELLITE_ATTRIBUTION = 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics';

/** Leaflet tile options that trim background tile buffering / redundant requests. */
export const DEFAULT_LEAFLET_TILE_OPTIONS = {
  keepBuffer: 1,
  updateWhenIdle: true,
} as const;

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

/** Resolves Leaflet tile URL and attribution metadata for street or satellite view. */
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
        url: satUrl!.trim(),
        attribution: satAttr?.trim() || 'Satellite imagery provider',
        maxNativeZoom: 18,
        maxZoom: 20,
        isPublicDefault: false,
        providerLabel: 'Custom Satellite Tiles',
      };
    }
    return {
      url: DEFAULT_SATELLITE_URL,
      attribution: DEFAULT_SATELLITE_ATTRIBUTION,
      maxNativeZoom: 18,
      maxZoom: 20,
      isPublicDefault: true,
      providerLabel: 'Esri World Imagery',
    };
  }

  if (isValidTileUrlTemplate(streetUrl)) {
    return {
      url: streetUrl!.trim(),
      attribution: streetAttr?.trim() || '&copy; OpenStreetMap contributors',
      maxNativeZoom: 19,
      maxZoom: 20,
      isPublicDefault: false,
      providerLabel: 'Custom Map Tiles',
    };
  }

  return {
    url: DEFAULT_STREET_URL,
    attribution: DEFAULT_STREET_ATTRIBUTION,
    maxNativeZoom: 19,
    maxZoom: 20,
    isPublicDefault: true,
    providerLabel: 'OpenStreetMap',
  };
}

/**
 * Returns an admin-facing configuration notice when the active map style uses
 * a public default tile server rather than a commercial or self-hosted provider.
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
