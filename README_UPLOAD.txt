GitHub Pages側 修正ZIP（2026-05-13）

このZIPの中身をリポジトリ直下へアップロードしてください。

含まれるファイル:
- index.html
- mapsync_topfields_fix_20260513.js

index.html は現行GitHub上の index.html を基準に、末尾の読み込みへ次の1行だけ追加したものです。
<script src="./mapsync_topfields_fix_20260513.js?v=20260513" defer></script>

viewer/index.html と viewer/app.js は含めていません。viewer側は触りません。
