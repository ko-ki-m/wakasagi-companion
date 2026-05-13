アップロード内容

GitHubリポジトリのトップ階層に lake_autofill.js を上書きアップロードしてください。

対象:
  /wakasagi-companion/lake_autofill.js

今回の修正:
  既存の過去履歴で lake_name が既に入っているデータも、
  line_no / sinker_g / 水深 / 天気 / 風 の補修対象にする。
  line_no / sinker_g は正規キーがある場合だけ復旧し、推測補完はしない。

触らない:
  index.html
  app.js
  viewer/
  Pico Wスケッチ

検査:
  inspection_report.txt を同梱しています。
