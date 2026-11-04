// Keeps the app opening with no signal, and sends queued photos in the background (Background Sync).
// API calls are never cached.
importScripts('/queue-core.js');
const CACHE = 'wrs-v6';
const SHELL = ['/', '/style.css', '/app.js', '/queue-core.js', '/exif.js', '/manifest.webmanifest', '/icon-192.png', '/logo.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/')) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(e.request);
    const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});

// Android Chrome wakes this when signal returns, even if the app is closed. If something is still left
// (server trouble, no signal), failing here makes the browser try again later with backoff.
self.addEventListener('sync', (e) => {
  if (e.tag !== 'wrs-send') return;
  e.waitUntil(self.WRSQueue.flush().then((r) => { if (r.left && r.stopped !== 'auth') throw new Error('items still waiting'); }));
});
