復旧用ZIPです。修正ではありません。

目的:
- ChatGPTが壊したGitHub root側を、commit 626b19a のroot app動作へ戻す。
- mapsync_topfields_fix_20260513*.js は使わない。
- .ino は触らない。

GitHubリポジトリ直下で上書き:
- index.html
- app.js

削除:
- mapsync_topfields_fix_20260513*.js

触らない:
- lake_autofill.js
- viewer/index.html
- viewer/app.js

注意:
このapp.jsは、commit 626b19a の app.js を jsDelivr から読み込む復旧用ローダーです。
本題修正ではありません。まず壊れたroot側を戻すためだけのものです。
