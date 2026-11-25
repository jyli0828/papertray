'use strict';
/* Offline support. 紙匣's own files are fetched from the network first, so a new version shows up on the next visit,
   and kept in the cache for when there is no network. Libraries (lib/) never change under the same name, so they
   come from the cache once they have been used. Only same-origin GET requests are handled; Google Fonts and the
   rest go to the network as usual (offline, system fonts are used instead). */
const CACHE = 'papertray-v1';
/* Kept from the first visit: the page and every file it links to (its scripts, styles and icons, read from
   index.html so a new js/ file needs no entry here), then the libraries nearly every tool needs (about 0.6 MB as
   sent). OCR, qpdf and HEIC (about 11 MB together) are cached the first time they are used, so a phone is not made
   to fetch them up front.
   The page's own files were fetched just before this runs: they are checked with the server ('no-cache'), not
   fetched again, so the copies kept are the server's current ones without a second download. The libraries come
   after this worker is in charge, one at a time, pdf.js first (see cacheLibs()): fetched during installing, they
   competed with the page fetching the same files for the user's first PDF, and on a slow phone network that first
   PDF took 5–7 s to open instead of under 3. */
const PAGE = ['./', 'index.html'];
const LIBS = ['lib/pdf.min.js', 'lib/pdf.worker.min.js', 'lib/pdf-lib.min.js'];
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const html = await (await fetch('index.html', { cache: 'no-cache' })).text();
    const own = [...html.matchAll(/(?:src|href)="(?![a-z]+:|#|\/\/)([^"]+)"/gi)].map(m => m[1]);
    const c = await caches.open(CACHE);
    await c.addAll([...new Set([...PAGE, ...own])].map(u => new Request(u, { cache: 'no-cache' })));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
/* A library from the cache, or downloaded once and kept: the page asking for a file the offline copy is fetching
   meanwhile shares that download. Each caller gets its own copy of the response. */
const loading = new Map();
function libFile(url) {
  url = new URL(url, self.location).href;
  if (!loading.has(url)) {
    loading.set(url, caches.match(url).then(hit => hit || fetch(url).then(async res => {
      if (res.ok) { try { await (await caches.open(CACHE)).put(url, res.clone()); } catch (err) {} }
      return res;
    })).finally(() => loading.delete(url)));
  }
  return loading.get(url).then(res => res.clone());
}
async function cacheLibs() { for (const u of LIBS) { try { await libFile(u); } catch (err) {} } }
// The page asks for this once this worker is in charge (js/app.js).
self.addEventListener('message', e => { if (e.data === 'cache-libs') e.waitUntil(cacheLibs()); });
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/lib/')) { e.respondWith(libFile(url.href)); return; }
  const keep = res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; };
  e.respondWith(fetch(req).then(keep).catch(() => caches.match(req, { ignoreSearch: true })
    .then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
