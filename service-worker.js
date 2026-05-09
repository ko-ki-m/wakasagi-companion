// Wakasagi Map: Service Worker is not used.
// This file only removes an old registered Service Worker and old caches.
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch (e) {}
    try {
      await self.registration.unregister();
    } catch (e) {}
    try {
      await self.clients.claim();
    } catch (e) {}
  })());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
