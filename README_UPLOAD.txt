# wakasagi GitHub Pages mapsync fix 20260513C

Upload/overwrite these files at repository root:

- index.html
- mapsync_topfields_fix_20260513C.js

Do not touch viewer/index.html or viewer/app.js.
Do not touch app.js or lake_autofill.js for this patch.

After upload, confirm that published index.html contains:
<script src="./mapsync_topfields_fix_20260513C.js?v=20260513C" defer></script>

This GitHub-side patch only copies fields that are present in #logsync payload or already stored pico_summary/pico_logs. The Pico W .ino patch is required to put line_no/sinker_g/fishfinder_depth_m into the payload from logs.
