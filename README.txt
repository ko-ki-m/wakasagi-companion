Wakasagi Map v11.8.4 TARGETED FIX

修正対象:
1. ポイントタップ後の日付ボタンを押しても詳細が出ない問題。
   原因: window.wakasagiPopupTrip を呼んでいたが、関数定義が無かった。
   修正: window.wakasagiPopupTrip / window.wakasagiPopupBack を追加。

2. /log から map へ戻った後、本体ログへ連携が未連携のまま残る問題。
   原因: logsync成功後に linkBadge/linkStatus/autoLinkBadge を更新していなかった。
   修正: receiveLogSync 成功時に下の「本体ログへ連携」欄も連携済みに更新。

3. logsyncデコードの堅牢化。
   JSON / base64 / base64url を読む。

Pico Wスケッチは触らない。
確認URL:
https://ko-ki-m.github.io/wakasagi-companion/force-v1184.html
