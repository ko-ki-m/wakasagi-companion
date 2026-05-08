Wakasagi Map v11.8.1 no-SW unique-files

目的:
- v11.7のまま戻る問題を根本回避するため、app.js/style.css/manifest.webmanifest の同名ファイル運用をやめる。
- app-v1181.js / style-v1181.css / manifest-v1181.webmanifest を使う。
- Service Worker登録を停止する。
- service-worker.js は自分自身をunregisterし、全cacheを削除する。
- force-v1181.html から必ず index.html?v=1181 を開く。

更新:
1. GitHub Pages上の既存ファイルを、このフォルダの全ファイルで上書き。
2. Safariで https://ko-ki-m.github.io/wakasagi-companion/force-v1181.html を直接開く。
3. 画面上部が Wakasagi Map v11.8.1 になっていることを確認。
4. app-v1181.js が読まれているため、古いapp.jsに戻りにくい。
