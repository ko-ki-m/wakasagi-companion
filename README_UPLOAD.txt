アップロード方法

1. このZIPを展開する。
2. 中の lake_autofill.js を GitHub リポジトリのトップ階層へアップロードする。
3. 既に lake_autofill.js がある場合は上書きする。
4. index.html / app.js / viewer / Pico W側は触らない。

目的
Pico W /log から GitHub Pages側へ戻った #logsync 保存時だけ、lake_name が空なら viewer/lakes の全国湖沼JSONから湖名を補完して保存する。

注意
GitHub Pagesやブラウザのキャッシュにより、反映に少し時間がかかる場合があります。
