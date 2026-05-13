GitHub側 上書き手順

1. GitHubリポジトリ直下の index.html を、このZIP内の index.html で上書きする。
2. GitHubリポジトリ直下の app.js を、このZIP内の app.js で上書きする。
3. 追加JS方式は使わない。下記ファイルは削除する。
   - mapsync_topfields_fix_20260513.js
   - mapsync_topfields_fix_20260513b.js
   - mapsync_topfields_fix_20260513C.js
   - mapsync_topfields_fix_20260513D.js
4. 触らないファイル：
   - lake_autofill.js
   - viewer/index.html
   - viewer/app.js

index.html は app.js?v=116 を読む形に変更済み。
