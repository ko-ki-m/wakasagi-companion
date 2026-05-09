Wakasagi Map v11.8.4 RETURN TO PREVIOUS DISPLAY

目的:
- 前スレッドで正常表示されていたv11.8.4の構造へ戻す。
- 数字ピンをタップすると、その場所の過去釣行日だけをポップアップ表示する。
- 日付をタップすると、その釣行回の詳細を表示する。
- 地図タイル散乱を防ぐため、Leaflet CSSの最低限フォールバックをstyle-v1184.cssに追加。
- /log と map の無限往復を防ぐため autolink=1 は引き継がない。
- Pico Wスケッチ、sid、FISH、TelemetryLogEntry、tlog_tick は触らない。

確認:
https://ko-ki-m.github.io/wakasagi-companion/force-v1184.html
