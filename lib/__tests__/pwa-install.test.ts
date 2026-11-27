import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import manifest from '../../app/manifest.ts';
import { detectInstallPlatform, shouldShowInstallBanner } from '../pwa-install.ts';

interface FakeFetchEvent {
  request: {
    method: string;
    url: string;
    mode: string;
    headers: { get(name: string): string | null };
  };
  respondWith(responsePromise: Promise<Response>): void;
}

function loadServiceWorker(opts: {
  cachedEntries?: Record<string, Response>;
  fetchImpl: (req: FakeFetchEvent['request']) => Promise<Response>;
}) {
  const swPath = resolve(process.cwd(), 'public/sw.js');
  const source = readFileSync(swPath, 'utf8');
  const listeners = new Map<string, (event: FakeFetchEvent) => void>();
  const storedKeys: string[] = [];
  const cacheMap = new Map<string, Response>(Object.entries(opts.cachedEntries ?? {}));

  const sandbox = {
    URL,
    Response,
    Promise,
    Set,
    fetch: opts.fetchImpl,
    caches: {
      async match(key: string | FakeFetchEvent['request']) {
        const lookup = typeof key === 'string' ? key : new URL(key.url).pathname;
        return cacheMap.get(lookup);
      },
      async open() {
        return {
          async put(req: FakeFetchEvent['request'], res: Response) {
            const path = new URL(req.url).pathname;
            storedKeys.push(path);
            cacheMap.set(path, res);
          },
          async addAll() {},
        };
      },
      async keys() {
        return [];
      },
      async delete() {
        return true;
      },
    },
    self: {
      location: { origin: 'https://ops.bpwi.local' },
      addEventListener(type: string, handler: (event: FakeFetchEvent) => void) {
        listeners.set(type, handler);
      },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
  };

  vm.runInNewContext(source, sandbox);
  const fetchHandler = listeners.get('fetch');
  assert.ok(fetchHandler, 'sw.js must register a fetch event listener');
  return { source, fetchHandler, storedKeys };
}

function makeNavRequest(pathname: string): FakeFetchEvent['request'] {
  return {
    method: 'GET',
    url: `https://ops.bpwi.local${pathname}`,
    mode: 'navigate',
    headers: { get: (name: string) => (name.toLowerCase() === 'accept' ? 'text/html' : null) },
  };
}

function dispatchFetch(
  fetchHandler: (event: FakeFetchEvent) => void,
  request: FakeFetchEvent['request'],
): Promise<Response> | null {
  let responsePromise: Promise<Response> | null = null;
  fetchHandler({
    request,
    respondWith(p) {
      responsePromise = p;
    },
  });
  return responsePromise;
}

describe('PWA installability & manifest', () => {
  it('provides full standalone manifest metadata with any and maskable icons', () => {
    const m = manifest();
    assert.equal(m.display, 'standalone');
    assert.equal(m.start_url, '/');
    assert.equal(m.scope, '/');
    const icons = m.icons ?? [];
    assert.ok(icons.some((i) => i.sizes === '192x192' && i.purpose === 'any'));
    assert.ok(icons.some((i) => i.sizes === '512x512' && i.purpose === 'any'));
    assert.ok(icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
    assert.ok((m.shortcuts ?? []).length >= 2);
  });

  it('detects mobile and standalone install platforms accurately', () => {
    assert.equal(detectInstallPlatform('Mozilla/5.0 (Linux; Android 14)', true), 'installed');
    assert.equal(detectInstallPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', false), 'ios');
    assert.equal(detectInstallPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)', false), 'android');
    assert.equal(detectInstallPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', false), 'desktop');
  });

  it('respects standalone state, 7-day dismissal window, and prompt availability', () => {
    const now = Date.UTC(2026, 10, 25, 0, 0, 0);
    assert.equal(
      shouldShowInstallBanner({ isStandalone: true, dismissedUntilMs: null, nowMs: now, hasDeferredPrompt: true, platform: 'android' }),
      false,
    );
    assert.equal(
      shouldShowInstallBanner({ isStandalone: false, dismissedUntilMs: now + 60_000, nowMs: now, hasDeferredPrompt: true, platform: 'android' }),
      false,
    );
    assert.equal(
      shouldShowInstallBanner({ isStandalone: false, dismissedUntilMs: now - 1, nowMs: now, hasDeferredPrompt: true, platform: 'android' }),
      true,
    );
    assert.equal(
      shouldShowInstallBanner({ isStandalone: false, dismissedUntilMs: null, nowMs: now, hasDeferredPrompt: false, platform: 'ios' }),
      true,
    );
    assert.equal(
      shouldShowInstallBanner({ isStandalone: false, dismissedUntilMs: null, nowMs: now, hasDeferredPrompt: false, platform: 'desktop' }),
      false,
    );
  });

  it('keeps sw.js OFFLINE_PAGE_ALLOWLIST restricted to /field while providing offline navigation fallback for /', async () => {
    const swPath = resolve(process.cwd(), 'public/sw.js');
    const source = readFileSync(swPath, 'utf8');
    assert.match(source, /CACHE_NAME\s*=\s*'bpwi-ops-v10'/);
    assert.match(source, /OFFLINE_PAGE_ALLOWLIST\s*=\s*new Set\(\['\/field'\]\)/);

    // 1. Online navigation to '/' goes network-only and NEVER stores '/' in cache
    const onlineSw = loadServiceWorker({
      fetchImpl: async () => new Response('<html>roster</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    });
    const onlinePromise = dispatchFetch(onlineSw.fetchHandler, makeNavRequest('/'));
    assert.ok(onlinePromise, 'fetch handler should respond to / navigation');
    const onlineRes = await onlinePromise;
    assert.equal(await onlineRes.text(), '<html>roster</html>');
    assert.deepEqual(onlineSw.storedKeys, []);

    // 2. Sensitive routes like /call-sheet and /mobile are not intercepted or cached
    const callSheetPromise = dispatchFetch(onlineSw.fetchHandler, makeNavRequest('/call-sheet'));
    assert.equal(callSheetPromise, null);
    const mobilePromise = dispatchFetch(onlineSw.fetchHandler, makeNavRequest('/mobile'));
    assert.equal(mobilePromise, null);

    // 3. Offline launch on '/' serves cached /field when available
    const cachedFieldSw = loadServiceWorker({
      cachedEntries: {
        '/field': new Response('<html>cached field shell</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      },
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const cachedFallbackPromise = dispatchFetch(cachedFieldSw.fetchHandler, makeNavRequest('/'));
    assert.ok(cachedFallbackPromise);
    const cachedFallbackRes = await cachedFallbackPromise;
    assert.equal(cachedFallbackRes.status, 200);
    assert.equal(await cachedFallbackRes.text(), '<html>cached field shell</html>');

    // 4. Offline launch on '/' without cached /field or /mobile returns self-contained 200 text/html fallback
    const uncachedSw = loadServiceWorker({
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const htmlFallbackPromise = dispatchFetch(uncachedSw.fetchHandler, makeNavRequest('/'));
    assert.ok(htmlFallbackPromise);
    const htmlFallbackRes = await htmlFallbackPromise;
    assert.equal(htmlFallbackRes.status, 200);
    assert.match(htmlFallbackRes.headers.get('content-type') ?? '', /^text\/html/);
    const fallbackHtml = await htmlFallbackRes.text();
    assert.match(fallbackHtml, /BPWI Ops — You are offline/);
    assert.match(fallbackHtml, /href="\/field"/);
    assert.match(fallbackHtml, /Try again/);
    assert.match(fallbackHtml, /reload\(\)/);
  });
});

describe('offline field logger warm-up', () => {
  const html = '<html><script src="/_next/static/chunks/app.js"></script><link href="/_next/static/css/a.css"/>'
    + '<script>self.__next_f.push([1,"[\\"/_next/static/chunks/page.js\\"]"])</script></html>';

  function load(pageResponse: { ok: boolean; redirected: boolean }, onAsset?: (post: (data: string) => void) => void) {
    const listeners = new Map<string, (event: { data: string; waitUntil(p: Promise<unknown>): void }) => void>();
    const stored: string[] = [];
    let pending: Promise<unknown> = Promise.resolve();
    const post = (data: string) => {
      listeners.get('message')!({ data, waitUntil: (p) => { if (data === 'CACHE_OFFLINE_PAGE') pending = p; } });
    };
    const response = (flags: { ok: boolean; redirected: boolean }) => ({ ...flags, clone: () => ({ text: async () => html }) });
    vm.runInNewContext(readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8'), {
      URL,
      Response,
      Promise,
      Set,
      fetch: async (url: string) => {
        if (url === '/field') return response(pageResponse);
        onAsset?.(post);
        return response({ ok: true, redirected: false });
      },
      caches: {
        open: async () => ({ match: async () => undefined, put: async (key: string) => { stored.push(key); } }),
        keys: async () => [],
        delete: async () => true,
      },
      self: { location: { origin: 'https://ops.bpwi.local' }, addEventListener: (t: string, h: never) => listeners.set(t, h) },
    });
    return { stored, run: async () => { post('CACHE_OFFLINE_PAGE'); await pending; } };
  }

  it('stores the referenced build assets first and /field last', async () => {
    const sw = load({ ok: true, redirected: false });
    await sw.run();
    assert.deepEqual(
      sw.stored.slice(0, -1).sort(),
      ['/_next/static/chunks/app.js', '/_next/static/chunks/page.js', '/_next/static/css/a.css'],
    );
    assert.equal(sw.stored.at(-1), '/field');
  });

  it('stores nothing when signed out (redirect)', async () => {
    const sw = load({ ok: true, redirected: true });
    await sw.run();
    assert.deepEqual(sw.stored, []);
  });

  it('does not re-cache the page if the cache is cleared while downloading', async () => {
    const sw = load({ ok: true, redirected: false }, (post) => post('CLEAR_CACHE'));
    await sw.run();
    assert.deepEqual(sw.stored, []);
  });
});
