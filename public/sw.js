const CACHE_NAME = 'bpwi-ops-v5';
const PRECACHE = ['/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];
// Strict allow-list: only cache HTML for the offline field-logger view, never phone lists, user roles, or admin reports.
const OFFLINE_PAGE_ALLOWLIST = new Set(['/mobile']);

const OFFLINE_FALLBACK_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>BPWI Ops — You are offline</title>
  <style>
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;color:#0f172a}
    main{max-width:360px;width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(15,23,42,.08);text-align:center}
    h1{margin:0 0 8px;font-size:1.25rem;line-height:1.3}
    p{margin:0 0 20px;font-size:.9375rem;line-height:1.5;color:#475569}
    .actions{display:flex;flex-direction:column;gap:10px}
    a,button{display:inline-flex;align-items:center;justify-content:center;height:44px;padding:0 16px;border-radius:10px;font-size:.9375rem;font-weight:600;text-decoration:none;cursor:pointer;border:none}
    .primary{background:#0284c7;color:#fff}
    .secondary{background:#e2e8f0;color:#0f172a}
  </style>
</head>
<body>
  <main>
    <h1>BPWI Ops — You are offline</h1>
    <p>No internet connection detected. Open the offline field logger or try reconnecting.</p>
    <div class="actions">
      <a class="primary" href="/mobile">Open Field Logger</a>
      <button class="secondary" type="button" onclick="window.location.reload()">Try again</button>
    </div>
  </main>
</body>
</html>`;

function offlineFallbackResponse() {
  return new Response(OFFLINE_FALLBACK_HTML, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Cache-first for static Next.js build assets and app icons
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icon-')) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Network-only for PWA start_url ('/'): never cache '/' HTML, but serve an offline launch fallback
  if (req.mode === 'navigate' && url.pathname === '/') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/mobile').then((cached) => cached || offlineFallbackResponse())),
    );
    return;
  }

  // Network-first strictly for allow-listed offline-capable pages; sensitive routes never persist in SW cache
  if (
    OFFLINE_PAGE_ALLOWLIST.has(url.pathname) &&
    (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html'))
  ) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .match(req)
            .then((cached) => cached || caches.match('/mobile'))
            .then((cached) => cached || offlineFallbackResponse()),
        ),
    );
  }
});
