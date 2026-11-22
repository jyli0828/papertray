'use strict';
/* Offline support. 紙匣's own files are fetched from the network first, so a new version shows up on the next visit,
   and kept in the cache for when there is no network. Libraries (lib/) never change under the same name, so they
   come from the cache once they have been used. Only same-origin GET requests are handled; Google Fonts and the
   rest go to the network as usual (offline, system fonts are used instead). */
const CACHE = 'papertray-v1';
/* Kept from the first visit: the page, every file it links to (its scripts, styles and icons, read from index.html so
   a new js/ file needs no entry here) and the libraries nearly every tool needs (about 3 MB). The page's own files
   are fetched on the first visit before this worker is in charge, so they must be stored here or the app would not
   open offline. OCR, qpdf and HEIC (about 11 MB together) are cached the first time they are used, so a phone is not
   made to fetch them up front. */
const PRECACHE = ['./', 'index.html', 'lib/pdf-lib.min.js', 'lib/pdf.min.js', 'lib/pdf.worker.min.js', 'lib/jszip.min.js'];
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const html = await (await fetch('index.html', { cache: 'no-cache' })).text();
    const own = [...html.matchAll(/(?:src|href)="(?![a-z]+:|#|\/\/)([^"]+)"/gi)].map(m => m[1]);
    const c = await caches.open(CACHE);
    // 'reload' skips the browser's HTTP cache, so the copies kept match what is on the server now.
    await c.addAll([...new Set([...PRECACHE, ...own])].map(u => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const keep = res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; };
  if (url.pathname.includes('/lib/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(keep)));
    return;
  }
  e.respondWith(fetch(req).then(keep).catch(() => caches.match(req, { ignoreSearch: true })
    .then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
