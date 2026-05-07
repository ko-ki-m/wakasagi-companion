Wakasagi Map v6 RESET

目的:
- 古いv3/v4のService Workerキャッシュに掴まれている状態を解除するための版。
- 画面上部に必ず「Wakasagi Map v6」と表示されます。

GitHub Pages更新手順:
1. このフォルダ内の全ファイルを、GitHub Pagesで公開している場所の既存ファイルに上書きする。
2. Safariで https://.../reset.html を1回開く。
3. 自動で index.html?v=6 に移動し、画面上部が Wakasagi Map v6 になることを確認する。
4. その後、古いホーム画面アイコンは削除し、v6表示中のSafariからホーム画面に追加し直す。

重要:
- DB名は wakasa_companion_v2 のままなので、過去ポイントDBは維持します。
- v3と表示される場合、v6のコードはまだ動いていません。GPSエラーの調査より先にキャッシュ更新が必要です。
