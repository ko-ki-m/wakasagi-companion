'use strict';

// ワカサギ GitHub Pages 復旧用 service-worker.js
// 目的:
// 1. 以前のキャッシュ型Service Workerが保持した古い app.js / index.html を消す。
// 2. 以後はキャッシュから返さず、ネットワーク上のGitHubファイルをそのまま使わせる。
// 3. Service Worker自身も登録解除し、これ以上ページ内容に介入しない。

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch (e) {
      // 復旧処理なので、キャッシュ削除失敗だけで停止しない。
    }

    try {
      await self.clients.claim();
    } catch (e) {}

    try {
      await self.registration.unregister();
    } catch (e) {}
  })());
});

// 復旧用:
// キャッシュを使わず、必ずネットワークへ通す。
// ネットワークが無い場合はブラウザ標準の失敗に任せる。
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
