アップロード内容

GitHubリポジトリのトップ階層に lake_autofill.js を上書きアップロードしてください。

対象:
  /wakasagi-companion/lake_autofill.js

触らない:
  index.html
  app.js
  viewer/
  Pico Wスケッチ

目的:
  1. line_no / sinker_g に「未登録」を自動保存しない
  2. 既に保存済みの「未登録」を、正規キー line_no / sinker_g の実値で復旧する
  3. 実値が無い場合は「未登録」を消して空欄へ戻す
  4. #logsync の map_spot_id 上書き統合防止は維持する

重要:
  ライン・シンカーの推測補完はしません。
  正規キー line_no / sinker_g だけを扱います。
