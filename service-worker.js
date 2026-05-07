const CACHE_NAME = 'wakasa-map-v6-20260507';
const ASSETS = ['./','./index.html','./style.css?v=6','./app.js?v=6','./manifest.webmanifest','./icon-192.png','./icon-512.png','./reset.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(()=>{}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter((k)=>k!==CACHE_NAME && (k.indexOf('wakasa')>=0 || k.indexOf('wakasagi')>=0)).map((k)=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  const isAppShell = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/app.js') || url.pathname.endsWith('/style.css') || url.pathname.endsWith('/manifest.webmanifest') || url.pathname.endsWith('/reset.html');
  if(isAppShell){
    event.respondWith(fetch(req).then((res)=>{
      const copy=res.clone();
      caches.open(CACHE_NAME).then((cache)=>cache.put(req,copy)).catch(()=>{});
      return res;
    }).catch(()=>caches.match(req).then((cached)=>cached || Response.error())));
    return;
  }
  event.respondWith(caches.match(req).then((cached)=>cached || fetch(req).then((res)=>{
    const copy=res.clone();
    caches.open(CACHE_NAME).then((cache)=>cache.put(req,copy)).catch(()=>{});
    return res;
  }).catch(()=>cached || Response.error())));
});
