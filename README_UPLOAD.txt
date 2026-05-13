# wakasagi-companion GitHub側 上書き用 v20260513E

目的:
- 追加JS方式を完全にやめる。
- GitHub Pages root側の既存 index.html と app.js を上書きする。
- 本体ログ連携 #logsync で届いた line_no / sinker_g / fishfinder_depth_m / water_temp_c / weather / wind を trip_records トップ階層へ保存する。
- root側マップ、全履歴、選択詳細に反映する。

アップロード場所:
- wakasagi-companion/index.html
- wakasagi-companion/app.js

削除対象:
- mapsync_topfields_fix_20260513.js
- mapsync_topfields_fix_20260513b.js
- mapsync_topfields_fix_20260513C.js
- mapsync_topfields_fix_20260513D.js
- その他 mapsync_topfields_fix_20260513*.js

触らない:
- lake_autofill.js
- viewer/index.html
- viewer/app.js

注意:
- このZIPはGitHub側だけです。
- Pico W側 .ino では、別途 tlog2StatsBySidForMapSync() と buildMapSyncPayload() の修正が必要です。
