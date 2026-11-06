// Keeps the app opening with no signal, and sends queued photos in the background (Background Sync).
// API calls are never cached.
importScripts('/queue-core.js');
const CACHE = 'wrs-v8';
const SHELL = ['/', '/style.css', '/app.js', '/queue-core.js', '/exif.js', '/manifest.webmanifest', '/icon-192.png', '/logo.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network first: when there is signal the newest app is always loaded (so a change is never hidden behind an old copy),
// and the saved copy is used only when there is no signal or the network is very slow.
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/') || u.origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    try {
      const r = await fetch(e.request, { cache: 'no-cache', signal: AbortSignal.timeout(5000) });
      if (r.ok) c.put(e.request, r.clone());
      return r;
    } catch {
      return (await c.match(e.request)) || (await c.match('/')) || Response.error();
    }
  }));
});

// Android Chrome wakes this when signal returns, even if the app is closed. If something is still left
// (server trouble, no signal), failing here makes the browser try again later with backoff.
self.addEventListener('sync', (e) => {
  if (e.tag !== 'wrs-send') return;
  e.waitUntil(self.WRSQueue.flush().then((r) => { if (r.left && r.stopped !== 'auth') throw new Error('items still waiting'); }));
});
