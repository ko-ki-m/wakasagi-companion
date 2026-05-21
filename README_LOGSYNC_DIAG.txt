# wakasagi_logsync_diag_patch_v20260521d1

目的:
Pico W /log から GitHub Map へ戻った時の #logsync 処理について、保存処理の途中経過を画面上で確認するための診断追加です。

今回の変更範囲:
- index.html
  - 既存の app_pre_stage1_rollback.js の後、lake_autofill.js の前に logsync_diag_patch.js を1行追加。
- logsync_diag_patch.js
  - v112_applyLogSyncPayload / v112_findTripForLogSync / putTrip を実行時にラップして、診断表示を出す。

触っていないもの:
- app_pre_stage1_rollback.js
- service-worker.js
- lake_autofill.js
- viewer/
- Pico W .ino
- 本体制御
- スイッチ
- 誘い
- TelemetryLogEntry
- detectA
- pulseCount
- DB名 / store名
- place / visit 設計

重要:
このZIPは完成版Map改造ではありません。
保存ロジックを変更せず、#logsync の受信payload、保存前の既存検索予測、v112_findTripForLogSync結果、putTrip書き込み候補、保存後tripを表示するための診断です。

アップロードするファイル:
- index.html
- logsync_diag_patch.js

アップロードしないファイル:
- service-worker.js は絶対に含めていません。
- app_pre_stage1_rollback.js も含めていません。

確認手順:
1. ZIP内の index.html と logsync_diag_patch.js を GitHub リポジトリのルートへアップロードして上書き/追加する。
2. GitHub Pages のトップを開く。
3. 「Pico Wログ要約」の下に「logsync診断表示」が出ることを確認する。
4. Pico W /log → 釣行マップ の流れで戻る。
5. 診断表示に以下が出ることを確認する。
   - 受信payload要点
   - 保存前の既存検索予測
   - v112_findTripForLogSync 結果
   - putTrip 書き込み候補
   - 保存後に見つかったtrip

戻し方:
復旧用ZIP wakasagi_restore_pre_v12_two_files.zip で app_pre_stage1_rollback.js と service-worker.js を戻す作業とは別です。
今回戻す場合は、index.html だけを元の状態へ戻す、または index.html から logsync_diag_patch.js のscript行を外してください。
logsync_diag_patch.js は残っていても、index.htmlから読まなければ動きません。

チェック済み:
- logsync_diag_patch.js は node --check で構文確認済み。
- index.html のscript順は app_pre_stage1_rollback.js → logsync_diag_patch.js → lake_autofill.js。
- ZIPに service-worker.js は含めていない。
- ZIPに app_pre_stage1_rollback.js は含めていない。
