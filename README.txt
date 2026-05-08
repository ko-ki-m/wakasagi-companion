Wakasagi Map v11.9 Senior UI
=============================

目的
----
年配者でも読める地図アプリUIにするための v11.9 です。
Pico W本体スケッチ、P1/P2/P3/SP、TelemetryLogEntry、tlog_tick、黒スイッチ処理は変更しません。

ファイル
--------
- map-v119.html
- app-v119.js
- style-v119.css
- manifest-v119.webmanifest
- force-v119.html
- icon-192.png
- icon-512.png

重要
----
このファイル一式を GitHub リポジトリ wakasagi-companion のルートへ追加/上書きしない限り、GitHub Pages 上は v11.8.4 のままです。
現在のPico Wスケッチ内 WAKASAGI_MAP_URL がリポジトリルートを向いている場合、MAPボタンからも v11.9 には入りません。
まずはスマホ/PCブラウザで以下を直接開いて確認します。

https://ko-ki-m.github.io/wakasagi-companion/force-v119.html

Pico W側に後で固定する場合のURL
-------------------------------
const WAKASAGI_MAP_URL = 'https://ko-ki-m.github.io/wakasagi-companion/map-v119.html?v=119';

v11.9 Senior UIの確認項目
------------------------
1. force-v119.html を開く
2. 画面上部が Wakasagi Map v11.9 であること
3. 地図が表示されること
4. ピンをタップした直後は日付ボタンだけが大きく表示されること
5. 日付ボタンをタップした後だけ詳細が大きく表示されること
6. LOGへ戻る / 操作パネルへ戻る が押しやすいこと

maplink/logsync 修正内容
-----------------------
Pico W側の /log は #maplink= の値を base64 として atob() します。
そのため v11.9 では以下に合わせています。

- #maplink= には base64(JSON) だけを入れる
- return_url は別hashパラメータにせず、payload内部に入れる
- source はオブジェクトではなく文字列 'wakasagi_map_v119'
- map_spot_id を必ず入れる
- Pico W側が読む acc / fishfinder_m / note も入れる

Service Worker
--------------
使いません。
既存の古いService Workerを登録し直すコードも入れていません。

通常運用でやらないこと
----------------------
- GitHub側で独自sidを作らない
- GitHub側でFISHボタンを作らない
- GitHub側で釣行開始を作らない
- Export / Importを通常運用にしない
