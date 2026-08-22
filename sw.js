/* Wortschatz service worker — network-first for the page, cache-first for static assets.
   Network-first means new words/features appear as soon as you're online; the cache is the
   offline fallback. Bump VERSION whenever you change files so installed apps refresh cleanly. */
const VERSION = 'wortschatz-v15';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './words.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  try { if (new URL(req.url).pathname.indexOf('/api/') === 0) return; } catch (_) {}
  const accept = req.headers.get('accept') || '';
  const isPage = req.mode === 'navigate' || accept.includes('text/html');

  if (isPage) {
    // Network-first: always try for the freshest page; fall back to cache when offline.
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put('./index.html', copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Cache-first for static assets (icons, manifest, future data files).
  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      try {
        if (new URL(req.url).origin === self.location.origin) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
      } catch (_) {}
      return res;
    }).catch(() => undefined))
  );
});
