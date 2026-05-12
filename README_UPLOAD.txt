アップロード内容

GitHubリポジトリのトップ階層に lake_autofill.js を上書きアップロードしてください。

対象:
  /wakasagi-companion/lake_autofill.js

触らない:
  index.html
  app.js
  viewer/
  Pico Wスケッチ
  lake_name_check.html は本番不要なので削除

この版の役割:
  1. #logsync 保存時、過去地点へ上書き統合せず今回釣行として保存する
  2. lake_name が空の新規保存データへ湖名を補完する
  3. 既に保存済みの lake_name 空欄データも同じChrome IndexedDB内で補修する
  4. maplink payload に同地点の過去回数/今日回数を付加する

確認:
  既に回数 2→3 と野尻湖テストによる湖名補完確認が取れているため、本番固定用の整理版です。
