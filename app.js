'use strict';
/*
  RESTORE ONLY: load the last known working root app.js at commit 626b19a.
  No mapsync fixes. No overrides. No extra patch code.
*/
(function(){
  const BASE_APP_URL = 'https://cdn.jsdelivr.net/gh/ko-ki-m/wakasagi-companion@626b19a/app.js';
  try{
    const xhr = new XMLHttpRequest();
    xhr.open('GET', BASE_APP_URL + '?v=restore626b19a', false);
    xhr.send(null);
    if(xhr.status < 200 || xhr.status >= 300){
      throw new Error('restore base app.js load failed: HTTP ' + xhr.status);
    }
    (0, eval)(xhr.responseText + '\n//# sourceURL=wakasagi-companion-restore-626b19a.js');
  }catch(e){
    console.error(e);
    window.addEventListener('load', function(){
      const el = document.getElementById('locStatus') || document.body;
      if(el) el.textContent = 'app.js復旧読込エラー: ' + (e && e.message ? e.message : e);
    });
  }
})();
