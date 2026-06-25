// Wakasagi Map service-worker v20260625a
// 現在の目的: 古いキャッシュを保持しない。gps-bridge.html / gps-recorder.html を index.html へフォールバックさせない。
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    try{
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      await self.clients.claim();
    }catch(e){}
  })());
});
self.addEventListener('fetch', event => {
  // no custom response; browser/network default. Do not fallback special pages to index.html.
});
