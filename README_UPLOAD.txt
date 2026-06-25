wakasagi_github_fixednav_20260625a

Upload these files to the GitHub repository root:
- index.html
- wakasagi_pico_fixed_nav_20260625a.js
- service-worker.js

Purpose:
- Current index.html shows fixed buttons fixedPicoLog/fixedPicoRemote.
- Current loaded scripts do not bind those fixed buttons.
- This patch adds a small dedicated script that binds LOGへ戻る and 操作パネルへ to the Pico host.
- It does not modify app_stage1/app_stage2/lake_autofill/gps-bridge/gps-recorder.
