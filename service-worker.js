// Wakasagi Map v11.8.1
// Service Worker is intentionally disabled.
// This file unregisters itself so old cached versions stop controlling the page.
self.addEventListener('install', (event) => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      await self.registration.unregister();
    } catch (e) {}
    try {
      const clientsList = await self.clients.matchAll({type:'window', includeUncontrolled:true});
      for (const c of clientsList) c.navigate(c.url);
    } catch (e) {}
  })());
});
self.addEventListener('fetch', () => {});
