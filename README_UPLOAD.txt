# wakasagi-companion 修正ファイル

アップロードするファイル:

- lake_autofill.js

アップロード先:

- wakasagi-companion リポジトリのトップ階層
- 既存の lake_autofill.js を上書き

触らないもの:

- index.html
- app.js
- viewer/
- Pico Wスケッチ

修正内容:

1. #logsync 保存時に、過去地点(map_spot_id)へ統合してしまい新規釣行回数が増えない問題を修正。
   同じsidの再同期だけ既存データを更新し、初回logsyncは新しいtrip_recordsを作らせる。

2. lake_name が空の場合だけ、viewer/lakes の全国湖沼JSONから湖名を補完。

3. GitHubからPico Wへ渡すmaplink payloadに、同地点20m以内の過去回数/今日回数を付加。
