Wakasagi Map v11.8.4 restore + popup-large only

目的:
- 壊れたv11.9系の入口から戻して、今まで動いていたv11.8.4の地図へ戻す。
- 地図の仕組み、Leaflet初期化、app-v1184.js、IndexedDB、maplink/logsyncは変えない。
- 変更するのは入口とポップアップ表示サイズだけ。

重要:
- GitHub上の既存 app-v1184.js は削除しない。
- GitHub上の既存 style-v1184.css は削除しない。
- このzipは「既存ファイルを全部消して置換」ではない。
- wakasagi-companion 直下へ、このzipの中身を上書き追加する。

確認URL:
https://ko-ki-m.github.io/wakasagi-companion/force-v1184.html

確認手順:
1. force-v1184.html を開く。
2. 画面上部が Wakasagi Map v11.8.4 になっていることを確認。
3. 地図が今まで通り表示されることを確認。
4. ピンをタップする。
5. 日付ボタンだけが大きく表示されることを確認。
6. 日付を押した後の詳細文字だけが大きくなっていることを確認。

このzipに含めたファイル:
- index.html
- force-v1184.html
- force-v119.html
- map-v1184.html
- map-v119.html
- manifest-v1184.webmanifest
- manifest-v119.webmanifest
- manifest.webmanifest
- reset.html
- style-v1184-popup-large.css
- icon-192.png
- icon-512.png
- README.txt
