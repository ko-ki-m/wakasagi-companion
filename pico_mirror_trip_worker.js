'use strict';

const VERSION = 'pico_mirror_trip_worker_20260610n';
const TRIP_DB_NAME = 'wakasagi_trip_map_v10';
const STORE_TRIPS = 'trip_records';
const MIRROR_DB_NAME = 'wakasagi_pico_mirror_v1';
const MIRROR_DB_VER = 2;
const STORE_CANDIDATES = 'gps_candidates';
const STORE_ACTIVITY = 'activity_rows';
const STORE_SESSION = 'session_meta';
let tripDb = null;
let mirrorDb = null;
let rebuildTimers = Object.create(null);

function s(v){ return String(v == null ? '' : v).trim(); }
function finiteNumber(v){ const x = Number(v); return Number.isFinite(x) ? x : null; }
function n(v){ const x = finiteNumber(v); return x === null ? 0 : x; }
function now(){ return Date.now(); }
function safeKey(v){ return s(v).replace(/[^A-Za-z0-9_\-:.]/g, '_').slice(0, 120); }
function sidKey(sid){ return safeKey(sid || 'nosid'); }


const LAKE_INDEX_URL = './viewer/lakes/index.json';
const LAKE_FILE_BASE = './viewer/lakes/';
let lakeIndexCache = null;
const lakePrefCache = Object.create(null);

function validLatLng(a,b){
  return Number.isFinite(a) && Number.isFinite(b) && a >= -90 && a <= 90 && b >= -180 && b <= 180;
}

async function fetchJson(url){
  const res = await fetch(url, {cache:'force-cache'});
  if(!res || !res.ok) throw new Error('fetch failed: ' + url);
  return await res.json();
}

async function loadLakeIndex(){
  if(lakeIndexCache) return lakeIndexCache;
  lakeIndexCache = await fetchJson(LAKE_INDEX_URL);
  return Array.isArray(lakeIndexCache) ? lakeIndexCache : [];
}

async function loadLakePrefFile(file){
  const f = s(file);
  if(!f) return [];
  if(lakePrefCache[f]) return lakePrefCache[f];
  const data = await fetchJson(LAKE_FILE_BASE + f);
  lakePrefCache[f] = Array.isArray(data) ? data : [];
  return lakePrefCache[f];
}

function inBboxLngLat(lng, lat, bbox, marginDeg){
  if(!Array.isArray(bbox) || bbox.length < 4) return false;
  const m = Number(marginDeg || 0);
  return lng >= Number(bbox[0]) - m && lat >= Number(bbox[1]) - m && lng <= Number(bbox[2]) + m && lat <= Number(bbox[3]) + m;
}

function pointInRing(lng, lat, ring){
  if(!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for(let i=0, j=ring.length-1; i<ring.length; j=i++){
    const pi = ring[i] || [];
    const pj = ring[j] || [];
    const xi = Number(pi[0]), yi = Number(pi[1]);
    const xj = Number(pj[0]), yj = Number(pj[1]);
    if(!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) continue;
    const intersect = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
    if(intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng, lat, polygonCoords){
  if(!Array.isArray(polygonCoords) || !polygonCoords.length) return false;
  if(!pointInRing(lng, lat, polygonCoords[0])) return false;
  for(let i=1; i<polygonCoords.length; i++){
    if(pointInRing(lng, lat, polygonCoords[i])) return false;
  }
  return true;
}

function pointInGeometry(lng, lat, geom){
  if(!geom || !geom.type) return false;
  if(geom.type === 'Polygon') return pointInPolygon(lng, lat, geom.coordinates || []);
  if(geom.type === 'MultiPolygon'){
    const polys = geom.coordinates || [];
    for(const poly of polys){ if(pointInPolygon(lng, lat, poly)) return true; }
  }
  return false;
}

function distanceMetersLatLng(lat1, lng1, lat2, lng2){
  const R = 6371008.8;
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function pointToSegmentDistanceMeters(lat, lng, lat1, lng1, lat2, lng2){
  const R = 6371008.8;
  const baseLatRad = lat * Math.PI / 180;
  function xOf(lon){ return (lon - lng) * Math.PI / 180 * Math.cos(baseLatRad) * R; }
  function yOf(la){ return (la - lat) * Math.PI / 180 * R; }
  const ax = xOf(lng1), ay = yOf(lat1);
  const bx = xOf(lng2), by = yOf(lat2);
  const dx = bx - ax, dy = by - ay;
  const len2 = dx*dx + dy*dy;
  if(len2 <= 1e-9) return Math.sqrt(ax*ax + ay*ay);
  let t = -(ax*dx + ay*dy) / len2;
  if(t < 0) t = 0;
  if(t > 1) t = 1;
  const cx = ax + t*dx;
  const cy = ay + t*dy;
  return Math.sqrt(cx*cx + cy*cy);
}

function ringDistanceMeters(lat, lng, ring){
  if(!Array.isArray(ring) || ring.length < 2) return Infinity;
  let best = Infinity;
  for(let i=1; i<ring.length; i++){
    const a = ring[i-1] || [];
    const b = ring[i] || [];
    const d = pointToSegmentDistanceMeters(lat, lng, Number(a[1]), Number(a[0]), Number(b[1]), Number(b[0]));
    if(Number.isFinite(d) && d < best) best = d;
  }
  return best;
}

function polygonDistanceMeters(lat, lng, polygonCoords){
  if(pointInPolygon(lng, lat, polygonCoords)) return 0;
  let best = Infinity;
  for(const ring of (polygonCoords || [])){
    const d = ringDistanceMeters(lat, lng, ring);
    if(d < best) best = d;
  }
  return best;
}

function geometryDistanceMeters(lat, lng, geom){
  if(!geom || !geom.type) return Infinity;
  if(geom.type === 'Polygon') return polygonDistanceMeters(lat, lng, geom.coordinates || []);
  if(geom.type === 'MultiPolygon'){
    let best = Infinity;
    for(const poly of (geom.coordinates || [])){
      const d = polygonDistanceMeters(lat, lng, poly);
      if(d < best) best = d;
    }
    return best;
  }
  return Infinity;
}

async function guessLakeNameFromLatLng(latVal, lngVal){
  const lat = Number(latVal), lng = Number(lngVal);
  if(!validLatLng(lat, lng)) return null;
  try{
    const marginDeg = 0.02;
    const nearLimitM = 300;
    const index = await loadLakeIndex();
    const candidates = index.filter(lake => lake && inBboxLngLat(lng, lat, lake.bbox, marginDeg) && s(lake.file));
    if(!candidates.length) return null;
    const files = Array.from(new Set(candidates.map(c => s(c.file)).filter(Boolean)));
    let nearest = null;
    for(const file of files){
      const lakes = await loadLakePrefFile(file);
      for(const lake of lakes){
        if(!lake || !inBboxLngLat(lng, lat, lake.bbox, marginDeg)) continue;
        if(pointInGeometry(lng, lat, lake.geometry)){
          return {lake_name:s(lake.name), lake_source:'ksj_w09_polygon', lake_confidence:1.0};
        }
        const d = geometryDistanceMeters(lat, lng, lake.geometry);
        if(Number.isFinite(d) && d <= nearLimitM){
          if(!nearest || d < nearest.distance_m){
            nearest = {lake_name:s(lake.name), lake_source:'ksj_w09_near', lake_confidence:0.7, distance_m:d};
          }
        }
      }
    }
    return nearest;
  }catch(e){
    return null;
  }
}

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
      if(!d.objectStoreNames.contains(STORE_SESSION)){
        d.createObjectStore(STORE_SESSION, {keyPath:'sid'});
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

function getSessionMeta(sid){
  return new Promise(resolve=>{
    try{
      if(!mirrorDb || !sid || !mirrorDb.objectStoreNames.contains(STORE_SESSION)){
        resolve(null);
        return;
      }
      const tx = mirrorDb.transaction(STORE_SESSION, 'readonly');
      const req = tx.objectStore(STORE_SESSION).get(sid);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    }catch(e){ resolve(null); }
  });
}

function normalizeSessionMeta(data){
  const m = data && data.session_meta ? data.session_meta : null;
  const sidVal = s((data && data.sid) || (m && m.sid));
  if(!sidVal) return null;
  return {
    sid:sidVal,
    updated_ms:n(m && m.updated_ms) || n(data && data.sent_ms) || now(),
    lake_name:s(m && (m.lake_name || m.lake)),
    place_name:s(m && m.place_name),
    line_no:s(m && m.line_no),
    sinker_g:s(m && m.sinker_g),
    fishfinder_m:s(m && m.fishfinder_m),
    water_temp_c:s(m && m.water_temp_c),
    weather_text:s(m && (m.weather_text || m.weather)),
    weather:s(m && (m.weather || m.weather_text)),
    wind_dir:s(m && m.wind_dir),
    wind_speed_mps:s(m && m.wind_speed_mps),
    wind:s(m && m.wind),
    note:s(m && m.note),
    map_spot_id:s(m && m.map_spot_id),
    map_source:s(m && m.map_source)
  };
}

async function saveSessionMeta(data){
  const m = normalizeSessionMeta(data);
  if(!m) return null;
  await openMirrorDb();
  await txPut(mirrorDb, STORE_SESSION, m);
  return m;
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
    event:Number(row && row.event || 0) || 0,
    sinker_g_x10:Number(row && row.sinker_g_x10 || 0) || 0,
    speedLevel:Number(row && row.speedLevel || 0) || 0,
    sasoiType:Number(row && row.sasoiType || 0) || 0
  };
}

async function saveActivityRows(data){
  const rows = Array.isArray(data && data.activity_rows) ? data.activity_rows : [];
  if(!rows.length) return;
  await openMirrorDb();
  await saveSessionMeta(data);
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
  await saveSessionMeta(data);
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
  const sinkerX10 = rows.map(r => Number(r.sinker_g_x10 || 0) || 0).filter(x => x > 0).pop() || 0;
  return {
    tlog_count:rows.length,
    fish_count:fishCount,
    sinker_g_x10:sinkerX10,
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

function makeTripFromCandidate(c, rows, existing, sessionMeta, lakeGuess){
  const meta = sessionMeta || {};
  const lake = lakeGuess || null;
  const lakeName = s(meta.lake_name) || s(lake && lake.lake_name);
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
  if(lakeName) t.lake_name = lakeName;
  if(lake && s(lake.lake_source)) t.lake_source = s(lake.lake_source);
  if(lake && Number.isFinite(Number(lake.lake_confidence))) t.lake_confidence = Number(lake.lake_confidence);
  if(lake && Number.isFinite(Number(lake.distance_m))) t.lake_distance_m = Number(lake.distance_m);
  if(s(meta.place_name)) t.point_name = meta.place_name;
  if(!s(t.point_name)) t.point_name = 'Pico W実釣地点';
  if(s(meta.line_no)) t.line_no = meta.line_no;
  if(s(meta.sinker_g)){
    t.sinker_g = meta.sinker_g;
  }else if(st.sinker_g_x10 > 0){
    t.sinker_g = String((st.sinker_g_x10 / 10).toFixed(1)).replace(/\.0$/, '');
  }
  if(s(meta.water_temp_c)) t.water_temp_c = meta.water_temp_c;
  if(s(meta.weather_text) || s(meta.weather)){
    t.weather = s(meta.weather_text || meta.weather);
    t.weather_text = s(meta.weather_text || meta.weather);
  }
  if(s(meta.wind)){
    t.wind = meta.wind;
  }else if(s(meta.wind_dir) || s(meta.wind_speed_mps)){
    t.wind = [s(meta.wind_dir), s(meta.wind_speed_mps) ? (s(meta.wind_speed_mps) + 'm/s') : ''].filter(Boolean).join(' ');
  }
  if(s(meta.wind_dir)) t.wind_dir = meta.wind_dir;
  if(s(meta.wind_speed_mps)) t.wind_speed_mps = meta.wind_speed_mps;
  if(s(meta.note)) t.memo = meta.note;
  if(s(meta.map_spot_id)) t.map_spot_id = meta.map_spot_id;
  if(s(meta.map_source)) t.map_source = meta.map_source;
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
    lake_name:lakeName,
    place_name:s(meta.place_name),
    line_no:s(meta.line_no),
    sinker_g:s(t.sinker_g || meta.sinker_g),
    weather:s(meta.weather_text || meta.weather),
    wind:s(t.wind || meta.wind),
    note:s(meta.note),
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
  const sessionMeta = await getSessionMeta(sid) || {};
  if(!candidates.length) return;
  for(const c of candidates){
    const cr = rowsForCandidate(rows, c);
    if(!cr.length) continue;
    const existing = await getTrip(c.trip_id);
    const lakeGuess = s(sessionMeta.lake_name) ? null : await guessLakeNameFromLatLng(Number(c.gps_lat), Number(c.gps_lng));
    const trip = makeTripFromCandidate(c, cr, existing, sessionMeta, lakeGuess);
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
