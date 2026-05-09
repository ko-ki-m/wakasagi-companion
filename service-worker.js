// Wakasagi Map no-cache service worker killer.
// Existing service workers can keep old files. This one unregisters itself.
self.addEventListener('install', event => {
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch (e) {}
    try {
      await self.registration.unregister();
    } catch (e) {}
  })());
});
self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request));
});
