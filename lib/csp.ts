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
    const subdomainSentinel = 'sub-wildcard-token';
    const prepared = trimmed
      .replace(/\{s\}/g, subdomainSentinel)
      .replace(/\{[^}]+\}/g, '0');
    const url = new URL(prepared);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }
    const host = url.host.replaceAll(subdomainSentinel, '*');
    return `${url.protocol}//${host}`;
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
  reportUri?: string;
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

  const streetOrigin = extractOrigin(opts.streetTileUrl) ?? 'https://tiles.openfreemap.org';
  imgSources.add(streetOrigin);
  connectSources.add(streetOrigin);

  const customSatOrigin = extractOrigin(opts.satelliteTileUrl);
  if (customSatOrigin) {
    imgSources.add(customSatOrigin);
    connectSources.add(customSatOrigin);
  }

  const reportUri = opts.reportUri === undefined ? '/api/csp-report' : opts.reportUri.trim();

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${opts.nonce}' 'strict-dynamic'${opts.isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${[...imgSources].join(' ')}`,
    "font-src 'self' data:",
    `connect-src ${[...connectSources].join(' ')}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(reportUri ? [`report-uri ${reportUri}`] : []),
  ].join('; ');
}
