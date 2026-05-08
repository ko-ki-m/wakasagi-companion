// Wakasagi Map v11.8.2 - service worker disabled
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      await self.registration.unregister();
    } catch(e) {}
  })());
});
self.addEventListener('fetch', event => {});
