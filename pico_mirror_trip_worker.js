'use strict';

const VERSION = 'pico_mirror_trip_worker_20260610l';
const TRIP_DB_NAME = 'wakasagi_trip_map_v10';
const STORE_TRIPS = 'trip_records';
const MIRROR_DB_NAME = 'wakasagi_pico_mirror_v1';
const MIRROR_DB_VER = 1;
const STORE_CANDIDATES = 'gps_candidates';
const STORE_ACTIVITY = 'activity_rows';
let tripDb = null;
let mirrorDb = null;
let rebuildTimers = Object.create(null);

function s(v){ return String(v == null ? '' : v).trim(); }
function finiteNumber(v){ const x = Number(v); return Number.isFinite(x) ? x : null; }
function n(v){ const x = finiteNumber(v); return x === null ? 0 : x; }
function now(){ return Date.now(); }
function safeKey(v){ return s(v).replace(/[^A-Za-z0-9_\-:.]/g, '_').slice(0, 120); }
function sidKey(sid){ return safeKey(sid || 'nosid'); }

function openTripDb(){
  return new Promise((resolve, reject)=>{
    if(tripDb){ resolve(tripDb); return; }
    if(typeof indexedDB === 'undefined'){
      reject(new Error('IndexedDB unsupported'));
      return;
    }
    const req = indexedDB.open(TRIP_DB_NAME, 1);
    req.onupgradeneeded = ev => {
      const d = ev.target.result;
      if(!d.objectStoreNames.contains(STORE_TRIPS)){
        const st = d.createObjectStore(STORE_TRIPS, {keyPath:'trip_id'});
        st.createIndex('date_ms', 'date_ms', {unique:false});
      }
      if(!d.objectStoreNames.contains('meta')){
        d.createObjectStore('meta', {keyPath:'key'});
      }
    };
    req.onsuccess = () => {
      const d = req.result;
      const ok = d.objectStoreNames.contains(STORE_TRIPS) && d.objectStoreNames.contains('meta');
      if(!ok){
        try{ d.close(); }catch(e){}
        reject(new Error('trip db stores mismatch'));
        return;
      }
      tripDb = d;
      tripDb.onversionchange = () => {
        try{ tripDb.close(); }catch(e){}
        tripDb = null;
      };
      resolve(tripDb);
    };
    req.onerror = () => reject(req.error || new Error('trip db open failed'));
    req.onblocked = () => reject(new Error('trip db open blocked'));
  });
}

function openMirrorDb(){
  return new Promise((resolve, reject)=>{
    if(mirrorDb){ resolve(mirrorDb); return; }
    if(typeof indexedDB === 'undefined'){
      reject(new Error('IndexedDB unsupported'));
      return;
    }
    const req = indexedDB.open(MIRROR_DB_NAME, MIRROR_DB_VER);
    req.onupgradeneeded = ev => {
      const d = ev.target.result;
      if(!d.objectStoreNames.contains(STORE_CANDIDATES)){
        const st = d.createObjectStore(STORE_CANDIDATES, {keyPath:'key'});
        st.createIndex('sid', 'sid', {unique:false});
      }
      if(!d.objectStoreNames.contains(STORE_ACTIVITY)){
        const st = d.createObjectStore(STORE_ACTIVITY, {keyPath:'key'});
        st.createIndex('sid', 'sid', {unique:false});
      }
    };
    req.onsuccess = () => {
      mirrorDb = req.result;
      mirrorDb.onversionchange = () => {
        try{ mirrorDb.close(); }catch(e){}
        mirrorDb = null;
      };
      resolve(mirrorDb);
    };
    req.onerror = () => reject(req.error || new Error('mirror db open failed'));
  });
}

function txPut(db, storeName, value){
  return new Promise(resolve=>{
    try{
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    }catch(e){ resolve(false); }
  });
}

function getTrip(tripId){
  return new Promise(resolve=>{
    try{
      if(!tripDb || !tripId){ resolve(null); return; }
      const tx = tripDb.transaction(STORE_TRIPS, 'readonly');
      const req = tx.objectStore(STORE_TRIPS).get(tripId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    }catch(e){ resolve(null); }
  });
}

function putTrip(t){
  return new Promise(resolve=>{
    try{
      if(!tripDb || !t || !t.trip_id){ resolve(false); return; }
      const tx = tripDb.transaction(STORE_TRIPS, 'readwrite');
      tx.objectStore(STORE_TRIPS).put(t);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    }catch(e){ resolve(false); }
  });
}

function getAllBySid(storeName, sid){
  return new Promise(resolve=>{
    try{
      if(!mirrorDb || !sid){ resolve([]); return; }
      const tx = mirrorDb.transaction(storeName, 'readonly');
      const idx = tx.objectStore(storeName).index('sid');
      const req = idx.getAll(sid);
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => resolve([]);
    }catch(e){ resolve([]); }
  });
}

function normalizeCandidate(data){
  const c = data && (data.candidate || data.gps || data);
  const sidVal = s((data && data.sid) || (c && c.sid));
  const candidateNo = Number(c && (c.candidate_no || c.no || 0)) || 0;
  const lat = finiteNumber(c && (c.lat || c.gps_lat || c.best_lat || c.latest_lat));
  const lng = finiteNumber(c && (c.lng || c.gps_lng || c.best_lng || c.latest_lng));
  if(!sidVal || lat === null || lng === null) return null;

  const startSeq = Number(c && (c.start_seq || c.trigger_seq || 0)) || 0;
  const endSeq = Number(c && (c.end_seq || c.start_seq || c.trigger_seq || 0)) || startSeq;
  const baseVisit = candidateNo
    ? sidVal + '_G' + String(candidateNo).padStart(4,'0')
    : sidVal + '_GPS_' + Math.round(lat * 1e6) + '_' + Math.round(lng * 1e6);
  const visitId = s(c && (c.gps_visit_id || c.visit_id)) || baseVisit;
  const startMs = n(c && (c.start_ms || c.gps_ms || c.updated_ms)) || n(data && data.sent_ms) || now();

  return {
    key:sidKey(sidVal) + '_' + safeKey(visitId),
    sid:sidVal,
    candidate_no:candidateNo,
    gps_visit_id:visitId,
    trip_id:'PICO_MIRROR_' + safeKey(visitId),
    gps_lat:String(lat),
    gps_lng:String(lng),
    gps_acc_m:s(c && (c.gps_acc_m || c.acc_m || c.best_acc_m || c.latest_acc_m || c.acc || '')),
    start_ms:startMs,
    updated_ms:n(c && c.updated_ms) || now(),
    start_seq:startSeq,
    end_seq:endSeq,
    gps_quality:s(c && c.gps_quality),
    gps_quality_label:s(c && c.gps_quality_label),
    source:s((c && c.source) || (data && data.reason) || 'pico_gps_candidate')
  };
}

function normalizeActivityRow(data, row){
  const sidVal = s((data && data.sid) || (row && row.sid));
  const seq = Number(row && row.seq || 0) || 0;
  if(!sidVal || seq <= 0) return null;
  const tms = Number(row && row.t_ms || 0) || 0;
  const recv = Number(row && row.recv_ms || data && data.sent_ms || now()) || now();
  return {
    key:sidKey(sidVal) + '_' + String(seq),
    sid:sidVal,
    seq:seq,
    t_ms:tms,
    recv_ms:recv,
    depth_mm:Number(row && row.depth_mm || 0) || 0,
    motorRun:Number(row && row.motorRun || 0) || 0,
    pulse:Number(row && row.pulse || 0) || 0,
    event:Number(row && row.event || 0) || 0
  };
}

async function saveActivityRows(data){
  const rows = Array.isArray(data && data.activity_rows) ? data.activity_rows : [];
  if(!rows.length) return;
  await openMirrorDb();
  let sidVal = s(data && data.sid);
  for(const r of rows){
    const row = normalizeActivityRow(data, r);
    if(!row) continue;
    sidVal = sidVal || row.sid;
    await txPut(mirrorDb, STORE_ACTIVITY, row);
  }
  if(sidVal) scheduleRebuild(sidVal, 12000);
}

async function saveCandidate(data){
  const c = normalizeCandidate(data);
  if(!c) return;
  await openMirrorDb();
  await txPut(mirrorDb, STORE_CANDIDATES, c);
  scheduleRebuild(c.sid, 1200);
}

function rowsForCandidate(rows, c){
  const start = Number(c.start_seq || 0) || 0;
  const end = Number(c.end_seq || 0) || 0;
  let list = rows.filter(r => {
    const seq = Number(r.seq || 0) || 0;
    if(start > 0 && seq < start) return false;
    if(end > 0 && end >= start && seq > end) return false;
    return true;
  });
  if(!list.length && start > 0){
    list = rows.filter(r => Math.abs((Number(r.seq || 0) || 0) - start) <= 300);
  }
  return list.sort((a,b)=>(a.seq||0)-(b.seq||0));
}

function statsFromRows(rows){
  const depths = rows.map(r => Number(r.depth_mm || 0) / 1000).filter(x => Number.isFinite(x) && x > 0);
  const events = rows.map(r => Number(r.event || 0) || 0);
  const fishCount = events.filter(e => e === 1).length;
  const first = rows[0] || null;
  const last = rows[rows.length - 1] || null;
  return {
    tlog_count:rows.length,
    fish_count:fishCount,
    first_seq:first ? Number(first.seq || 0) : 0,
    last_seq:last ? Number(last.seq || 0) : 0,
    first_t_ms:first ? Number(first.t_ms || 0) : 0,
    last_t_ms:last ? Number(last.t_ms || 0) : 0,
    first_recv_ms:first ? Number(first.recv_ms || 0) : 0,
    last_recv_ms:last ? Number(last.recv_ms || 0) : 0,
    min_depth_m:depths.length ? Math.min.apply(null, depths) : 0,
    max_depth_m:depths.length ? Math.max.apply(null, depths) : 0
  };
}

function makeTripFromCandidate(c, rows, existing){
  const nowMs = now();
  const lat = Number(c.gps_lat);
  const lng = Number(c.gps_lng);
  const st = statsFromRows(rows);
  const t = existing ? Object.assign({}, existing) : {trip_id:c.trip_id, created_ms:nowMs, pico_logs:[]};

  t.trip_id = c.trip_id;
  t.pico_sid = c.sid;
  t.gps_visit_id = c.gps_visit_id;
  t.point_visit_id = '';
  t.map_point_key = '';
  t.date_ms = n(c.start_ms) || st.first_recv_ms || t.date_ms || nowMs;
  t.lat = Number.isFinite(lat) ? lat : Number(t.lat || 0);
  t.lng = Number.isFinite(lng) ? lng : Number(t.lng || 0);
  t.accuracy_m = n(c.gps_acc_m) || Number(t.accuracy_m || 0);
  t.location_time_ms = n(c.start_ms) || st.first_recv_ms || t.location_time_ms || nowMs;
  if(!s(t.point_name)) t.point_name = 'Pico W実釣地点';
  t.fish_count = Number(t.fish_count || 0) || st.fish_count || 0;
  if(st.max_depth_m > 0){
    t.fishfinder_depth_m = String(st.max_depth_m.toFixed(3));
    t.water_depth_m = String(st.max_depth_m.toFixed(3));
    t.depth_status = 'measured';
  }else if(!t.depth_status){
    t.depth_status = 'not_measured';
  }
  t.depth_last_sync_ms = nowMs;

  const summary = {
    v:1,
    source:'pico_mirror_activity_rows',
    writer_version:VERSION,
    sid:c.sid,
    gps_visit_id:c.gps_visit_id,
    candidate_no:c.candidate_no,
    start_ms:n(c.start_ms),
    updated_ms:n(c.updated_ms) || nowMs,
    start_seq:c.start_seq,
    end_seq:c.end_seq,
    tlog_count:st.tlog_count,
    fish_count:st.fish_count,
    first_seq:st.first_seq,
    last_seq:st.last_seq,
    first_t_ms:st.first_t_ms,
    last_t_ms:st.last_t_ms,
    first_recv_ms:st.first_recv_ms,
    last_recv_ms:st.last_recv_ms,
    min_depth_m:st.min_depth_m ? st.min_depth_m.toFixed(3) : '',
    max_depth_m:st.max_depth_m ? st.max_depth_m.toFixed(3) : '',
    gps_quality:c.gps_quality,
    gps_quality_label:c.gps_quality_label,
    received_ms:nowMs
  };

  t.pico_logs = Array.isArray(t.pico_logs) ? t.pico_logs : [];
  t.pico_logs = t.pico_logs.filter(x => s(x.gps_visit_id) !== c.gps_visit_id);
  t.pico_logs.push(summary);
  t.pico_summary = summary;
  t.updated_ms = nowMs;
  return t;
}

function scheduleRebuild(sid, delay){
  const k = sidKey(sid);
  if(rebuildTimers[k]) clearTimeout(rebuildTimers[k]);
  rebuildTimers[k] = setTimeout(()=>{
    delete rebuildTimers[k];
    rebuildSid(sid).catch(()=>{});
  }, Math.max(1000, Number(delay || 5000)));
}

async function rebuildSid(sid){
  if(!sid) return;
  await openMirrorDb();
  await openTripDb();
  const candidates = await getAllBySid(STORE_CANDIDATES, sid);
  const rows = await getAllBySid(STORE_ACTIVITY, sid);
  if(!candidates.length) return;
  for(const c of candidates){
    const cr = rowsForCandidate(rows, c);
    if(!cr.length) continue;
    const existing = await getTrip(c.trip_id);
    const trip = makeTripFromCandidate(c, cr, existing);
    await putTrip(trip);
  }
}

self.addEventListener('message', ev => {
  const data = ev && ev.data ? ev.data : null;
  if(!data || !data.type) return;
  if(data.type === 'wakasagi:pico-activity-rows'){
    saveActivityRows(data).catch(()=>{});
    return;
  }
  if(data.type === 'wakasagi:pico-gps-candidate'){
    saveCandidate(data).catch(()=>{});
  }
}, false);
