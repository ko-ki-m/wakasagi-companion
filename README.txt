Wakasagi Companion HTTPS PWA v1

これは Pico W の .ino に入れるものではありません。
スマホ側で動く釣行ポイント記憶PWAです。

この版の機能:
- 現在地取得
- 釣行ポイント保存
- 20m/100m以内の過去釣行回数表示
- この場所で釣行開始
- 湖名/ポイント名/ライン/シンカー/魚探水深/水温/メモ保存
- 標準地図で座標確認
- IndexedDB保存
- JSON書き出し
- PWA manifest / service worker

配置条件:
- HTTPSで公開すること
- Google Maps JavaScript APIや課金APIは不要
- QRは公開後の https://... URLで作成すること
