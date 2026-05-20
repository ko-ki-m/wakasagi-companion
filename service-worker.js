// Wakasagi Companion service worker
// Version: 2026-05-20 v12-place-visit-shell-1
//
// 目的:
// - 現在の index.html が読む app_pre_stage1_rollback.js / lake_autofill.js / style.css をキャッシュする。
// - CACHE_NAME を更新し、古いJSキャッシュを残さない。
// - fetch 方針は既存の clean-autolink-shell と同じまま維持する。

const CACHE_NAME = 'wakasagi-companion-shell-v20260520-v12-place-visit-1';

const APP_SHELL = [
  './',
  './index.html',

  // CSS
  './style.css',

  // JS
  // app.js は旧互換用に残す。
  './app.js',

  // 現在の index.html が読む本体JS。
  './app_pre_stage1_rollback.js',

  // 旧キャッシュ/旧index互換用。
  './app_clean_autolink_idb.js',

  // 現在の index.html が読む補助JS。
  './lake_autofill.js',

  // Manifest
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
    }catch(e){
      // APモードや一時的な通信不可で取れないファイルがあっても、
      // install全体を失敗させない。
      // 既にキャッシュ済みのものがあればfetch側で使う。
    }
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

    // 新しいCACHE_NAME以外は削除する。
    // これにより、古い app.js / 古い診断版JS を返し続ける事故を減らす。
    await Promise.all(
      keys
        .filter(k => k !== CACHE_NAME)
        .map(k => caches.delete(k))
    );

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

  // GitHub Pages内のページ遷移は、ネットワーク優先。
  // PicoW-Config中などでネットワーク取得に失敗した時だけ、
  // キャッシュ済み index.html を返す。
  if(req.mode === 'navigate' || req.destination === 'document'){
    event.respondWith((async()=>{
      try{
        const fresh = await fetch(req);

        // index.htmlは更新確認を兼ねてキャッシュへ反映する。
        const cache = await caches.open(CACHE_NAME);
        try{
          await cache.put('./index.html', fresh.clone());
        }catch(e){}

        return fresh;
      }catch(e){
        const cached = await cachedAppShellResponse();
        if(cached) return cached;
        throw e;
      }
    })());

    return;
  }

  // 同一オリジンの app_pre_stage1_rollback.js / lake_autofill.js / style.css などは、
  // キャッシュ優先で返し、裏で更新を試みる。
  //
  // これにより、APモードでインターネットに出られない時でも、
  // 事前キャッシュ済みならアプリ本体が起動できる。
  if(url.origin === self.location.origin){
    event.respondWith((async()=>{
      const cache = await caches.open(CACHE_NAME);

      const cached = await cache.match(req, {ignoreSearch:true});

      const fetchAndStore = fetch(req).then(res=>{
        if(res && (res.ok || res.type === 'opaque')){
          try{
            cache.put(req, res.clone());
          }catch(e){}
        }

        return res;
      }).catch(()=>null);

      return cached || (await fetchAndStore) || Response.error();
    })());

    return;
  }

  // 外部Leaflet/CDN/地図タイルは通常ネットワークへ流す。
  // オフライン/APモードでは地図表示は諦め、GPS連携を優先する。
});
