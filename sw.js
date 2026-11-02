/* Expense Tracker service worker — cache-first, versioned */
const CACHE = 'expense-tracker-v4';
const PRECACHE = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './sw.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) =>
        Promise.all(
          PRECACHE.map((url) =>
            cache.add(url).catch(function () { /* ignore single miss */ })
          )
        )
      )
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  // Network-first for navigations so updates land; cache fallback offline
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') !== -1) {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put('./index.html', copy);
            cache.put(req, res.clone()).catch(function () {});
          });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (c) {
          return c || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) {
        // Revalidate in background
        fetch(req).then(function (res) {
          if (res && res.ok) {
            caches.open(CACHE).then(function (cache) { cache.put(req, res); });
          }
        }).catch(function () {});
        return cached;
      }
      return fetch(req).then(function (res) {
        if (!res || !res.ok) return res;
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req);
      });
    })
  );
});
