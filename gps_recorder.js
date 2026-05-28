(function(){
  'use strict';

  const VERSION = 'gps_recorder_20260528l_request_runner_named_log';
  const DB_NAME = 'wakasagi_gps_recorder_v1';
  const DB_VER = 1;
  const STORE_CAND = 'gps_candidates';
  const STORE_META = 'meta';
  const MOVE_M = 10;
  const MAX_ACC_M = 35;

  const $ = id => document.getElementById(id);
  const statusEl = $('status');
  const debugEl = $('debug');
  const btnStart = $('btnStart');
  const btnStop = $('btnStop');
  const btnOne = $('btnOne');
  const btnClearSid = $('btnClearSid');
  const btnClearAll = $('btnClearAll');

  const qs = new URLSearchParams(location.search);
  let sid = String(qs.get('sid') || localStorage.getItem('wakasagi_last_sid') || '').trim();
  const pico = String(qs.get('pico') || '').trim();
  const mode = String(qs.get('mode') || '').trim();
  const allowedPicoOrigin = pico || '*';

  let db = null;
  let lastCandidate = null;
  let sampleCount = 0;
  let requestCount = 0;
  let busy = false;

  function setStatus(text, cls){
    if(statusEl){
      statusEl.textContent = text;
      statusEl.className = 'status ' + (cls || '');
    }
  }

  function dbg(obj){
    if(!debugEl) return;
    debugEl.textContent = JSON.stringify(Object.assign({
      version: VERSION,
      sid: sid,
      pico: pico,
      mode: mode,
      sampleCount: sampleCount,
      requestCount: requestCount,
      behavior: 'request_only_one_shot_named_log',
      auto_timer: false,
      autostart: false,
      watchPosition: false,
      trip_records_write: false,
      pico_write: false
    }, obj || {}), null, 2);
  }

  function now(){ return Date.now(); }
  function toRad(v){ return Number(v) * Math.PI / 180; }

  function distM(lat1, lng1, lat2, lng2){
    const a1 = Number(lat1), o1 = Number(lng1), a2 = Number(lat2), o2 = Number(lng2);
    if(!Number.isFinite(a1) || !Number.isFinite(o1) || !Number.isFinite(a2) || !Number.isFinite(o2)) return null;
    const R = 6371000;
    const dLat = toRad(a2 - a1);
    const dLng = toRad(o2 - o1);
    const s1 = Math.sin(dLat / 2);
    const s2 = Math.sin(dLng / 2);
    const x = s1 * s1 + Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * s2 * s2;
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function idFor(no){
    return String(sid || 'nosid') + '_G' + String(no).padStart(4, '0');
  }

  function openDb(){
    return new Promise((resolve, reject)=>{
      if(!('indexedDB' in window)){
        reject(new Error('IndexedDB unsupported'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = ev => {
        const d = ev.target.result;
        if(!d.objectStoreNames.contains(STORE_CAND)){
          const st = d.createObjectStore(STORE_CAND, {keyPath:'id'});
          st.createIndex('sid_start', ['sid','start_ms'], {unique:false});
          st.createIndex('sid_no', ['sid','candidate_no'], {unique:true});
        }
        if(!d.objectStoreNames.contains(STORE_META)){
          d.createObjectStore(STORE_META, {keyPath:'key'});
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
    });
  }

  function put(store, rec){
    return new Promise(resolve=>{
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(rec);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }

  function getLatestCandidate(){
    return new Promise(resolve=>{
      if(!sid || !db){ resolve(null); return; }
      const tx = db.transaction(STORE_CAND, 'readonly');
      const st = tx.objectStore(STORE_CAND);
      const idx = st.index('sid_start');
      const range = IDBKeyRange.bound([sid,0], [sid,Number.MAX_SAFE_INTEGER]);
      const req = idx.openCursor(range, 'prev');
      req.onsuccess = ev => {
        const cur = ev.target.result;
        resolve(cur ? cur.value : null);
      };
      req.onerror = () => resolve(null);
    });
  }

  function getAllCandidates(){
    return new Promise(resolve=>{
      if(!db){ resolve([]); return; }
      try{
        const tx = db.transaction(STORE_CAND, 'readonly');
        const req = tx.objectStore(STORE_CAND).getAll();
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => resolve([]);
      }catch(e){
        resolve([]);
      }
    });
  }

  function deleteCandidatesBySid(sidTarget){
    return new Promise(resolve=>{
      if(!db || !sidTarget){ resolve(0); return; }
      let count = 0;
      try{
        const tx = db.transaction(STORE_CAND, 'readwrite');
        const req = tx.objectStore(STORE_CAND).openCursor();
        req.onsuccess = ev => {
          const cur = ev.target.result;
          if(!cur) return;
          const r = cur.value || {};
          if(String(r.sid || '') === String(sidTarget)){
            cur.delete();
            count++;
          }
          cur.continue();
        };
        tx.oncomplete = () => resolve(count);
        tx.onerror = () => resolve(count);
      }catch(e){
        resolve(count);
      }
    });
  }

  function deleteAllCandidates(){
    return new Promise(resolve=>{
      if(!db){ resolve(false); return; }
      try{
        const tx = db.transaction(STORE_CAND, 'readwrite');
        tx.objectStore(STORE_CAND).clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      }catch(e){
        resolve(false);
      }
    });
  }

  async function refreshDebugAfterDelete(note){
    lastCandidate = await getLatestCandidate();
    const all = await getAllCandidates();
    dbg({ready:true, note:note || '', remaining_all:all.length, lastCandidate:lastCandidate});
  }

  async function clearCurrentSidCandidates(){
    if(!db) db = await openDb();
    if(!sid){
      setStatus('sidなし。削除対象を特定できません。','bad');
      dbg({error:'missing sid for delete'});
      return;
    }
    if(!confirm('このsidのGPS候補だけを削除します。\n\nsid=' + sid + '\n\nMap保存済み履歴やPico W /log側DBは削除しません。')) return;
    const count = await deleteCandidatesBySid(sid);
    setStatus('このsidのGPS候補を削除: ' + count + '件','good');
    await refreshDebugAfterDelete('deleted current sid candidates');
  }

  async function clearAllCandidates(){
    if(!db) db = await openDb();
    if(!confirm('GPS Recorder側の全GPS候補を削除します。\n\nMap保存済み履歴やPico W /log側DBは削除しません。')) return;
    const ok = await deleteAllCandidates();
    setStatus(ok ? '全GPS候補を削除しました' : '全GPS候補削除に失敗', ok ? 'good' : 'bad');
    await refreshDebugAfterDelete('deleted all recorder candidates');
  }

  function getPosition(){
    return new Promise((resolve, reject)=>{
      if(!('geolocation' in navigator)){
        reject(new Error('geolocation unsupported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      });
    });
  }

  async function commitPosition(pos, source, requestMeta){
    if(!db) db = await openDb();
    const c = pos && pos.coords ? pos.coords : {};
    const lat = Number(c.latitude);
    const lng = Number(c.longitude);
    const acc = Number(c.accuracy || 0);
    const posMs = Number(pos && pos.timestamp ? pos.timestamp : now());

    sampleCount++;

    if(!sid && requestMeta && requestMeta.sid){
      sid = String(requestMeta.sid || '').trim();
    }
    if(sid) localStorage.setItem('wakasagi_last_sid', sid);

    if(!sid){
      setStatus('sidなし。/logからsid付きで開く必要があります。','bad');
      dbg({error:'missing sid'});
      return {ok:false,error:'missing_sid'};
    }

    if(!Number.isFinite(lat) || !Number.isFinite(lng)){
      setStatus('GPS値が不正です','bad');
      dbg({error:'invalid lat/lng'});
      return {ok:false,error:'invalid_latlng'};
    }

    if(Number.isFinite(acc) && acc > MAX_ACC_M){
      setStatus('GPS精度不足: ' + acc.toFixed(1) + 'm','warn');
      dbg({lat:lat.toFixed(7), lng:lng.toFixed(7), acc_m:acc.toFixed(1), rejected:'accuracy'});
      return {ok:false,error:'accuracy',lat,lng,acc_m:acc};
    }

    const latest = lastCandidate || await getLatestCandidate();
    let d = null;
    if(latest){
      d = distM(latest.latest_lat || latest.lat, latest.latest_lng || latest.lng, lat, lng);
    }

    let rec;
    if(!latest || d === null || d >= MOVE_M){
      const no = latest ? Number(latest.candidate_no || 0) + 1 : 1;
      rec = {
        id: idFor(no),
        sid: sid || 'nosid',
        pico: pico,
        candidate_no: no,
        start_ms: now(),
        end_ms: now(),
        lat: lat.toFixed(7),
        lng: lng.toFixed(7),
        latest_lat: lat.toFixed(7),
        latest_lng: lng.toFixed(7),
        acc_m: Number.isFinite(acc) ? acc.toFixed(1) : '',
        best_acc_m: Number.isFinite(acc) ? acc.toFixed(1) : '',
        sample_count: 1,
        moved_from_prev_m: d !== null && Number.isFinite(d) ? d.toFixed(1) : '',
        pos_ms: posMs,
        source: source || VERSION,
        request_id: requestMeta && requestMeta.request_id ? String(requestMeta.request_id) : '',
        request_reason: requestMeta && requestMeta.reason ? String(requestMeta.reason) : '',
        request_seq: requestMeta && requestMeta.seq ? Number(requestMeta.seq) : 0,
        request_t_ms: requestMeta && requestMeta.t_ms ? Number(requestMeta.t_ms) : 0,
        phone_request_ms: requestMeta && requestMeta.phone_request_ms ? Number(requestMeta.phone_request_ms) : 0,
        created_ms: now(),
        updated_ms: now(),
        status: 'candidate_only_not_visit'
      };
      setStatus('GPS候補保存: G' + no,'good');
    }else{
      rec = Object.assign({}, latest);
      rec.end_ms = now();
      rec.latest_lat = lat.toFixed(7);
      rec.latest_lng = lng.toFixed(7);
      rec.sample_count = Number(rec.sample_count || 0) + 1;
      rec.updated_ms = now();
      rec.pos_ms = posMs;
      rec.request_id = requestMeta && requestMeta.request_id ? String(requestMeta.request_id) : String(rec.request_id || '');
      rec.request_reason = requestMeta && requestMeta.reason ? String(requestMeta.reason) : String(rec.request_reason || '');
      rec.request_seq = requestMeta && requestMeta.seq ? Number(requestMeta.seq) : Number(rec.request_seq || 0);
      rec.request_t_ms = requestMeta && requestMeta.t_ms ? Number(requestMeta.t_ms) : Number(rec.request_t_ms || 0);
      rec.phone_request_ms = requestMeta && requestMeta.phone_request_ms ? Number(requestMeta.phone_request_ms) : Number(rec.phone_request_ms || 0);
      const prevBest = Number(rec.best_acc_m || rec.acc_m || 999999);
      if(Number.isFinite(acc) && acc < prevBest){
        rec.best_acc_m = acc.toFixed(1);
        rec.acc_m = acc.toFixed(1);
      }
      setStatus('GPS候補更新: G' + String(rec.candidate_no || ''),'good');
    }

    const ok = await put(STORE_CAND, rec);
    if(ok) lastCandidate = rec;

    const result = {
      ok: !!ok,
      sid: sid,
      candidate_no: rec.candidate_no,
      lat: lat.toFixed(7),
      lng: lng.toFixed(7),
      acc_m: Number.isFinite(acc) ? acc.toFixed(1) : '',
      moved_from_prev_m: d !== null && Number.isFinite(d) ? d.toFixed(1) : '',
      pos_ms: posMs,
      saved_ms: now(),
      record_id: rec.id,
      source: source || VERSION,
      request_id: requestMeta && requestMeta.request_id ? String(requestMeta.request_id) : ''
    };
    dbg(Object.assign({
      saved: ok,
      note: '要求時だけ1回取得。定期取得・autostart・watchPositionはありません。'
    }, result));
    return result;
  }

  async function sampleOnce(source, requestMeta){
    if(busy){ return {ok:false,error:'busy'}; }
    busy = true;
    try{
      if(!db) db = await openDb();
      if(requestMeta && requestMeta.sid){
        sid = String(requestMeta.sid || '').trim();
      }
      if(!sid){
        setStatus('sidなし。/logからsid付きで開く必要があります。','bad');
        dbg({error:'missing sid'});
        return {ok:false,error:'missing_sid'};
      }
      setStatus('GPS取得中...','warn');
      const pos = await getPosition();
      return await commitPosition(pos, source || 'button_once', requestMeta || {});
    }catch(e){
      setStatus('GPS取得失敗','bad');
      dbg({error:String(e && e.message || e), requestMeta:requestMeta || null});
      return {ok:false,error:String(e && e.message || e)};
    }finally{
      busy = false;
    }
  }

  function stop(){
    setStatus('待機中。定期取得はありません。','warn');
    dbg({stopped:true});
  }

  function allowedOriginForReply(fallbackOrigin){
    return allowedPicoOrigin === '*' ? (fallbackOrigin || '*') : allowedPicoOrigin;
  }

  function postToLogWindow(msg, fallbackOrigin){
    const targetOrigin = allowedOriginForReply(fallbackOrigin);
    let sent = false;
    try{
      if(window.opener && !window.opener.closed && window.opener.postMessage){
        window.opener.postMessage(msg, targetOrigin);
        sent = true;
      }
    }catch(e){}

    if(!sent){
      try{
        const w = window.open('', 'wakasagi_log');
        if(w && w.postMessage){
          w.postMessage(msg, targetOrigin);
          sent = true;
        }
      }catch(e){}
    }

    return sent;
  }

  async function handleRequestMessage(ev){
    const data = ev && ev.data ? ev.data : null;
    if(!data || data.type !== 'wakasagi:gps-request') return;

    requestCount++;

    const originOk = allowedPicoOrigin === '*' || String(ev.origin || '') === String(allowedPicoOrigin || '');
    if(!originOk){
      dbg({rejected:'origin', origin:ev.origin, allowedPicoOrigin:allowedPicoOrigin});
      return;
    }

    const meta = {
      sid: String(data.sid || sid || '').trim(),
      reason: String(data.reason || 'log_request'),
      request_id: String(data.request_id || ('REQ_' + Date.now().toString(36))),
      seq: Number(data.seq || 0),
      t_ms: Number(data.t_ms || 0),
      phone_request_ms: now()
    };

    setStatus('GPS要求受信: ' + meta.reason, 'warn');
    const result = await sampleOnce('log_request', meta);
    const reply = Object.assign({type:'wakasagi:gps-result'}, meta, result || {});

    try{
      if(ev.source && ev.source.postMessage){
        ev.source.postMessage(reply, ev.origin || '*');
        return;
      }
    }catch(e){}

    postToLogWindow(reply, ev.origin || '*');
  }

  if(btnStart) btnStart.onclick = () => sampleOnce('button_once', {reason:'button_start'});
  if(btnOne) btnOne.onclick = () => sampleOnce('button_once', {reason:'button_one'});
  if(btnStop) btnStop.onclick = stop;
  if(btnClearSid) btnClearSid.onclick = clearCurrentSidCandidates;
  if(btnClearAll) btnClearAll.onclick = clearAllCandidates;

  window.addEventListener('message', handleRequestMessage);

  (async()=>{
    try{
      db = await openDb();
      lastCandidate = await getLatestCandidate();
    }catch(e){
      setStatus('DB初期化失敗','bad');
      dbg({error:String(e && e.message || e)});
      return;
    }
    setStatus('待機中。/logからのGPS要求、またはボタンで1回取得します。','good');
    dbg({ready:true, lastCandidate:lastCandidate});
    postToLogWindow({type:'wakasagi:gps-recorder-ready', sid:sid, version:VERSION}, allowedPicoOrigin === '*' ? '*' : allowedPicoOrigin);
  })();
})();
