Wakasagi Map v11.8.2 fixed-js no-SW

v11.8.1で地図が表示されなかった原因:
- app-v1181.js の initPwa() 周辺に構文エラーが入り、JavaScriptが停止していた。
- そのため Leaflet地図初期化まで到達しなかった。

v11.8.2:
- app-v1182.js / style-v1182.css / manifest-v1182.webmanifest を使用。
- Service Worker登録を停止。
- app-v1182.js は node --check で構文確認済み。
- ピンタップ時、その場のポップアップに釣行日一覧を表示。
- 2回以上ある場合はポップアップ内で日付選択。
- 選択した日付の詳細を同じポップアップ内に表示。

更新:
1. GitHub Pages上の既存ファイルを、このフォルダの全ファイルで上書き。
2. Safariで https://ko-ki-m.github.io/wakasagi-companion/force-v1182.html を直接開く。
3. 画面上部が Wakasagi Map v11.8.2 になっていることを確認。
