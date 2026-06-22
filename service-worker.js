// Wakasagi companion service worker reset / no-cache shell
// Purpose: prevent old gps-bridge.html / app files from remaining in browser cache.

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
      if (self.registration && self.registration.unregister) {
        await self.registration.unregister();
      }
    } catch (e) {}

    try {
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientsList) {
        try { client.navigate(client.url); } catch (e) {}
      }
    } catch (e) {}
  })());
});

self.addEventListener('fetch', (event) => {
  // Do not intercept. Always let the browser/network load the latest files.
});
