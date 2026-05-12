# lake_autofill patch

目的:
既存トップ階層の本体連携ページで、手動保存 saveTrip() の時だけ lake_name を自動補完する。

アップロード:
- /lake_autofill.js を新規追加
- /index.html を上書き

触らない:
- /app.js
- /viewer/app.js
- Pico Wスケッチ
- logsync
- maplink
- putTrip
- /remote

前提:
- /viewer/lakes/ がGitHub上に存在すること。
