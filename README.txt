Wakasagi Map v11.9 Senior UI 本番反映用

このzipに含めるファイル:
1. map-v119.html
2. app-v119.js
3. style-v119.css
4. manifest-v119.webmanifest
5. force-v119.html
6. icon-192.png
7. icon-512.png
8. README.txt
9. index.html
10. manifest.webmanifest
11. service-worker.js

目的:
- GitHub地図アプリを v11.9 Senior UI に更新する。
- ピンをタップ → その場所の過去釣行日だけ表示。
- 日付をタップ → その釣行回の詳細表示。
- ?pico=...&autolink=1 のログ連携を行う。
- return_url から autolink を削除して無限往復を防ぐ。
- 古い Service Worker は service-worker.js で自己解除する。

含めないもの:
- v1184系ファイル
- v1181/v1182系ファイル
- Pico Wスケッチ

反映確認:
- 画面上部: Wakasagi Map v11.9 Senior UI
- app-v119.js先頭: WAKASAGI_MAP_V119_SENIOR_FINAL_20260509
- map-v119.html内: app-v119.js?v=v119_final_20260509
