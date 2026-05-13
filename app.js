'use strict';
/*
  RESTORE + PIN COUNT FIX
  - Load the last known working root app.js at commit 626b19a.
  - Do not use mapsync_topfields_fix_*.js.
  - Only change #logsync destination selection:
    Same sid => update the same trip.
    Different sid => create a new trip, even at the same location.
*/
(function(){
  const BASE_APP_URL = 'https://cdn.jsdelivr.net/gh/ko-ki-m/wakasagi-companion@626b19a/app.js';

  try{
    const xhr = new XMLHttpRequest();
    xhr.open('GET', BASE_APP_URL + '?v=restore626b19a_pinfix_20260513', false);
    xhr.send(null);

    if(xhr.status < 200 || xhr.status >= 300){
      throw new Error('restore base app.js load failed: HTTP ' + xhr.status);
    }

    (0, eval)(xhr.responseText + '\n//# sourceURL=wakasagi-companion-restore-626b19a.js');

    // Override inside the same global script environment.
    // The original 626b19a logic merges #logsync into an existing trip within 20m.
    // That makes the marker number stay at 1 for repeated trips at the same point.
    // This replacement only reuses a trip when the same Pico W sid already exists.
    (0, eval)(String.raw`
async function v112_findTripForLogSync(p){
  const trips = await getAllTrips();
  const sid = String(p && p.sid || '').trim();

  if(!sid) return null;

  for(const t of trips){
    if(String(t && t.sid || '').trim() === sid) return t;

    if(t && t.pico_summary && String(t.pico_summary.sid || '').trim() === sid) return t;

    if(Array.isArray(t && t.pico_logs)){
      for(const l of t.pico_logs){
        if(String(l && l.sid || '').trim() === sid) return t;
      }
    }
  }

  return null;
}
//# sourceURL=wakasagi-companion-pin-count-fix.js
`);

    console.log('wakasagi restore 626b19a + pin count fix loaded');
  }catch(e){
    console.error(e);
    window.addEventListener('load', function(){
      const el = document.getElementById('locStatus') || document.body;
      if(el) el.textContent = 'app.js復旧読込エラー: ' + (e && e.message ? e.message : e);
    });
  }
})();
