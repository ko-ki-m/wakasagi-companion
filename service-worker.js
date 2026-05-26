// Wakasagi Companion offline GPS link service worker
// Version: 2026-05-26 gps-recorder-route-fix-b
// 目的:
// - GitHub Pages本体を事前キャッシュし、PicoW-Config接続中でもキャッシュ済みで起動できるようにする。
// - gps-recorder.html を index.html にフォールバックさせない。
// - gps-bridge.html も専用HTMLとして扱う。
// - 現在の index.html が実際に読む Stage1/Stage2/lake_autofill をキャッシュ対象にする。
// - 本体 .ino / /log / リール制御には一切関与しない。

const CACHE_NAME = 'wakasagi-companion-shell-v20260526-gps-recorder-route-b';

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app_stage1_point_date_20260522c.js',
  './app_stage2_visit_receiver_20260522e.js',
  './lake_autofill.js',
  './gps-bridge.html',
  './gps-recorder.html',
  './gps_recorder.js',
  './app.js',
  './manifest.webmanifest',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

function shellKeyForUrl(url){
  const path = url.pathname.replace(/^\/+/, '');
  if(path === '' || path === './') return './';
  return './' + path;
}

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

async function cachedByKey(key){
  const cache = await caches.open(CACHE_NAME);
  return (await cache.match(key, {ignoreSearch:true})) || null;
}

async function cachedIndex(){
  return (await cachedByKey('./index.html')) || (await cachedByKey('./'));
}

async function handleDocumentRequest(req){
  const url = new URL(req.url);
  const key = shellKeyForUrl(url);

  // 重要:
  // gps-recorder.html / gps-bridge.html は専用ページ。
  // ここで index.html にフォールバックすると「データを移行中」のMap画面が出続ける。
  const isDedicatedDoc =
    key === './gps-recorder.html' ||
    key === './gps-bridge.html';

  try{
    const fresh = await fetch(req, {cache:'reload'});
    if(fresh && (fresh.ok || fresh.type === 'opaque')){
      const cache = await caches.open(CACHE_NAME);
      if(isDedicatedDoc){
        try{ await cache.put(key, fresh.clone()); }catch(e){}
      }else{
        try{ await cache.put('./index.html', fresh.clone()); }catch(e){}
      }
    }
    return fresh;
  }catch(e){
    if(isDedicatedDoc){
      const cachedDoc = await cachedByKey(key);
      if(cachedDoc) return cachedDoc;
      return new Response(
        '<!doctype html><meta charset="utf-8"><title>Offline</title><body>このページはまだキャッシュされていません。通常通信で一度開いてください。</body>',
        {headers:{'Content-Type':'text/html; charset=utf-8'}, status:503}
      );
    }

    const cached = await cachedIndex();
    if(cached) return cached;
    throw e;
  }
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

self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);

  if(req.mode === 'navigate' || req.destination === 'document'){
    event.respondWith(handleDocumentRequest(req));
    return;
  }

  if(url.origin === self.location.origin){
    event.respondWith((async()=>{
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req, {ignoreSearch:true});
      const key = shellKeyForUrl(url);
      const cachedByPath = await cache.match(key, {ignoreSearch:true});

      const fresh = await fetch(req, {cache:'reload'}).then(async res=>{
        if(res && (res.ok || res.type === 'opaque')){
          try{ await cache.put(req, res.clone()); }catch(e){}
          try{ await cache.put(key, res.clone()); }catch(e){}
        }
        return res;
      }).catch(()=>null);

      return fresh || cached || cachedByPath || Response.error();
    })());
    return;
  }
});
