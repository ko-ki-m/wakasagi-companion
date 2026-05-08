Wakasagi Map v11 log-link

目的:
- 地図アプリ単体で釣行開始・sid作成・FISH記録をしない。
- 下部の手入力欄を通常画面から隠す。
- 選択地点または現在地を Pico W /log#maplink=... へ渡す。
- Pico W /log 側の追加JSが現在sidへ地点情報を保存する。

GitHub Pages更新:
1. このフォルダの全ファイルで既存ファイルを上書き
2. reset.html を1回開く
3. 画面上部が Wakasagi Map v11 になっていることを確認

Pico W側:
READMEだけでは完了しません。ChatGPTが提示する /log JS 追加差分を入れてください。


v11.1:
- /log や /remote から ?pico=http://PicoW_IP を付けて開かれた場合、自動でPico W IP欄へ保存する。
- これにより、操作パネル/ログページから地図を開き、そのまま本体ログ連携へ戻れる。


v11.2:
- Pico W /log から #logsync=... で戻ってきたログ要約を受け取る。
- 既存の地点または20m以内の地点にPico Wログ要約を統合する。
- 選択した釣行詳細内に FISH / MARK / ログ数 / seq / 時間 / 深度 / 誘い / 速度を表示する。
