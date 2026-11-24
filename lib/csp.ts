export function generateCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function extractOrigin(rawUrl?: string): string | null {
  const trimmed = (rawUrl ?? '').trim();
  if (!trimmed) return null;
  try {
    const normalized = trimmed.replace(/\{[^}]+\}/g, '0');
    const url = new URL(normalized);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function buildCspHeader(opts: {
  nonce: string;
  isDev?: boolean;
  supabaseUrl?: string;
  streetTileUrl?: string;
  satelliteTileUrl?: string;
}): string {
  const supabaseOrigin = extractOrigin(opts.supabaseUrl);
  const connectSources = new Set<string>(["'self'"]);
  if (supabaseOrigin) {
    connectSources.add(supabaseOrigin);
    connectSources.add(supabaseOrigin.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:'));
  }

  const imgSources = new Set<string>(["'self'", 'data:', 'blob:']);
  if (supabaseOrigin) {
    imgSources.add(supabaseOrigin);
  }

  const customStreetOrigin = extractOrigin(opts.streetTileUrl);
  if (customStreetOrigin) {
    imgSources.add(customStreetOrigin);
  } else {
    imgSources.add('https://tile.openstreetmap.org');
    imgSources.add('https://*.tile.openstreetmap.org');
  }

  const customSatOrigin = extractOrigin(opts.satelliteTileUrl);
  if (customSatOrigin) {
    imgSources.add(customSatOrigin);
  } else {
    imgSources.add('https://server.arcgisonline.com');
  }

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${opts.nonce}' 'strict-dynamic'${opts.isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${[...imgSources].join(' ')}`,
    "font-src 'self' data:",
    `connect-src ${[...connectSources].join(' ')}`,
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
