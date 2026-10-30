// The service worker. The record (/api) is never cached here: pwa/bridge.js keeps its own copy in IndexedDB (B-404).
// B-404 (D-325): the files the app boots from are cached when it installs, so it opens with no connection even before
// every one has been fetched once; anything else the app loads (the job modules) is network first, cached as fetched.
// B-557: the boot files are stale-while-revalidate, as one set. The app opens at once from the set on this device, and
// each open fetches a fresh set behind it; the next open uses that set once every file of it has arrived. A page keeps
// the set it opened with, so its files always come from one release (the shell refuses a mixed set).
const CACHE = 'ev-page';
const SET = 'ev-shell-';
const META = 'ev-shell-meta';
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
const bootPath = url => {
  const rel = url.pathname.replace(/^\//, '');
  return rel === '' || rel === 'index.html' ? './' : BOOT.includes(rel) ? rel : null;
};
const current = async () => {
  const r = await (await caches.open(META)).match('current');
  return r ? r.text() : null;
};
const setCurrent = async name => (await caches.open(META)).put('current', new Response(name));
// One fresh set, whole or not at all; the current one is kept, and sets older than it are cleared.
let filling = null;
const refresh = () =>
  (filling ||= (async () => {
    const name = SET + Date.now();
    const got = await Promise.all(BOOT.map(f => fetch(new Request(f, { cache: 'no-cache' })).catch(() => null)));
    if (got.some(r => !r || !r.ok)) return null;
    const c = await caches.open(name);
    await Promise.all(BOOT.map((f, i) => c.put(f, got[i])));
    const was = await current();
    await setCurrent(name);
    for (const k of caches.keys ? await caches.keys() : [])
      if (k.startsWith(SET) && k !== name && k !== was) await caches.delete(k);
    return name;
  })().finally(() => (filling = null)));
const pages = new Map(); // client id -> the set its page opened with
self.addEventListener('install', e =>
  e.waitUntil(
    caches
      .open(CACHE)
      // each on its own: one missing file never keeps the others out, nor the worker from installing
      .then(c => Promise.all(BOOT.map(f => c.add(new Request(f, { cache: 'reload' })).catch(() => {}))))
      .then(() => refresh().catch(() => null))
      .then(() => self.skipWaiting())
  )
);
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
const networkFirst = req =>
  fetch(req)
    .then(r => {
      if (r.ok) {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return r;
    })
    .catch(async () => {
      const c = await caches.open(CACHE);
      const hit = (await c.match(req)) || (await c.match(req, { ignoreSearch: true }));
      if (hit) return hit;
      // an address the app opens at (/, /index.html, /#notes) is the page itself
      if (req.mode === 'navigate') return (await c.match('./')) || Response.error();
      return Response.error();
    });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const boot = e.request.mode === 'navigate' ? './' : bootPath(url);
  if (!boot || url.search) return e.respondWith(networkFirst(e.request));
  e.respondWith(
    (async () => {
      const nav = e.request.mode === 'navigate';
      const name = (!nav && pages.get(e.clientId)) || (await current());
      if (nav) {
        if (e.resultingClientId && name) pages.set(e.resultingClientId, name);
        if (e.waitUntil) e.waitUntil(refresh().catch(() => null));
        else refresh().catch(() => null);
      }
      const hit = name && (await (await caches.open(name)).match(boot));
      return hit || networkFirst(e.request);
    })()
  );
});
