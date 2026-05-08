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
