// The service worker: network first, so a new deploy shows on the next open; the last copy when offline.
// The record (/api) is never cached here: pwa/bridge.js keeps its own copy in IndexedDB (B-404).
// B-404 (D-325): the files the app boots from are cached when it installs, so it opens with no connection even before
// every one has been fetched once; anything else the app loads (the job modules) is cached as it is fetched.
const CACHE = 'ev-page';
const BOOT = [
  './',
  'bridge.js',
  'app.js',
  'core.js',
  'spec.json',
  'styles.css',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'favicon.svg',
  'favicon-32.png',
];
self.addEventListener('install', e =>
  e.waitUntil(
    caches
      .open(CACHE)
      // each on its own: one missing file never keeps the others out, nor the worker from installing
      .then(c => Promise.all(BOOT.map(f => c.add(new Request(f, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  )
);
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return r;
      })
      .catch(async () => {
        const c = await caches.open(CACHE);
        const hit = (await c.match(e.request)) || (await c.match(e.request, { ignoreSearch: true }));
        if (hit) return hit;
        // an address the app opens at (/, /index.html, /#notes) is the page itself
        if (e.request.mode === 'navigate') return (await c.match('./')) || Response.error();
        return Response.error();
      })
  );
});
