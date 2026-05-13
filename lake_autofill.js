/*
  Wakasagi companion lake_autofill.js
  Damage repair fixed version: 2026-05-13

  目的:
    - こちらが誤って入れた line_no / sinker_g の「未登録」保存を止める。
    - 既に保存済みの line_no / sinker_g = 未登録 を削除、または正規キーの実値で復旧する。
    - ライン・シンカーは正規キー line_no / sinker_g だけを扱う。
    - 推測キー探索や推測補完はしない。
    - #logsync 初回保存で map_spot_id の過去地点へ上書き統合しない修正は維持する。
    - 既存 app.js / viewer / Pico Wスケッチは触らない。
*/
(function(){
  'use strict';

  const INSTALL_FLAG = '__wakasagiDamageRepairLineSinker20260513Installed';
  if(window[INSTALL_FLAG]) return;
  window[INSTALL_FLAG] = true;

  const DB_NAME = 'wakasagi_trip_map_v10';
  const STORE_TRIPS = 'trip_records';

  function text(v){
    return String(v == null ? '' : v).trim();
  }

  function isBadLineSinkerValue(v){
    const s = text(v);
    const n = s
      .replace(/[　\s]/g, '')
      .replace(/[－ー―—]/g, '-')
      .toLowerCase();

    return !n ||
      n === '未登録' ||
      n === '未設定' ||
      n === '未入力' ||
      n === '不明' ||
      n === 'なし' ||
      n === '取得不可' ||
      n === '-' ||
      n === '--' ||
      n === '0' ||
      n === '0.0' ||
      n === 'na' ||
      n === 'n/a' ||
      n === 'null' ||
      n === 'undefined';
  }

  function realLine(v){
    return isBadLineSinkerValue(v) ? '' : text(v);
  }

  function realSinker(v){
    return isBadLineSinkerValue(v) ? '' : text(v);
  }

  function sameSid(t, sid){
    sid = text(sid);
    if(!sid || !t) return false;

    if(text(t.sid) === sid) return true;
    if(text(t.pico_sid) === sid) return true;
    if(t.pico_summary && text(t.pico_summary.sid) === sid) return true;

    if(Array.isArray(t.pico_logs)){
      return t.pico_logs.some(x => x && text(x.sid) === sid);
    }

    return false;
  }

  function lineFromExactKeys(obj){
    if(!obj || typeof obj !== 'object') return '';

    const direct = realLine(obj.line_no);
    if(direct) return direct;

    if(obj.pico_summary && typeof obj.pico_summary === 'object'){
      const v = realLine(obj.pico_summary.line_no);
      if(v) return v;
    }

    if(Array.isArray(obj.pico_logs)){
      for(const x of obj.pico_logs){
        if(x && typeof x === 'object'){
          const v = realLine(x.line_no);
          if(v) return v;
        }
      }
    }

    return '';
  }

  function sinkerFromExactKeys(obj){
    if(!obj || typeof obj !== 'object') return '';

    const direct = realSinker(obj.sinker_g);
    if(direct) return direct;

    if(obj.pico_summary && typeof obj.pico_summary === 'object'){
      const v = realSinker(obj.pico_summary.sinker_g);
      if(v) return v;
    }

    if(Array.isArray(obj.pico_logs)){
      for(const x of obj.pico_logs){
        if(x && typeof x === 'object'){
          const v = realSinker(x.sinker_g);
          if(v) return v;
        }
      }
    }

    return '';
  }

  function sanitizeLineSinkerOnObject(t, payload){
    if(!t || typeof t !== 'object') return false;

    let changed = false;

    const currentLine = realLine(t.line_no);
    const currentSinker = realSinker(t.sinker_g);

    if(!currentLine){
      const fromPayload = lineFromExactKeys(payload);
      const fromSelf = lineFromExactKeys(t);
      const v = fromPayload || fromSelf;

      if(v){
        if(t.line_no !== v){
          t.line_no = v;
          changed = true;
        }
      }else if(text(t.line_no)){
        delete t.line_no;
        changed = true;
      }
    }

    if(!currentSinker){
      const fromPayload = sinkerFromExactKeys(payload);
      const fromSelf = sinkerFromExactKeys(t);
      const v = fromPayload || fromSelf;

      if(v){
        if(t.sinker_g !== v){
          t.sinker_g = v;
          changed = true;
        }
      }else if(text(t.sinker_g)){
        delete t.sinker_g;
        changed = true;
      }
    }

    return changed;
  }

  function cleanPayload(p){
    if(!p || typeof p !== 'object') return p;

    const line = realLine(p.line_no);
    if(line) p.line_no = line;
    else delete p.line_no;

    const sinker = realSinker(p.sinker_g);
    if(sinker) p.sinker_g = sinker;
    else delete p.sinker_g;

    return p;
  }

  function openTripDbDirect(){
    return new Promise((resolve, reject) => {
      try{
        const req = indexedDB.open(DB_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
      }catch(e){
        reject(e);
      }
    });
  }

  function getAllTripsDirect(db){
    return new Promise((resolve) => {
      try{
        if(!db || !db.objectStoreNames.contains(STORE_TRIPS)){
          resolve([]);
          return;
        }
        const tx = db.transaction(STORE_TRIPS, 'readonly');
        const req = tx.objectStore(STORE_TRIPS).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      }catch(e){
        resolve([]);
      }
    });
  }

  function putTripDirect(db, t){
    return new Promise((resolve) => {
      try{
        const tx = db.transaction(STORE_TRIPS, 'readwrite');
        tx.objectStore(STORE_TRIPS).put(t);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      }catch(e){
        resolve(false);
      }
    });
  }

  async function repairSavedLineSinker(payload){
    let db = null;

    try{
      db = await openTripDbDirect();
      const rows = await getAllTripsDirect(db);
      let fixed = 0;

      for(const t of rows){
        if(!t || typeof t !== 'object') continue;

        const usePayload = payload && sameSid(t, payload.sid) ? payload : null;
        const before = JSON.stringify({
          line_no: t.line_no,
          sinker_g: t.sinker_g
        });

        const changed = sanitizeLineSinkerOnObject(t, usePayload);

        const after = JSON.stringify({
          line_no: t.line_no,
          sinker_g: t.sinker_g
        });

        if(changed && before !== after){
          t.updated_ms = Date.now();
          if(await putTripDirect(db, t)) fixed++;
        }
      }

      if(fixed){
        console.info('[wakasagi] repaired line_no / sinker_g damage:', fixed);
      }
    }catch(e){
      console.warn('[wakasagi] repairSavedLineSinker skipped:', e);
    }finally{
      try{ if(db) db.close(); }catch(e){}
    }
  }

  async function getAllTripsSafe(){
    try{
      if(typeof window.getAllTrips === 'function'){
        const rows = await window.getAllTrips();
        if(Array.isArray(rows)) return rows;
      }
    }catch(e){}

    let db = null;
    try{
      db = await openTripDbDirect();
      return await getAllTripsDirect(db);
    }catch(e){
      return [];
    }finally{
      try{ if(db) db.close(); }catch(e){}
    }
  }

  function installFindTripFix(){
    try{
      if(typeof window.v112_findTripForLogSync !== 'function') return false;
      if(window.__wakasagiFindTripFixNoMapSpot20260513) return true;

      window.__wakasagiFindTripFixNoMapSpot20260513 = true;

      window.v112_findTripForLogSync = async function(p){
        const rows = await getAllTripsSafe();
        const sid = text(p && p.sid);

        if(sid){
          const found = rows.find(t => sameSid(t, sid));
          if(found) return found;
        }

        // map_spot_id は「連携元の過去地点」であり、今回釣行の保存先ではない。
        // 初回logsyncは新規釣行として保存させる。
        return null;
      };

      return true;
    }catch(e){
      console.warn('[wakasagi] installFindTripFix failed:', e);
      return false;
    }
  }

  function installApplyWrapper(){
    try{
      if(typeof window.v112_applyLogSyncPayload !== 'function') return false;
      if(window.__wakasagiApplyWrapperCleanLineSinker20260513) return true;

      const original = window.v112_applyLogSyncPayload;
      window.__wakasagiApplyWrapperCleanLineSinker20260513 = true;

      window.v112_applyLogSyncPayload = async function(p){
        cleanPayload(p);

        const ok = await original.call(this, p);

        // app.js保存後に、同sidの「未登録」を正規値で復旧、または消す。
        setTimeout(() => repairSavedLineSinker(p), 200);
        setTimeout(() => repairSavedLineSinker(p), 1600);

        return ok;
      };

      return true;
    }catch(e){
      console.warn('[wakasagi] installApplyWrapper failed:', e);
      return false;
    }
  }

  function installPutTripWrapper(){
    try{
      if(typeof window.putTrip !== 'function') return false;
      if(window.__wakasagiPutTripCleanLineSinker20260513) return true;

      const original = window.putTrip;
      window.__wakasagiPutTripCleanLineSinker20260513 = true;

      window.putTrip = async function(t){
        try{
          sanitizeLineSinkerOnObject(t, null);
        }catch(e){
          console.warn('[wakasagi] putTrip line/sinker cleanup skipped:', e);
        }

        return await original.call(this, t);
      };

      return true;
    }catch(e){
      console.warn('[wakasagi] installPutTripWrapper failed:', e);
      return false;
    }
  }

  function retryInstall(){
    let n = 0;

    const timer = setInterval(() => {
      n++;

      installFindTripFix();
      installApplyWrapper();
      installPutTripWrapper();

      if(n === 3 || n === 10 || n === 25){
        repairSavedLineSinker(null);
      }

      if(n > 40){
        clearInterval(timer);
      }
    }, 250);
  }

  retryInstall();

  setTimeout(() => repairSavedLineSinker(null), 1200);
  setTimeout(() => repairSavedLineSinker(null), 5000);

  window.__wakasagiLakeAutofill = {
    version: 'damage-repair-line-sinker-no-unregistered-20260513',
    repairSavedLineSinker,
    cleanPayload
  };
})();
