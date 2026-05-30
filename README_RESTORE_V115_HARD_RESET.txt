Wakasagi Map v11.5 hard reset root files

This ZIP intentionally contains only cache/service-worker reset files.
It does NOT restore app.js/index.html.
Upload these files to the repository root, then open:
https://ko-ki-m.github.io/wakasagi-companion/force-restore-v115.html

Purpose:
- unregister existing service worker
- delete browser caches
- stop GitHub Pages from being served through a stale/broken service worker
