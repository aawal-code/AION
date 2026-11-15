/**
 * AION Systems Console Service Worker
 * Offline-first cache strategy for application shell assets
 * API requests (/api/*) are strictly network-first/bypassed
 */

const CACHE_NAME = 'aion-shell-v3';
const SHELL_ASSETS = [
  '/',
  'index.html',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  '/brand/logo-dark-ico.svg',
  '/brand/icon-dark.svg',
  '/brand/icon-light.svg',
  '/brand/wordmark-dark.svg',
  '/brand/wordmark-light.svg',
  '/brand/apple-touch-icon.png',
  '/brand/icon-192.png',
  '/brand/icon-512.png',
  '/brand/icon-1024.png',
  '/brand/icon-32.png',
  '/brand/icon-16.png',
  '/brand/aion.ico',
  '/css/tokens.css',
  '/css/theme.css',
  '/css/app.css',
  '/js/icons.js',
  '/js/devices.js',
  '/js/media.js',
  '/js/nav.js',
  '/js/settings.js',
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

// =============================================================================
// Web Push Notifications Handling
// =============================================================================
self.addEventListener('push', (event) => {
  let data = { title: 'AION', body: 'Workstation Notification', icon: '/brand/icon-192.png' };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = Object.assign(data, parsed);
    }
  } catch (e) {
    if (event.data) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body || '',
    icon: data.icon || '/brand/icon-192.png',
    badge: '/brand/icon-32.png',
    data: data.data || { url: '/' },
    vibrate: [100, 50, 100],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.indexOf(self.location.origin) !== -1 && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
