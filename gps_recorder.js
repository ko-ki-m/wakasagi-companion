(function(){
  'use strict';

  const VERSION = 'gps_recorder_20260526a';
  const DB_NAME = 'wakasagi_gps_recorder_v1';
  const DB_VER = 1;
  const STORE_CAND = 'gps_candidates';
  const STORE_META = 'meta';

  const MOVE_M = 10;
  const MAX_ACC_M = 35;
  const SAMPLE_INTERVAL_MS = 120000;

  const $ = id => document.getElementById(id);
  const statusEl = $('status');
  const debugEl = $('debug');
  const btnStart = $('btnStart');
  const btnStop = $('btnStop');
  const btnOne = $('btnOne');

  const qs = new URLSearchParams(location.search);
  const sid = String(qs.get('sid') || localStorage.getItem('wakasagi_last_sid') || '').trim();
  const pico = String(qs.get('pico') || '').trim();
  const autostart = qs.get('autostart') === '1';

  let db = null;
  let timer = null;
  let running = false;
  let lastCandidate = null;
  let sampleCount = 0;

  function setStatus(text, cls){
    statusEl.textContent = text;
    statusEl.className = 'status ' + (cls || '');
  }
  function dbg(obj){
    debugEl.textContent = JSON.stringify(Object.assign({version:VERSION, sid, running, sampleCount}, obj || {}), null, 2);
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
      tx.oncomplete=()=>res(true); tx.onerror=()=>res(false);
    });
  }
  function getLatestCandidate(){
    return new Promise(resolve=>{
      if(!sid){ resolve(null); return; }
      const tx = db.transaction(STORE_CAND,'readonly');
      const st = tx.objectStore(STORE_CAND);
      const idx = st.index('sid_start');
      const range = IDBKeyRange.bound([sid,0],[sid,Number.MAX_SAFE_INTEGER]);
      let latest = null;
      const req = idx.openCursor(range, 'prev');
      req.onsuccess = ev => { const cur=ev.target.result; resolve(cur ? cur.value : latest); };
      req.onerror = () => resolve(null);
    });
  }

  function getPosition(){
    return new Promise((resolve,reject)=>{
      if(!('geolocation' in navigator)){ reject(new Error('geolocation unsupported')); return; }
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
      setStatus('GPS候補保存: G' + no,'good');
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
      setStatus('GPS候補更新: G' + String(rec.candidate_no || ''),'good');
    }

    const ok = await put(STORE_CAND, rec);
    if(ok){ lastCandidate = rec; }
    dbg({
      saved:ok,
      candidate_no:rec.candidate_no,
      lat:lat.toFixed(7), lng:lng.toFixed(7), acc_m:Number.isFinite(acc)?acc.toFixed(1):'',
      moved_from_prev_m:d!==null && Number.isFinite(d)?d.toFixed(1):'',
      next_sample_sec:SAMPLE_INTERVAL_MS/1000
    });
    return ok;
  }

  async function sampleOnce(source){
    if(!db) db = await openDb();
    if(!sid){ setStatus('sidなし。/logからsid付きで開く必要があります。','bad'); dbg({error:'missing sid'}); return false; }
    setStatus('GPS取得中...','warn');
    try{
      const pos = await getPosition();
      return await commitPosition(pos, source || 'manual');
    }catch(e){
      setStatus('GPS取得失敗','bad');
      dbg({error:String(e && e.message || e)});
      return false;
    }
  }

  function scheduleNext(){
    if(!running) return;
    clearTimeout(timer);
    timer = setTimeout(async()=>{
      await sampleOnce('interval');
      scheduleNext();
    }, SAMPLE_INTERVAL_MS);
  }
  async function start(){
    if(running) return;
    running = true;
    setStatus('GPS候補記録を開始','warn');
    await sampleOnce('start');
    scheduleNext();
  }
  function stop(){
    running = false;
    clearTimeout(timer);
    timer = null;
    setStatus('停止中','warn');
    dbg({stopped:true});
  }

  btnStart.onclick = start;
  btnStop.onclick = stop;
  btnOne.onclick = ()=>sampleOnce('button');

  (async()=>{
    try{ db = await openDb(); lastCandidate = await getLatestCandidate(); }catch(e){ setStatus('DB初期化失敗','bad'); dbg({error:String(e&&e.message||e)}); return; }
    dbg({ready:true, lastCandidate:lastCandidate});
    if(autostart) start();
  })();
})();
