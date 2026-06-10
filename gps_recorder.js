(function(){
  'use strict';

  const VERSION = 'gps_recorder_20260531s_no_acc_reject_logsync_trip_records_20260610a';

  const DB_NAME = 'wakasagi_gps_recorder_v1';
  const DB_VER = 1;
  const STORE_CAND = 'gps_candidates';
  const STORE_META = 'meta';

  const TRIP_DB_NAME = 'wakasagi_trip_map_v10';
  const TRIP_DB_VER = 1;
  const STORE_TRIPS = 'trip_records';

  const MOVE_M = 10;
  const GOOD_ACC_M = 9.9;

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
  let tripDb = null;
  let lastCandidate = null;
  let sampleCount = 0;
  let requestCount = 0;
  let busy = false;

  function now(){ return Date.now(); }

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
      behavior: 'request_only_one_shot_named_log_no_acc_reject',
      auto_timer: false,
      autostart: false,
      watchPosition: false,
      trip_records_write: false,
      pico_write: false,
      acc_reject: false,
      low_accuracy_saved: true
    }, obj || {}), null, 2);
  }

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

  function qualityForAcc(acc){
    if(Number.isFinite(acc) && acc <= GOOD_ACC_M){
      return {quality:'confirmed', label:'精度良好'};
    }
    return {quality:'low_accuracy', label:'精度注意'};
  }

  function s(v){ return String(v == null ? '' : v).trim(); }

  function n(v){
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  }

  function depthText(){
    let best = null;
    for(const v of arguments){
      const x = Number(v);
      if(!Number.isFinite(x) || x <= 0) continue;
      if(best === null || x > best) best = x;
    }
    return best === null ? '' : best.toFixed(3);
  }

  function genTripId(){
    return 'T_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
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

  function openTripDb(){
    return new Promise((resolve, reject)=>{
      if(tripDb){
        resolve(tripDb);
        return;
      }
      if(!('indexedDB' in window)){
        reject(new Error('IndexedDB unsupported'));
        return;
      }

      const req = indexedDB.open(TRIP_DB_NAME, TRIP_DB_VER);

      req.onupgradeneeded = ev => {
        const d = ev.target.result;
        if(!d.objectStoreNames.contains(STORE_TRIPS)){
          const st = d.createObjectStore(STORE_TRIPS, {keyPath:'trip_id'});
          st.createIndex('date_ms', 'date_ms', {unique:false});
        }
      };

      req.onsuccess = () => {
        tripDb = req.result;
        resolve(tripDb);
      };
      req.onerror = () => reject(req.error || new Error('trip db open failed'));
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

  function getAllTripRecords(){
    return new Promise(resolve=>{
      try{
        if(!tripDb || !tripDb.objectStoreNames.contains(STORE_TRIPS)){
          resolve([]);
          return;
        }
        const tx = tripDb.transaction(STORE_TRIPS, 'readonly');
        const req = tx.objectStore(STORE_TRIPS).getAll();
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => resolve([]);
      }catch(e){
        resolve([]);
      }
    });
  }

  function putTripRecord(t){
    return new Promise(resolve=>{
      try{
        if(!tripDb){
          resolve(false);
          return;
        }
        const tx = tripDb.transaction(STORE_TRIPS, 'readwrite');
        tx.objectStore(STORE_TRIPS).put(t);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      }catch(e){
        resolve(false);
      }
    });
  }

  function getLatestCandidate(){
    return new Promise(resolve=>{
      if(!sid || !db){
        resolve(null);
        return;
      }
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
      if(!db){
        resolve([]);
        return;
      }
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
      if(!db || !sidTarget){
        resolve(0);
        return;
      }
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
      if(!db){
        resolve(false);
        return;
      }
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
    const capturedMs = now();
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

    const q = qualityForAcc(acc);
    const latest = lastCandidate || await getLatestCandidate();
    let d = null;
    if(latest){
      d = distM(latest.latest_lat || latest.lat, latest.latest_lng || latest.lng, lat, lng);
    }

    const sample = {
      source: source || VERSION,
      lat: lat.toFixed(7),
      lng: lng.toFixed(7),
      acc_m: Number.isFinite(acc) ? acc.toFixed(1) : '',
      gps_quality: q.quality,
      gps_quality_label: q.label,
      pos_ms: posMs,
      saved_ms: capturedMs,
      request_id: requestMeta && requestMeta.request_id ? String(requestMeta.request_id) : '',
      request_reason: requestMeta && requestMeta.reason ? String(requestMeta.reason) : '',
      request_seq: requestMeta && requestMeta.seq ? Number(requestMeta.seq) : 0,
      request_t_ms: requestMeta && requestMeta.t_ms ? Number(requestMeta.t_ms) : 0,
      phone_request_ms: requestMeta && requestMeta.phone_request_ms ? Number(requestMeta.phone_request_ms) : 0
    };

    let rec;
    if(!latest || d === null || d >= MOVE_M){
      const no = latest ? Number(latest.candidate_no || 0) + 1 : 1;
      rec = {
        id: idFor(no),
        sid: sid || 'nosid',
        pico: pico,
        candidate_no: no,
        start_ms: capturedMs,
        end_ms: capturedMs,
        lat: lat.toFixed(7),
        lng: lng.toFixed(7),
        latest_lat: lat.toFixed(7),
        latest_lng: lng.toFixed(7),
        acc_m: Number.isFinite(acc) ? acc.toFixed(1) : '',
        best_acc_m: Number.isFinite(acc) ? acc.toFixed(1) : '',
        latest_acc_m: Number.isFinite(acc) ? acc.toFixed(1) : '',
        gps_quality: q.quality,
        gps_quality_label: q.label,
        sample_count: 1,
        moved_from_prev_m: d !== null && Number.isFinite(d) ? d.toFixed(1) : '',
        pos_ms: posMs,
        source: source || VERSION,
        latest_source: source || VERSION,
        best_source: source || VERSION,
        request_id: sample.request_id,
        request_reason: sample.request_reason,
        request_seq: sample.request_seq,
        request_t_ms: sample.request_t_ms,
        phone_request_ms: sample.phone_request_ms,
        sample_log: [sample],
        created_ms: capturedMs,
        updated_ms: capturedMs,
        status: 'candidate_only_not_visit'
      };
      setStatus('GPS候補保存: G' + no + ' / ' + q.label + ' ' + (Number.isFinite(acc) ? acc.toFixed(1) : '-') + 'm', q.quality === 'confirmed' ? 'good' : 'warn');
    }else{
      rec = Object.assign({}, latest);
      rec.end_ms = capturedMs;
      rec.latest_lat = lat.toFixed(7);
      rec.latest_lng = lng.toFixed(7);
      rec.latest_acc_m = Number.isFinite(acc) ? acc.toFixed(1) : '';
      rec.latest_source = source || VERSION;
      rec.sample_count = Number(rec.sample_count || 0) + 1;
      rec.updated_ms = capturedMs;
      rec.pos_ms = posMs;
      rec.request_id = sample.request_id || String(rec.request_id || '');
      rec.request_reason = sample.request_reason || String(rec.request_reason || '');
      rec.request_seq = sample.request_seq || Number(rec.request_seq || 0);
      rec.request_t_ms = sample.request_t_ms || Number(rec.request_t_ms || 0);
      rec.phone_request_ms = sample.phone_request_ms || Number(rec.phone_request_ms || 0);
      rec.sample_log = (Array.isArray(rec.sample_log) ? rec.sample_log : []).concat([sample]).slice(-8);
      const prevBest = Number(rec.best_acc_m || rec.acc_m || 999999);
      if(Number.isFinite(acc) && acc < prevBest){
        rec.best_acc_m = acc.toFixed(1);
        rec.acc_m = acc.toFixed(1);
        rec.lat = lat.toFixed(7);
        rec.lng = lng.toFixed(7);
        rec.best_source = source || VERSION;
        rec.gps_quality = q.quality;
        rec.gps_quality_label = q.label;
      }
      setStatus('GPS候補更新: G' + String(rec.candidate_no || '') + ' / ' + q.label + ' ' + (Number.isFinite(acc) ? acc.toFixed(1) : '-') + 'm','good');
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
      gps_quality: q.quality,
      gps_quality_label: q.label,
      moved_from_prev_m: d !== null && Number.isFinite(d) ? d.toFixed(1) : '',
      pos_ms: posMs,
      saved_ms: now(),
      record_id: rec.id,
      source: source || VERSION,
      recorder_version: VERSION,
      request_id: sample.request_id
    };

    dbg(Object.assign({
      saved: ok,
      note: '要求時だけ1回取得。定期取得・autostart・watchPositionはありません。accが悪くても保存拒否しません。'
    }, result));

    return result;
  }

  async function sampleOnce(source, requestMeta){
    if(busy){
      return {ok:false,error:'busy'};
    }
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

  function hasLatLng(p){
    return Number.isFinite(Number(p && (p.gps_lat || p.latest_lat || p.lat))) &&
           Number.isFinite(Number(p && (p.gps_lng || p.latest_lng || p.lng)));
  }

  function makePicoSummary(p){
    return {
      v:1,
      source:'pico_log',
      sid:s(p.sid),
      gps_visit_id:s(p.gps_visit_id || p.visit_id),
      point_visit_id:s(p.point_visit_id || p.map_point_key),
      map_point_key:s(p.map_point_key || p.point_visit_id),
      map_spot_id:s(p.map_spot_id || p.spot_id),
      point_start_seq:p.point_start_seq === undefined ? '' : p.point_start_seq,
      point_last_seq:p.point_last_seq === undefined ? '' : p.point_last_seq,
      start_ms:n(p.start_ms) || 0,
      updated_ms:n(p.updated_ms) || Date.now(),
      first_recv_ms:n(p.first_recv_ms) || 0,
      last_recv_ms:n(p.last_recv_ms) || 0,
      fish_count:n(p.fish_count) || 0,
      mark_count:n(p.mark_count) || 0,
      tlog_count:n(p.tlog_count) || 0,
      first_seq:p.first_seq === undefined ? '' : p.first_seq,
      last_seq:p.last_seq === undefined ? '' : p.last_seq,
      first_t_ms:p.first_t_ms === undefined ? '' : p.first_t_ms,
      last_t_ms:p.last_t_ms === undefined ? '' : p.last_t_ms,
      min_depth_m:p.min_depth_m === undefined ? '' : String(p.min_depth_m),
      max_depth_m:p.max_depth_m === undefined ? '' : String(p.max_depth_m),
      depth_source:p.depth_source === undefined ? '' : String(p.depth_source),
      depth_status:p.depth_status === undefined ? '' : String(p.depth_status),
      depth_measured:p.depth_measured === undefined ? '' : String(p.depth_measured),
      used_sasoi:p.used_sasoi === undefined ? '' : String(p.used_sasoi),
      used_speed:p.used_speed === undefined ? '' : String(p.used_speed),
      received_ms:Date.now()
    };
  }

  function mergeVisitPayload(parent, visit){
    const p = Object.assign({}, parent || {}, visit || {});
    p.__stage2_single_visit = true;
    p.sid = s((parent && parent.sid) || (visit && visit.sid));

    const fallbackKeys = [
      'lake_name','point_name','place_name','line_no','sinker_g','water_temp_c',
      'weather_text','weather','wind_dir','wind_speed_mps','wind','note','map_source'
    ];

    for(const k of fallbackKeys){
      if(!s(p[k]) && parent && parent[k] !== undefined){
        p[k] = parent[k];
      }
    }

    p.gps_visit_id = s(visit && (visit.gps_visit_id || visit.visit_id));
    p.pico_point_visit_id = s(
      (visit && visit.pico_point_visit_id) ||
      (parent && (parent.point_visit_id || parent.map_point_key || parent.pico_point_visit_id))
    );

    p.gps_lat = s((visit && (visit.gps_lat || visit.latest_lat || visit.lat)) || p.gps_lat || p.lat);
    p.gps_lng = s((visit && (visit.gps_lng || visit.latest_lng || visit.lng)) || p.gps_lng || p.lng);
    p.gps_acc_m = s((visit && (visit.gps_acc_m || visit.acc_m || visit.acc)) || p.gps_acc_m || p.acc);

    p.point_visit_id = '';
    p.map_point_key = '';

    const depth = depthText(p.fishfinder_depth_m, p.max_depth_m, p.fishfinder_m, p.water_depth_m);
    p.fishfinder_depth_m = depth;
    p.water_depth_m = depth;
    p.depth_status = depth ? 'measured' : 'not_measured';

    return p;
  }

  function splitLogsyncPayload(p){
    if(!p || p.__error) return [];

    const hasGpsCandidateSource =
      Number(p.gps_candidate_count || 0) > 0 ||
      (Array.isArray(p.gps_candidates) && p.gps_candidates.length > 0);

    if(
      p.gps_visit_judged &&
      hasGpsCandidateSource &&
      Array.isArray(p.gps_visit_candidates) &&
      !p.__stage2_single_visit
    ){
      const visits = p.gps_visit_candidates.filter(v =>
        v && s(v.gps_visit_id || v.visit_id) && hasLatLng(v)
      );

      return visits.map(v => mergeVisitPayload(p, v));
    }

    return hasLatLng(p) ? [p] : [];
  }

  async function findTripForPayload(p){
    const trips = await getAllTripRecords();

    const visitKey = s(p.gps_visit_id || p.visit_id);
    if(visitKey){
      for(const t of trips){
        if(s(t.gps_visit_id) === visitKey) return t;
        if(t.pico_summary && s(t.pico_summary.gps_visit_id) === visitKey) return t;
        if(Array.isArray(t.pico_logs) && t.pico_logs.some(l => s(l.gps_visit_id) === visitKey)) return t;
      }
      return null;
    }

    const pointKey = s(p.point_visit_id || p.map_point_key);
    if(pointKey){
      for(const t of trips){
        if(s(t.point_visit_id) === pointKey) return t;
        if(s(t.map_point_key) === pointKey) return t;
        if(t.pico_summary && s(t.pico_summary.point_visit_id || t.pico_summary.map_point_key) === pointKey) return t;
        if(Array.isArray(t.pico_logs) && t.pico_logs.some(l => s(l.point_visit_id || l.map_point_key) === pointKey)) return t;
      }
    }

    return null;
  }

  function makeTripFromPayload(p, existing){
    const nowMs = Date.now();
    const lat = Number(p.gps_lat || p.latest_lat || p.lat);
    const lng = Number(p.gps_lng || p.latest_lng || p.lng);
    const sidNow = s(p.sid);
    const visitKey = s(p.gps_visit_id || p.visit_id);
    const pointKey = s(p.point_visit_id || p.map_point_key);
    const depth = depthText(p.fishfinder_depth_m, p.max_depth_m, p.fishfinder_m, p.water_depth_m);

    const t = existing ? Object.assign({}, existing) : {
      trip_id: genTripId(),
      created_ms: nowMs,
      pico_logs: []
    };

    t.pico_sid = sidNow;

    if(visitKey){
      t.gps_visit_id = visitKey;
      t.pico_point_visit_id = s(p.pico_point_visit_id || p.point_visit_id || p.map_point_key);
      t.point_visit_id = '';
      t.map_point_key = '';
    }else{
      t.point_visit_id = s(t.point_visit_id || pointKey);
      t.map_point_key = s(t.map_point_key || pointKey);
    }

    t.map_spot_id = s(t.map_spot_id || p.map_spot_id || p.spot_id);
    t.date_ms = n(p.start_ms) || n(p.first_recv_ms) || n(p.visit_start_ms) || t.date_ms || nowMs;
    t.lat = Number.isFinite(lat) ? lat : Number(t.lat || 0);
    t.lng = Number.isFinite(lng) ? lng : Number(t.lng || 0);
    t.accuracy_m = n(p.gps_acc_m || p.acc_m || p.acc) || Number(t.accuracy_m || 0);
    t.location_time_ms = n(p.visit_start_ms) || n(p.gps_ms) || n(p.start_ms) || t.location_time_ms || nowMs;

    if(!s(t.lake_name) && p.lake_name) t.lake_name = s(p.lake_name);
    if(!s(t.point_name)) t.point_name = s(p.point_name || p.place_name || (visitKey ? 'Pico W実釣地点' : 'Pico Wログ地点'));
    if(!s(t.line_no) && p.line_no) t.line_no = s(p.line_no);
    if(!s(t.sinker_g) && p.sinker_g) t.sinker_g = s(p.sinker_g);
    if(!s(t.water_temp_c) && p.water_temp_c) t.water_temp_c = s(p.water_temp_c);
    if(!s(t.weather) && (p.weather_text || p.weather)) t.weather = s(p.weather_text || p.weather);
    if(!s(t.wind) && (p.wind_dir || p.wind)) t.wind = s(p.wind_dir || p.wind);
    if(!s(t.memo) && p.note) t.memo = s(p.note);

    if(depth){
      t.fishfinder_depth_m = depthText(t.fishfinder_depth_m, depth);
      t.depth_status = 'measured';
    }else if(!t.depth_status){
      t.depth_status = 'not_measured';
    }

    t.depth_last_sync_ms = nowMs;

    const summary = makePicoSummary(p);
    t.pico_logs = Array.isArray(t.pico_logs) ? t.pico_logs : [];

    if(visitKey){
      t.pico_logs = t.pico_logs.filter(x => s(x.gps_visit_id) !== visitKey);
    }else if(pointKey){
      t.pico_logs = t.pico_logs.filter(x => s(x.point_visit_id || x.map_point_key) !== pointKey);
    }

    t.pico_logs.push(summary);
    t.pico_summary = summary;
    t.updated_ms = nowMs;

    return t;
  }

  async function handleLogsyncSaveRequest(data, ev){
    const requestId = s(data && data.request_id) || ('LS_' + Date.now().toString(36));
    const payload = data && data.payload ? data.payload : null;

    try{
      await openTripDb();

      const parts = splitLogsyncPayload(payload);
      if(!parts.length){
        postToLogWindow({
          type:'wakasagi:logsync-save-result',
          ok:false,
          request_id:requestId,
          saved_count:0,
          reason:'no_visit_payload'
        }, ev && ev.origin ? ev.origin : '*');
        return;
      }

      let saved = 0;
      const ids = [];

      for(const p of parts){
        const existing = await findTripForPayload(p);
        const trip = makeTripFromPayload(p, existing);
        const ok = await putTripRecord(trip);
        if(ok){
          saved++;
          ids.push(trip.trip_id);
        }
      }

      postToLogWindow({
        type:'wakasagi:logsync-save-result',
        ok:saved > 0,
        request_id:requestId,
        sid:s(payload && payload.sid),
        saved_count:saved,
        trip_ids:ids,
        recorder_version:VERSION,
        saved_ms:Date.now()
      }, ev && ev.origin ? ev.origin : '*');

      dbg({
        ready:true,
        trip_records_write:true,
        logsync_saved_count:saved,
        logsync_trip_ids:ids
      });
    }catch(e){
      postToLogWindow({
        type:'wakasagi:logsync-save-result',
        ok:false,
        request_id:requestId,
        saved_count:0,
        error:String(e && e.message || e)
      }, ev && ev.origin ? ev.origin : '*');

      dbg({
        trip_records_write:true,
        logsync_error:String(e && e.message || e)
      });
    }
  }

  async function handleRequestMessage(ev){
    const data = ev && ev.data ? ev.data : null;
    if(!data || !data.type) return;

    const originOk = allowedPicoOrigin === '*' || String(ev.origin || '') === String(allowedPicoOrigin || '');
    if(!originOk){
      dbg({rejected:'origin', origin:ev.origin, allowedPicoOrigin:allowedPicoOrigin});
      return;
    }

    if(data.type === 'wakasagi:logsync-save-request'){
      await handleLogsyncSaveRequest(data, ev);
      return;
    }

    if(data.type !== 'wakasagi:gps-request') return;

    requestCount++;

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
