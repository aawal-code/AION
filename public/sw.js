/**
 * AION Systems Console Service Worker
 * Offline-first cache strategy for application shell assets
 * API requests (/api/*) are strictly network-first/bypassed
 */

const CACHE_NAME = 'aion-shell-v3';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  '/css/tokens.css',
  '/css/app.css',
  '/js/icons.js',
  '/js/devices.js',
  '/js/i18n.js',
  '/js/state.js',
  '/js/app.js',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept or cache dynamic API requests or event streams
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Network-first strategy for app shell assets so UI is always fresh
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
