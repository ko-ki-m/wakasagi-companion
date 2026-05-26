// Wakasagi smartphone-side GPS candidate core
// Version: gps_session_candidates_core_20260526c
//
// Scope:
// - Smartphone/GitHub Pages side only.
// - Candidate DB only. This file does not create Map visits.
// - No automatic sampling, no timer, no watchPosition.
// - No Pico W communication.
// - No Stage1/Stage2/lake_autofill override.
(function(){
  'use strict';

  const VERSION = 'gps_session_candidates_core_20260526c';
  const DB_NAME = 'wakasagi_gps_candidates_v2';
  const DB_VER = 1;
  const STORE = 'gps_candidates';
  const META = 'meta';
  const MOVE_M = 10;
  const MAX_ACC_M = 80;

  function s(v){ return String(v == null ? '' : v).trim(); }
  function n(v){ const x = Number(v); return Number.isFinite(x) ? x : null; }
  function now(){ return Date.now(); }
  function toRad(v){ return Number(v) * Math.PI / 180; }
  function distanceM(lat1,lng1,lat2,lng2){
    const a1=n(lat1), o1=n(lng1), a2=n(lat2), o2=n(lng2);
    if(a1==null || o1==null || a2==null || o2==null) return null;
    const R=6371000;
    const dLat=toRad(a2-a1), dLng=toRad(o2-o1);
    const x=Math.sin(dLat/2)**2 + Math.cos(toRad(a1))*Math.cos(toRad(a2))*Math.sin(dLng/2)**2;
    return 2*R*Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
  }
  function secureGeoAvailable(){
    return !!(window.isSecureContext && navigator.geolocation && typeof navigator.geolocation.getCurrentPosition === 'function');
  }
  function openDb(){
    return new Promise((resolve,reject)=>{
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = ev => {
        const db = ev.target.result;
        if(!db.objectStoreNames.contains(STORE)){
          const st = db.createObjectStore(STORE, {keyPath:'candidate_id'});
          try{ st.createIndex('sid', 'sid', {unique:false}); }catch(e){}
          try{ st.createIndex('sid_no', ['sid','candidate_no'], {unique:true}); }catch(e){}
          try{ st.createIndex('sid_time', ['sid','first_seen_ms'], {unique:false}); }catch(e){}
        }
        if(!db.objectStoreNames.contains(META)) db.createObjectStore(META, {keyPath:'key'});
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
  }
  function reqAsPromise(req){
    return new Promise((resolve,reject)=>{
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
    });
  }
  async function withStore(mode, fn){
    const db = await openDb();
    try{
      return await new Promise((resolve,reject)=>{
        const tx = db.transaction(STORE, mode);
        const st = tx.objectStore(STORE);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
        Promise.resolve().then(()=>fn(st)).then(r=>{ result=r; }).catch(reject);
      });
    }finally{
      try{ db.close(); }catch(e){}
    }
  }
  async function list(sid){
    sid = s(sid);
    if(!sid) return [];
    return await withStore('readonly', async st => {
      const out=[];
      let req;
      try{ req = st.index('sid').openCursor(IDBKeyRange.only(sid)); }
      catch(e){ req = st.openCursor(); }
      return await new Promise((resolve,reject)=>{
        req.onsuccess = () => {
          const cur=req.result;
          if(!cur){ out.sort((a,b)=>Number(a.candidate_no||0)-Number(b.candidate_no||0)); resolve(out); return; }
          if(s(cur.value && cur.value.sid) === sid) out.push(cur.value);
          cur.continue();
        };
        req.onerror = () => reject(req.error || new Error('cursor failed'));
      });
    });
  }
  async function latest(sid){
    const a = await list(sid);
    return a.length ? a[a.length-1] : null;
  }
  function idFor(sid,no){
    return 'GPS_' + s(sid).replace(/[^A-Za-z0-9_.-]/g,'_') + '_G' + String(no).padStart(4,'0');
  }
  function fixFromPosition(pos){
    const c = pos && pos.coords;
    if(!c) return null;
    const lat=n(c.latitude), lng=n(c.longitude);
    if(lat==null || lng==null) return null;
    return {
      lat, lng,
      acc_m:n(c.accuracy),
      altitude_m:n(c.altitude),
      altitude_acc_m:n(c.altitudeAccuracy),
      heading_deg:n(c.heading),
      speed_mps:n(c.speed),
      gps_ms:n(pos.timestamp) || now()
    };
  }
  function oneShotPosition(options){
    if(!secureGeoAvailable()) return Promise.reject(new Error('secure geolocation unavailable'));
    const opt = Object.assign({enableHighAccuracy:true, timeout:15000, maximumAge:15000}, options || {});
    return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve, reject, opt));
  }
  async function saveFix(sid, fix, reason){
    sid=s(sid);
    reason=s(reason)||'sample_once';
    if(!sid) return {ok:false, reason:'no_sid'};
    if(!fix || n(fix.lat)==null || n(fix.lng)==null) return {ok:false, reason:'bad_fix'};
    if(n(fix.acc_m)!=null && Number(fix.acc_m) > MAX_ACC_M) return {ok:false, reason:'low_accuracy', acc_m:Number(fix.acc_m)};

    const before = await list(sid);
    const last = before.length ? before[before.length-1] : null;
    const t=now();
    let distance=null;
    if(last) distance = distanceM(last.latest_lat ?? last.lat, last.latest_lng ?? last.lng, fix.lat, fix.lng);

    if(last && distance!=null && distance < MOVE_M){
      const rec = Object.assign({}, last, {
        latest_lat:fix.lat,
        latest_lng:fix.lng,
        latest_acc_m:fix.acc_m,
        last_seen_ms:t,
        updated_ms:t,
        sample_count:Number(last.sample_count||1)+1,
        last_reason:reason,
        last_distance_m:Math.round(distance*10)/10,
        status:'candidate_only_not_visit',
        is_visit:false
      });
      const oldAcc=n(last.acc_m);
      if(oldAcc==null || (n(fix.acc_m)!=null && Number(fix.acc_m)<oldAcc)){
        rec.lat=fix.lat; rec.lng=fix.lng; rec.acc_m=fix.acc_m; rec.gps_ms=fix.gps_ms;
      }
      await withStore('readwrite', st => st.put(rec));
      return {ok:true, action:'updated_same_candidate', candidate:rec, distance_m:distance};
    }

    const no = before.length + 1;
    const rec = {
      candidate_id:idFor(sid,no),
      sid,
      candidate_no:no,
      lat:fix.lat,
      lng:fix.lng,
      acc_m:fix.acc_m,
      latest_lat:fix.lat,
      latest_lng:fix.lng,
      latest_acc_m:fix.acc_m,
      gps_ms:fix.gps_ms,
      first_seen_ms:t,
      last_seen_ms:t,
      updated_ms:t,
      sample_count:1,
      reason,
      source:'smartphone_gps_core',
      status:'candidate_only_not_visit',
      is_visit:false,
      min_new_point_m:MOVE_M,
      max_acc_m:MAX_ACC_M,
      version:VERSION
    };
    for(const k of ['altitude_m','altitude_acc_m','heading_deg','speed_mps']){
      if(fix[k] != null) rec[k] = fix[k];
    }
    await withStore('readwrite', st => st.put(rec));
    return {ok:true, action:'created_new_candidate', candidate:rec, distance_m:distance};
  }
  async function sampleOnce(sid, reason, options){
    sid=s(sid);
    if(!sid) return {ok:false, reason:'no_sid'};
    const pos = await oneShotPosition(options);
    return await saveFix(sid, fixFromPosition(pos), reason || 'sample_once');
  }
  async function clearSid(sid){
    sid=s(sid);
    if(!sid) return {ok:false, reason:'no_sid'};
    const rows=await list(sid);
    await withStore('readwrite', st => rows.forEach(r=>st.delete(r.candidate_id)));
    return {ok:true, sid, deleted:rows.length};
  }
  async function clearAll(){
    await withStore('readwrite', st => st.clear());
    return {ok:true};
  }
  function status(){
    return {
      version:VERSION,
      db:DB_NAME,
      store:STORE,
      secure_context:!!window.isSecureContext,
      geolocation_available:secureGeoAvailable(),
      automatic_sampling:false,
      timer:false,
      watchPosition:false,
      writes_map_history:false,
      calls_pico_w:false,
      overrides_stage2:false,
      move_m:MOVE_M,
      max_acc_m:MAX_ACC_M
    };
  }

  window.wakasagiGpsCandidatesCore = {
    version:VERSION,
    status,
    sampleOnce,
    saveFix,
    list,
    latest,
    clearSid,
    clearAll,
    distanceM
  };
  try{ console.info('[wakasagi] gps candidates core installed', status()); }catch(e){}
})();
