Wakasagi Map v11.8.4 STOP LOOP RESTORE

目的:
- まず地図表示を復旧する。
- /log と map の無限往復を止める。
- app-v1184.js / map-v1184.html / style-v1184.css を正常なHTML/JS/CSSへ戻す。
- Pico Wスケッチは触らない。
- GitHub側でFISH/sid/釣行開始は作らない。

重要:
- autolink=1 は受け取っても自動連携しない。
- 連携が必要な時だけ「この地点を本体ログへ連携」を押す。
- return_url から autolink を削除し、linked=1 を付けるので、戻ってきても再び/logへ飛ばない。

アップロード:
1. このフォルダ内のファイルを GitHub の wakasagi-companion へ上書きアップロード。
2. 1〜2分待つ。
3. https://ko-ki-m.github.io/wakasagi-companion/force-v1184.html を開く。
