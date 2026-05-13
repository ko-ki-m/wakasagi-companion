GitHub側 v20260513D

リポジトリ直下へアップロード/上書きするファイル:
- index.html
- mapsync_topfields_fix_20260513D.js

触らないファイル:
- app.js
- lake_autofill.js
- viewer/index.html
- viewer/app.js

index.html には以下を追加済み:
<script src="./mapsync_topfields_fix_20260513D.js?v=20260513D" defer></script>

重要:
GitHub側だけでは payload に無い値は作れません。
先に .ino 側 v20260513D を入れ、Pico W の /log から地図連携を再実行してください。
