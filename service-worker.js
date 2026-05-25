// Wakasagi Companion offline GPS link service worker
// Version: 2026-05-25 weather-temp-display-d
// 目的:
// - GitHub Pages本体を事前キャッシュし、PicoW-Config接続中でもキャッシュ済みで起動できるようにする。
// - 現在の index.html が実際に読む Stage1/Stage2/lake_autofill をキャッシュ対象にする。
// - lake_autofill.js の最低/最高気温対応版が古いキャッシュに潰されないよう、CACHE_NAMEを更新する。

const CACHE_NAME = 'wakasagi-companion-shell-v20260525-weather-temp-d';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app_stage1_point_date_20260522c.js',
  './app_stage2_visit_receiver_20260522e.js',
  './lake_autofill.js',
  './gps-bridge.html',
  './app.js',
  './manifest.webmanifest',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

async function cacheAppShell(){
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(APP_SHELL.map(async (url)=>{
    try{
      const res = await fetch(url, {cache:'reload'});
      if(res && (res.ok || res.type === 'opaque')){
        await cache.put(url, res.clone());
      }
    }catch(e){}
  }));
}

self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    await cacheAppShell();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

async function cachedAppShellResponse(){
  const cache = await caches.open(CACHE_NAME);
  return (await cache.match('./index.html', {ignoreSearch:true})) ||
         (await cache.match('./', {ignoreSearch:true}));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);

  if(req.mode === 'navigate' || req.destination === 'document'){
    event.respondWith((async()=>{
      try{
        const fresh = await fetch(req, {cache:'reload'});
        const cache = await caches.open(CACHE_NAME);
        try{ await cache.put('./index.html', fresh.clone()); }catch(e){}
        return fresh;
      }catch(e){
        const cached = await cachedAppShellResponse();
        if(cached) return cached;
        throw e;
      }
    })());
    return;
  }

  if(url.origin === self.location.origin){
    event.respondWith((async()=>{
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req, {ignoreSearch:true});
      const fetchAndStore = fetch(req, {cache:'reload'}).then(res=>{
        if(res && (res.ok || res.type === 'opaque')){
          try{ cache.put(req, res.clone()); }catch(e){}
          try{ cache.put(url.pathname.replace(/^\//,'./'), res.clone()); }catch(e){}
        }
        return res;
      }).catch(()=>null);
      return (await fetchAndStore) || cached || Response.error();
    })());
    return;
  }
});
