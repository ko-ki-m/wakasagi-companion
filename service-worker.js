const CACHE_NAME = 'wakasagi-loglink-map-v114';
const ASSETS = ['./','./index.html?v=114','./style.css?v=114','./app.js?v=114','./manifest.webmanifest?v=114','./reset.html','./force-v1121.html','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;e.respondWith(caches.match(r).then(c=>c||fetch(r).then(res=>{const cp=res.clone();caches.open(CACHE_NAME).then(cache=>cache.put(r,cp));return res;}).catch(()=>c||Response.error())));});
