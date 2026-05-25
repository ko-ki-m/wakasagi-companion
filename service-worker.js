// Wakasagi Companion offline GPS link service worker
// Version: 2026-05-25 ap-shell-current-map
// 目的:
// - GitHub Pages本体を事前キャッシュし、PicoW-Config接続中でもキャッシュ済みで起動できるようにする。
// - 現在の index.html が読み込む Map 本体JS/CSSをキャッシュ対象に含める。
// - 地図タイル/CDNが読めない環境でも、GPS取得→Pico W /log#maplink の自動連携を成立させる。
// 注意:
// - 初回または更新直後は、インターネット接続中にGitHub Pagesを一度開いて、このService Workerを更新する必要がある。
// - 外部地図タイル/Leaflet CDNはオフラインでは保証しない。実釣中の本体連携では地図表示よりGPS連携を優先する。

const CACHE_NAME = 'wakasagi-companion-shell-v20260525-ap-shell-current-map';
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

  // GitHub Pages内のページ遷移はネットワーク優先。AP/オフラインで失敗した時だけキャッシュ済みindexを返す。
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

  // 同一オリジンのMap本体JS/CSS/manifest/icon等はキャッシュ優先、裏で更新。
  // index.html 側の ?v=... 付き読み込みにも ignoreSearch:true で対応する。
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

  // 外部Leaflet/CDN/地図タイルは通常ネットワークへ流す。
  // AP/オフラインでは失敗しても、app_stage1側がGPS連携を継続する前提。
});
