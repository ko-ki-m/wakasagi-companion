// Wakasagi Companion offline GPS link service worker
// Version: 2026-05-14 auto-gps-2
// 目的:
// - GitHub Pages本体を事前キャッシュし、PicoW-Config接続中でもキャッシュ済みで起動できるようにする。
// - 地図タイルが読めない環境でも、GPS取得→Pico W /log#maplink の自動連携を成立させる。
// 注意:
// - 初回だけはインターネット接続中にGitHub Pagesを一度開く必要がある。以後は通常起動時に自動更新する。
// - 外部地図タイルはオフラインでは保証しない。実釣中の本体連携では地図表示ではなくGPS連携を優先する。

const CACHE_NAME = 'wakasagi-companion-shell-v20260514-auto-gps-2';
const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './manifest.json'
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

  // GitHub Pages内のページ遷移は、ネットワーク優先。失敗時はキャッシュ済みindexを返す。
  if(req.mode === 'navigate' || req.destination === 'document'){
    event.respondWith((async()=>{
      try{
        const fresh = await fetch(req);
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

  // 同一オリジンのapp.js等はキャッシュ優先、裏で更新。
  if(url.origin === self.location.origin){
    event.respondWith((async()=>{
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req, {ignoreSearch:true});
      const fetchAndStore = fetch(req).then(res=>{
        if(res && (res.ok || res.type === 'opaque')){
          try{ cache.put(req, res.clone()); }catch(e){}
        }
        return res;
      }).catch(()=>null);
      return cached || (await fetchAndStore) || Response.error();
    })());
    return;
  }

  // 外部タイル/CDNは通常ネットワークへ流す。オフラインでは地図表示を諦め、GPS連携を優先する。
});
