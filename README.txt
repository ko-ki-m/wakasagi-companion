Wakasagi Map v11.8.4 unique-entry

11.8.2のまま表示される問題への対策:
- index.html / app.js のキャッシュ問題を避けるため、入口を map-v1184.html に変更。
- JS/CSS/manifestも app-v1184.js / style-v1184.css / manifest-v1184.webmanifest に変更。
- Service Workerは停止。
- force-v1184.html から必ず map-v1184.html?v=1184 を開く。

仕様:
- ピンをタップした直後は、その場所の過去釣行日だけを表示。
- 見たい日付をタップすると、その釣行回の詳細を表示。

更新:
1. GitHub Pages上の既存ファイルを、このフォルダの全ファイルで上書き。
2. Safariで https://ko-ki-m.github.io/wakasagi-companion/force-v1184.html を直接開く。
3. 画面上部が Wakasagi Map v11.8.4 になっていることを確認。
4. 今後Pico W側のWAKASAGI_MAP_URLは https://ko-ki-m.github.io/wakasagi-companion/map-v1184.html?v=1184 に固定。
