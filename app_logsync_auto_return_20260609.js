(function(){
  'use strict';

  const INSTALL_FLAG = '__wakasagiLogsyncAutoReturn20260609Installed';
  if(window[INSTALL_FLAG]) return;
  window[INSTALL_FLAG] = true;

  const DB_NAME = 'wakasagi_trip_map_v10';
  const STORE_TRIPS = 'trip_records';

  function s(v){
    return String(v == null ? '' : v).trim();
  }

  function n(v){
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  }

  function decodePayload(){
    try{
      if(typeof window.v112_decodeLogSyncPayload === 'function'){
        return window.v112_decodeLogSyncPayload();
      }
    }catch(e){}

    try{
      const h = String(location.hash || '');
      if(!h.startsWith('#logsync=')) return null;
      const raw = decodeURIComponent(h.substring('#logsync='.length));
      const json = decodeURIComponent(escape(atob(raw)));
      return JSON.parse(json);
    }catch(e){
      return null;
    }
  }

  function isAutoReturnPayload(p){
    return !!(p && Number(p.auto_logsync || 0) === 1 && s(p.auto_return_url));
  }

  function safeReturnUrl(url){
    const u = s(url);
    if(!u) return '';
    try{
      const x = new URL(u);
      if(x.protocol !== 'http:') return '';
      if(x.pathname !== '/log') return '';
      return x.origin + '/log';
    }catch(e){
      return '';
    }
  }

  function setStatus(text, cls){
    try{
      if(typeof window.v112_setLogSync === 'function'){
        window.v112_setLogSync(text, cls || '');
        return;
      }
    }catch(e){}
    try{
      const st = document.getElementById('logSyncStatus');
      const bg = document.getElementById('logSyncBadge');
      if(st) st.textContent = text;
      if(bg){
        bg.textContent = text.length > 12 ? (cls === 'good' ? '同期済み' : '確認中') : text;
        bg.className = 'pill ' + (cls || '');
      }
    }catch(e){}
  }

  function visitKeysFromPayload(p){
    const out = [];
    const arr = Array.isArray(p && p.gps_visit_candidates) ? p.gps_visit_candidates : [];
    for(const v of arr){
      const k = s(v && (v.gps_visit_id || v.visit_id));
      if(k) out.push(k);
    }
    return out;
  }

  function tripHasVisitKey(t, key){
    if(!t || !key) return false;
    if(s(t.gps_visit_id) === key) return true;
    if(t.pico_summary && s(t.pico_summary.gps_visit_id) === key) return true;
    if(Array.isArray(t.pico_logs) && t.pico_logs.some(l => s(l && l.gps_visit_id) === key)) return true;
    return false;
  }

  function tripMatchesSinglePayload(t, p){
    if(!t || !p) return false;
    const sid = s(p.sid);
    const pointKey = s(p.point_visit_id || p.map_point_key);
    if(pointKey){
      if(s(t.point_visit_id) === pointKey) return true;
      if(s(t.map_point_key) === pointKey) return true;
      if(t.pico_summary && s(t.pico_summary.point_visit_id || t.pico_summary.map_point_key) === pointKey) return true;
      if(Array.isArray(t.pico_logs) && t.pico_logs.some(l => s(l && (l.point_visit_id || l.map_point_key)) === pointKey)) return true;
    }
    if(sid){
      if(s(t.pico_sid) === sid) return true;
      if(t.pico_summary && s(t.pico_summary.sid) === sid) return true;
      if(Array.isArray(t.pico_logs) && t.pico_logs.some(l => s(l && l.sid) === sid)) return true;
    }
    return false;
  }

  async function readTrips(){
    try{
      if(typeof window.getAllTrips === 'function'){
        return await window.getAllTrips();
      }
    }catch(e){}

    return await new Promise(resolve=>{
      try{
        const req = indexedDB.open(DB_NAME, 1);
        req.onsuccess = ()=>{
          const db = req.result;
          if(!db.objectStoreNames.contains(STORE_TRIPS)){
            try{ db.close(); }catch(e){}
            resolve([]);
            return;
          }
          const r = db.transaction(STORE_TRIPS, 'readonly').objectStore(STORE_TRIPS).getAll();
          r.onsuccess = ()=>{
            try{ db.close(); }catch(e){}
            resolve(r.result || []);
          };
          r.onerror = ()=>{
            try{ db.close(); }catch(e){}
            resolve([]);
          };
        };
        req.onerror = ()=>resolve([]);
      }catch(e){
        resolve([]);
      }
    });
  }

  async function isPayloadSaved(p){
    const trips = await readTrips();
    const visitKeys = visitKeysFromPayload(p);
    if(visitKeys.length){
      return visitKeys.every(k => trips.some(t => tripHasVisitKey(t, k)));
    }
    return trips.some(t => tripMatchesSinglePayload(t, p));
  }

  async function waitForSave(p){
    for(let i=0; i<24; i++){
      if(await isPayloadSaved(p)) return true;
      await new Promise(resolve=>setTimeout(resolve, 500));
    }
    return false;
  }

  async function run(){
    const p = decodePayload();
    if(!isAutoReturnPayload(p)) return;

    const back = safeReturnUrl(p.auto_return_url);
    if(!back) return;

    setStatus('自動保存確認中', 'warn');
    const saved = await waitForSave(p);
    if(saved){
      setStatus('自動保存済み', 'good');
    }else{
      setStatus('保存確認未完了', 'warn');
    }

    setTimeout(()=>{
      location.href = back;
    }, 500);
  }

  window.addEventListener('load', ()=>setTimeout(run, 2600));
})();
