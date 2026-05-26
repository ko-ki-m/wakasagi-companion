(function(){
  'use strict';

  const VERSION = 'gps_recorder_20260526m_one_shot_safety';
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
  const sid = String(qs.get('sid') || localStorage.getItem('wakasagi_last_sid') || '').trim();
  const pico = String(qs.get('pico') || '').trim();
  const requestedAutostart = qs.get('autostart') === '1';

  let db = null;
  let lastCandidate = null;
  let sampleCount = 0;
  let inFlight = false;

  function setStatus(text, cls){
    if(statusEl){
      statusEl.textContent = text;
      statusEl.className = 'status ' + (cls || '');
    }
  }
  function dbg(obj){
    if(!debugEl) return;
    debugEl.textContent = JSON.stringify(Object.assign({
      version:VERSION,
      sid,
      running:false,
      inFlight:inFlight,
      sampleCount,
      behavior:'one_shot_only',
      auto_timer:false,
      autostart:false,
      watchPosition:false
    }, obj || {}), null, 2);
  }
  function now(){ return Date.now(); }
  function toRad(v){ return Number(v) * Math.PI / 180; }
  function distM(lat1,lng1,lat2,lng2){
    const a1=Number(lat1), o1=Number(lng1), a2=Number(lat2), o2=Number(lng2);
    if(!Number.isFinite(a1)||!Number.isFinite(o1)||!Number.isFinite(a2)||!Number.isFinite(o2)) return null;
    const R=6371000, dLat=toRad(a2-a1), dLng=toRad(o2-o1);
    const s1=Math.sin(dLat/2), s2=Math.sin(dLng/2);
    const x=s1*s1+Math.cos(toRad(a1))*Math.cos(toRad(a2))*s2*s2;
    return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
  }
  function idFor(no){ return String(sid || 'nosid') + '_G' + String(no).padStart(4,'0'); }

  function openDb(){
    return new Promise((resolve,reject)=>{
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = ev => {
        const d = ev.target.result;
        if(!d.objectStoreNames.contains(STORE_CAND)){
          const st = d.createObjectStore(STORE_CAND, {keyPath:'id'});
          st.createIndex('sid_start', ['sid','start_ms'], {unique:false});
          st.createIndex('sid_no', ['sid','candidate_no'], {unique:true});
        }
        if(!d.objectStoreNames.contains(STORE_META)) d.createObjectStore(STORE_META, {keyPath:'key'});
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
    });
  }
  function put(store, rec){
    return new Promise(res=>{
      const tx = db.transaction(store,'readwrite');
      tx.objectStore(store).put(rec);
      tx.oncomplete=()=>res(true);
      tx.onerror=()=>res(false);
    });
  }
  function getLatestCandidate(){
    return new Promise(resolve=>{
      if(!sid){ resolve(null); return; }
      const tx = db.transaction(STORE_CAND,'readonly');
      const st = tx.objectStore(STORE_CAND);
      const idx = st.index('sid_start');
      const range = IDBKeyRange.bound([sid,0],[sid,Number.MAX_SAFE_INTEGER]);
      const req = idx.openCursor(range, 'prev');
      req.onsuccess = ev => {
        const cur=ev.target.result;
        resolve(cur ? cur.value : null);
      };
      req.onerror = () => resolve(null);
    });
  }
  function getAllCandidates(){
    return new Promise(resolve=>{
      const out = [];
      if(!db){ resolve(out); return; }
      try{
        const tx = db.transaction(STORE_CAND,'readonly');
        const st = tx.objectStore(STORE_CAND);
        const req = st.getAll();
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : out);
        req.onerror = () => resolve(out);
      }catch(e){ resolve(out); }
    });
  }
  function deleteCandidatesBySid(sidTarget){
    return new Promise(resolve=>{
      if(!db || !sidTarget){ resolve(0); return; }
      let count = 0;
      try{
        const tx = db.transaction(STORE_CAND,'readwrite');
        const st = tx.objectStore(STORE_CAND);
        const req = st.openCursor();
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
      }catch(e){ resolve(count); }
    });
  }
  function deleteAllCandidates(){
    return new Promise(resolve=>{
      if(!db){ resolve(false); return; }
      try{
        const tx = db.transaction(STORE_CAND,'readwrite');
        tx.objectStore(STORE_CAND).clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      }catch(e){ resolve(false); }
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
    return new Promise((resolve,reject)=>{
      if(!('geolocation' in navigator)){
        reject(new Error('geolocation unsupported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy:true,
        timeout:15000,
        maximumAge:0
      });
    });
  }
  async function commitPosition(pos, source){
    const c = pos && pos.coords ? pos.coords : {};
    const lat = Number(c.latitude), lng = Number(c.longitude), acc = Number(c.accuracy || 0);
    const posMs = Number(pos && pos.timestamp ? pos.timestamp : now());
    sampleCount++;

    if(!Number.isFinite(lat) || !Number.isFinite(lng)){
      setStatus('GPS値が不正です','bad');
      dbg({error:'invalid lat/lng'});
      return false;
    }
    if(Number.isFinite(acc) && acc > MAX_ACC_M){
      setStatus('GPS精度不足: ' + acc.toFixed(1) + 'm','warn');
      dbg({lat:lat.toFixed(7), lng:lng.toFixed(7), acc_m:acc.toFixed(1), rejected:'accuracy'});
      return false;
    }

    const latest = lastCandidate || await getLatestCandidate();
    let d = null;
    if(latest) d = distM(latest.latest_lat || latest.lat, latest.latest_lng || latest.lng, lat, lng);

    let rec;
    if(!latest || d === null || d >= MOVE_M){
      const no = latest ? Number(latest.candidate_no || 0) + 1 : 1;
      rec = {
        id:idFor(no),
        sid:sid || 'nosid',
        pico:pico,
        candidate_no:no,
        start_ms:now(),
        end_ms:now(),
        lat:lat.toFixed(7),
        lng:lng.toFixed(7),
        latest_lat:lat.toFixed(7),
        latest_lng:lng.toFixed(7),
        acc_m:Number.isFinite(acc) ? acc.toFixed(1) : '',
        best_acc_m:Number.isFinite(acc) ? acc.toFixed(1) : '',
        sample_count:1,
        moved_from_prev_m:d!==null && Number.isFinite(d) ? d.toFixed(1) : '',
        pos_ms:posMs,
        source:source || VERSION,
        created_ms:now(),
        updated_ms:now()
      };
      setStatus('GPS候補保存: G' + no + '（1回取得のみ）','good');
    }else{
      rec = Object.assign({}, latest);
      rec.end_ms = now();
      rec.latest_lat = lat.toFixed(7);
      rec.latest_lng = lng.toFixed(7);
      rec.sample_count = Number(rec.sample_count || 0) + 1;
      rec.updated_ms = now();
      rec.pos_ms = posMs;
      const prevBest = Number(rec.best_acc_m || rec.acc_m || 999999);
      if(Number.isFinite(acc) && acc < prevBest){
        rec.best_acc_m = acc.toFixed(1);
        rec.acc_m = acc.toFixed(1);
      }
      setStatus('GPS候補更新: G' + String(rec.candidate_no || '') + '（1回取得のみ）','good');
    }

    const ok = await put(STORE_CAND, rec);
    if(ok) lastCandidate = rec;
    dbg({
      saved:ok,
      candidate_no:rec.candidate_no,
      lat:lat.toFixed(7),
      lng:lng.toFixed(7),
      acc_m:Number.isFinite(acc)?acc.toFixed(1):'',
      moved_from_prev_m:d!==null && Number.isFinite(d)?d.toFixed(1):'',
      next_sample_sec:0,
      note:'no timer; no scheduleNext; no autostart; no watchPosition'
    });
    return ok;
  }
  async function sampleOnce(source){
    if(inFlight){
      setStatus('GPS取得中です','warn');
      dbg({ignored:'inFlight'});
      return false;
    }
    inFlight = true;
    try{
      if(!db) db = await openDb();
      if(!sid){
        setStatus('sidなし。/logからsid付きで開く必要があります。','bad');
        dbg({error:'missing sid'});
        return false;
      }
      setStatus('GPS取得中...','warn');
      const pos = await getPosition();
      return await commitPosition(pos, source || 'manual_one_shot');
    }catch(e){
      setStatus('GPS取得失敗','bad');
      dbg({error:String(e && e.message || e)});
      return false;
    }finally{
      inFlight = false;
    }
  }
  function stop(){
    setStatus('停止中（タイマーなし）','warn');
    dbg({stopped:true, note:'one-shot mode has no running timer'});
  }

  if(btnStart) btnStart.onclick = () => sampleOnce('button_record_one_shot');
  if(btnOne) btnOne.onclick = () => sampleOnce('button_reacquire_one_shot');
  if(btnStop) btnStop.onclick = stop;
  if(btnClearSid) btnClearSid.onclick = clearCurrentSidCandidates;
  if(btnClearAll) btnClearAll.onclick = clearAllCandidates;

  (async()=>{
    try{
      db = await openDb();
      lastCandidate = await getLatestCandidate();
    }catch(e){
      setStatus('DB初期化失敗','bad');
      dbg({error:String(e&&e.message||e)});
      return;
    }
    dbg({ready:true, lastCandidate:lastCandidate});
    if(requestedAutostart){
      setStatus('autostart指定は安全化のため無効です。現在地を記録で1回だけ取得します。','warn');
      dbg({autostart_requested:true, autostart_disabled:true});
    }
  })();
})();
