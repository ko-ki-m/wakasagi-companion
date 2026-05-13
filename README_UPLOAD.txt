アップロード内容

GitHubリポジトリのトップ階層に lake_autofill.js を上書きアップロードしてください。

対象:
  /wakasagi-companion/lake_autofill.js

触らない:
  index.html
  app.js
  viewer/
  Pico Wスケッチ

この版で維持:
  1. #logsync の回数増加修正
  2. 湖名補完
  3. 水深自動入力
  4. 天気自動取得
  5. 風自動取得
  6. 既存DB補修

line_no / sinker_g:
  1. #logsync payloadの正規キー line_no / sinker_g を保存する
  2. trip本体 / pico_summary / pico_logs の正規キーから未登録を実値に置換する
  3. 正規キーが無い場合は未登録を入れない
  4. 過去履歴のline_no / sinker_gを継承しない
  5. maplink payloadへ履歴由来line_no / sinker_gを入れない

検査:
  inspection_report.txt を同梱しています。
