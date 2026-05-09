Wakasagi Map v11.8.4 REAL TARGET FIX 20260509

このzipで直す対象:
1. 日付をタップしても詳細が出ない問題。
   - app-v1184.js に window.wakasagiPopupTrip を確実に追加。
   - 日付ボタン押下でポップアップ内と詳細欄に詳細を出す。

2. /log から map に戻った後、「本体ログへ連携」が未連携のままになる問題。
   - logsync成功時に linkBadge を「連携済み」へ更新。
   - linkStatus / autoLinkBadge / autoLinkStatus も完了表示へ更新。
   - return_url から autolink を削除して linked=1 を付け、無限往復を防止。

重要:
- map-v1184.html の app-v1184.js 読み込みURLを
  app-v1184.js?v=REAL_TARGET_FIX_20260509
  に変更しているため、古いJSキャッシュを使いません。

GitHubへ上書きアップロードするファイル:
- app-v1184.js
- map-v1184.html
- style-v1184.css
- force-v1184.html
- index.html
- reset.html
- manifest-v1184.webmanifest
- manifest.webmanifest
- icon-192.png
- icon-512.png
- README.txt

アップロード後の確認:
1. https://raw.githubusercontent.com/ko-ki-m/wakasagi-companion/main/app-v1184.js を開く。
2. 先頭に WAKASAGI_REAL_TARGET_FIX_20260509 が見えることを確認。
3. ページ内検索で window.wakasagiPopupTrip が見つかることを確認。
4. https://ko-ki-m.github.io/wakasagi-companion/force-v1184.html を開く。
