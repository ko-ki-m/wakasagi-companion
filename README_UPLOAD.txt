GitHub Pages側アップロード用。

リポジトリ直下に以下2ファイルを配置してください。
- index.html 既存ファイルを上書き
- mapsync_topfields_fix_20260513b.js 新規追加

変更しないファイル:
- app.js
- lake_autofill.js
- viewer/index.html
- viewer/app.js

注意:
このGitHub側修正は、Pico W側 #logsync payload に line_no / sinker_g または sinker_g_x10 / fishfinder_m または fishfinder_depth_m または max_depth_m が入っていることを前提に、viewerが読む trip_records トップ階層へ補完します。
そのため、Pico W側 .ino の指定4箇所の修正も必須です。
