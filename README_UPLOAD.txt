アップロード内容

GitHubリポジトリのトップ階層に lake_autofill.js を上書きアップロードしてください。

対象:
  /wakasagi-companion/lake_autofill.js

触らない:
  index.html
  app.js
  viewer/
  Pico Wスケッチ

修正点:
  1. ライン・シンカーで「未登録」「取得不可」「0」「0.0」を実値扱いしない
  2. 過去履歴から継承するときも「未登録」を候補から除外する
  3. 既に未登録になってしまった過去履歴も、実値が見つかれば置き換える
  4. line_no / line / lineNo / pe_no など複数のキーからラインを拾う
  5. sinker_g / sinker / weight_g / omori_g など複数のキーからシンカーを拾う
  6. 水深・湖名・天気・風・回数修正は維持する

重要:
  実値が見つかる場合は未登録を残しません。
  本当にどこにも情報が無い場合だけ未登録になります。
