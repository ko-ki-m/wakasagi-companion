Wakasagi Map v11.8.4 FIX-20260509C

反映確認:
1. GitHubへこのzipの全ファイルを上書きアップロードする。
2. rawで map-v1184.html を開き、Wakasagi Map v11.8.4 FIX-20260509C が見えることを確認する。
3. rawで app-v1184.js を開き、先頭に WAKASAGI_FIX_20260509C が見えることを確認する。
4. https://ko-ki-m.github.io/wakasagi-companion/force-v1184.html を開く。

この版で直すこと:
- 画面上部のバージョン表示を v11.8.4 FIX-20260509C に変える。
- map-v1184.html をHTML構造へ戻す。
- style-v1184.css を1行壊れ状態から復旧する。
- ピンをタップすると、その場所の過去釣行日だけを表示する。
- 日付をタップすると、その釣行回の詳細をポップアップ内と詳細欄に表示する。
- ?pico=...&autolink=1 で開いた時、自動で現在地を /log#maplink=base64(JSON) へ渡す。
- /log から戻った時、linked=1 または #logsync を検出し、「本体ログ: 連携済み」にする。
- return_url から autolink を削除して無限往復を防ぐ。
- 既存 service-worker.js は自己解除する内容で上書きする。

触らないこと:
- Pico Wスケッチ
- FISH/sidの作成
- TelemetryLogEntry
- tlog_tick
