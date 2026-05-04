// Service Worker — Galil Elyon Vehicle Management
// v3.0 — aggressive auto-update strategy
//
// Strategy:
// - HTML: ALWAYS go to network. Never cache. This guarantees latest version.
// - Icons: Cache-first (they don't change often).
// - Force activation on install (skip waiting period).
// - Auto-update check: SW checks for updates every time the page loads.

const CACHE_VERSION = 'galil-v3';
const ASSETS = [
  './icon-192.png',
  './icon-512.png',
  './icon-180.png',
  './icon-152.png',
  './favicon.ico'
];

// Install: cache static icons, skip waiting (activate immediately)
self.addEventListener('install', function(event) {
  console.log('[SW] Installing v3...');
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      return cache.addAll(ASSETS).catch(function(err) {
        console.log('[SW] Cache addAll failed:', err);
      });
    })
  );
  // Activate immediately, don't wait for old SW to finish
  self.skipWaiting();
});

// Activate: delete old caches, take control of all open pages
self.addEventListener('activate', function(event) {
  console.log('[SW] Activating v3...');
  event.waitUntil(
    Promise.all([
      // Delete all old caches
      caches.keys().then(function(keys) {
        return Promise.all(keys.filter(function(k) {
          return k !== CACHE_VERSION;
        }).map(function(k) {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        }));
      }),
      // Take control of all open clients (tabs/windows) immediately
      self.clients.claim()
    ])
  );
});

// Fetch: HTML always from network, icons from cache
self.addEventListener('fetch', function(event) {
  var url = event.request.url;
  var isHTML = (event.request.mode === 'navigate' ||
                (event.request.method === 'GET' &&
                 event.request.headers.get('accept') &&
                 event.request.headers.get('accept').includes('text/html')));

  // ═══ HTML FILES: ALWAYS NETWORK, never cache ═══
  // This guarantees users always get the latest version of the app
  if (isHTML) {
    event.respondWith(
      // bypass HTTP cache too, force fresh fetch from server
      fetch(event.request, { cache: 'no-store' })
        .then(function(resp) {
          // Don't cache HTML at all
          return resp;
        })
        .catch(function() {
          // Only fall back to cache if network completely fails (offline)
          return caches.match(event.request) ||
                 new Response(
                   '<html dir="rtl"><body style="font-family:Heebo,Arial;padding:40px;text-align:center;">' +
                   '<h1>אין חיבור לאינטרנט</h1>' +
                   '<p>נסה שוב כשאתה מחובר לאינטרנט</p>' +
                   '</body></html>',
                   { headers: { 'Content-Type': 'text/html;charset=utf-8' } }
                 );
        })
    );
    return;
  }

  // ═══ STATIC ASSETS (icons): CACHE-FIRST ═══
  if (ASSETS.some(function(a) { return url.includes(a.replace('./', '')); })) {
    event.respondWith(
      caches.match(event.request).then(function(resp) {
        return resp || fetch(event.request).then(function(networkResp) {
          // Cache new icons we haven't seen before
          if (networkResp && networkResp.status === 200) {
            var clone = networkResp.clone();
            caches.open(CACHE_VERSION).then(function(cache) {
              cache.put(event.request, clone);
            });
          }
          return networkResp;
        });
      })
    );
    return;
  }

  // ═══ EVERYTHING ELSE: network-first ═══
  // (Firebase API calls, fonts, etc. - never cached)
});

// Listen for messages from the page (e.g. "check for update now")
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
