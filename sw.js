// Service Worker for Galil Elyon Vehicle Management PWA
// Minimal SW — just enables PWA "installable" status. Network-first for HTML
// (so users always get the latest version) and cache-fallback for icons.

const CACHE_VERSION = 'galil-v1';
const ASSETS = [
  './icon-192.png',
  './icon-512.png',
  './icon-180.png',
  './icon-152.png',
  './favicon.ico'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      return cache.addAll(ASSETS).catch(function(err) {
        console.log('[SW] Cache addAll failed:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) {
        return k !== CACHE_VERSION;
      }).map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  // Network-first for HTML (so users always see the newest version)
  if (event.request.mode === 'navigate' ||
      (event.request.method === 'GET' &&
       event.request.headers.get('accept') &&
       event.request.headers.get('accept').includes('text/html'))) {
    event.respondWith(
      fetch(event.request).catch(function() {
        return caches.match(event.request);
      })
    );
    return;
  }
  // Cache-first for static assets (icons)
  if (ASSETS.some(function(a) { return event.request.url.includes(a.replace('./', '')); })) {
    event.respondWith(
      caches.match(event.request).then(function(resp) {
        return resp || fetch(event.request);
      })
    );
  }
});
