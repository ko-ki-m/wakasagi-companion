Wakasagi Map v11.9 Senior UI

目的:
- 年配者でも地図・日付・詳細を読めるUIへ拡大。
- v11.8.4の「ピンをタップ → 過去釣行日だけ表示 → 日付タップ → 詳細表示」の順番を維持。
- Pico W側のスケッチは触らない。

ファイル:
- map-v119.html
- app-v119.js
- style-v119.css
- manifest-v119.webmanifest
- force-v119.html
- icon-192.png
- icon-512.png
- README.txt

Service Worker:
- v11.9では新規Service Workerを使わない。
- force-v119.html は既存Service WorkerとCacheを削除して、map-v119.html?v=119 を開くための入口。

更新手順:
1. GitHub Pagesのリポジトリに、このフォルダ内の全ファイルをアップロード。
2. スマホで以下を開く。
   https://ko-ki-m.github.io/wakasagi-companion/force-v119.html
3. 「v11.9を開く」を押す。
4. 画面上部が Wakasagi Map v11.9 になっていることを確認。
5. 地図が表示されることを確認。
6. ピンをタップし、その場所の過去釣行日だけが大きなボタンで表示されることを確認。
7. 日付をタップし、その釣行回の詳細が大きな文字で表示されることを確認。
8. LOGへ戻る / 操作パネルへ が押しやすいことを確認。

Pico W側に固定する地図URLを後で変更する場合:
const WAKASAGI_MAP_URL = 'https://ko-ki-m.github.io/wakasagi-companion/map-v119.html?v=119';

重要:
- Pico W側に /map は作らない。
- handleMapPage は作らない。
- Leaflet/OpenStreetMapをPico Wスケッチへ入れない。
- GitHub側で独自sidを作らない。
- GitHub側でFISHボタンを作らない。
- Export / Importを通常運用に戻さない。
- P1/P2/P3/SP、TelemetryLogEntry、tlog_tick、黒スイッチFISHは触らない。
