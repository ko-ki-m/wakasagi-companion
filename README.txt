Wakasagi Map v11.9 Senior UI - PUBLIC COMPLETE

今回の重要修正:
- index.html を v11.8.4 から v11.9 へ変更。
- Pico W が https://ko-ki-m.github.io/wakasagi-companion/?pico=...&autolink=1 を開いても、pico/autolink を保持したまま map-v119.html へ移動。
- force-v119.html もボタン待ちではなく、Service Worker/Cache削除後に自動で map-v119.html を開く。
- maplink は #maplink=base64(JSON) 形式。
- return_url は maplink payload 内に格納。
- GitHub側で独自sid/FISH/釣行開始は作らない。
- Pico W側に /map は作らない。
- Pico Wスケッチ、P1/P2/P3/SP、TelemetryLogEntry、tlog_tick、黒スイッチFISHは触らない。

GitHubへ入れるファイル:
- index.html
- map-v119.html
- app-v119.js
- style-v119.css
- manifest-v119.webmanifest
- manifest.webmanifest
- force-v119.html
- reset.html
- icon-192.png
- icon-512.png
- README.txt

アップロード方法:
1. このzipの中身を解凍する。
2. GitHubの wakasagi-companion リポジトリ直下へ全ファイルを上書きアップロードする。
3. Pages反映後、以下を開く。
   https://ko-ki-m.github.io/wakasagi-companion/force-v119.html
4. 自動で map-v119.html が開き、画面上部が Wakasagi Map v11.9 になることを確認する。
5. Pico WのMAPボタンから開いた場合も、ルート index.html が v11.9へ転送する。

確認ポイント:
- 画面上部: Wakasagi Map v11.9
- 地図表示
- ピンをタップ → 過去釣行日だけ表示
- 日付タップ → 詳細表示
- LOGへ戻る / 操作パネルへ が大きい
- Pico Wからの ?pico=...&autolink=1 が消えない
