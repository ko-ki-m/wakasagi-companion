(function(){
  'use strict';

  const VERSION = 'gps_recorder_visit_inject_20260526e';
  const DB_NAME = 'wakasagi_gps_recorder_v1';
  const DB_VER = 1;
  const STORE_CAND = 'gps_candidates';

  function s(v){ return String(v == null ? '' : v).trim(); }
  function n(v){ const x = Number(v); return Number.isFinite(x) ? x : null; }

  function gpsVisitId(sid, cand){
    const no = Number(cand && cand.candidate_no || 0) || 0;
    const st = Number(cand && cand.start_ms || 0) || 0;
    return 'GR_' + s(sid) + '_G' + String(no).padStart(4,'0') + '_' + st.toString(36);
  }

  function openRecorderDb(){
    return new Promise((resolve)=>{
      if(!('indexedDB' in window)){ resolve(null); return; }
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = ev => {
        const db = ev.target.result;
        if(!db.objectStoreNames.contains(STORE_CAND)){
          const st = db.createObjectStore(STORE_CAND, {keyPath:'id'});
          st.createIndex('sid_start', ['sid','start_ms'], {unique:false});
          st.createIndex('sid_no', ['sid','candidate_no'], {unique:true});
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }

  async function readCandidates(sidFilter){
    const db = await openRecorderDb();
    if(!db) return [];
    return new Promise(resolve=>{
      const out = [];
      try{
        const tx = db.transaction(STORE_CAND, 'readonly');
        const st = tx.objectStore(STORE_CAND);
        const req = st.getAll();
        req.onsuccess = () => {
          const rows = Array.isArray(req.result) ? req.result : [];
          const sid = s(sidFilter);
          for(const r of rows){
            if(sid && s(r.sid) !== sid) continue;
            if(!Number.isFinite(Number(r.latest_lat || r.lat))) continue;
            if(!Number.isFinite(Number(r.latest_lng || r.lng))) continue;
            out.push(r);
          }
          out.sort((a,b)=>(Number(a.start_ms||0)-Number(b.start_ms||0)));
          resolve(out);
        };
        req.onerror = () => resolve(out);
      }catch(e){ resolve(out); }
    });
  }

  function rowVal(row, longKey, shortKey){
    if(row && row[longKey] !== undefined) return row[longKey];
    if(row && row[shortKey] !== undefined) return row[shortKey];
    return undefined;
  }

  function normalizeActivityRows(p){
    const rows = Array.isArray(p && p.tlog_activity_rows) ? p.tlog_activity_rows : [];
    return rows.map(r => ({
      seq:n(rowVal(r,'seq','q')),
      recv_ms:n(rowVal(r,'recv_ms','r')),
      t_ms:n(rowVal(r,'t_ms','t')),
      depth_mm:n(rowVal(r,'depth_mm','d')),
      motorRun:n(rowVal(r,'motorRun','m')) || 0,
      pulse:n(rowVal(r,'pulse','p')) || 0,
      event:n(rowVal(r,'event','e')) || 0,
      speedLevel:rowVal(r,'speedLevel','sp'),
      sasoiType:rowVal(r,'sasoiType','sa')
    })).filter(r => Number.isFinite(r.recv_ms));
  }

  function isActivityRow(r){
    const ev = Number(r.event || 0) | 0;
    return Number(r.motorRun || 0) > 0 ||
           Number(r.pulse || 0) !== 0 ||
           (ev >= 1 && ev <= 5);
  }

  function statsForWindow(rows, startMs, endMs){
    const st = {
      rows:[],
      tlog_count:0,
      activity:false,
      motor_count:0,
      pulse_count:0,
      fishing_event_count:0,
      fish_count:0,
      first_seq:null,
      last_seq:null,
      first_recv_ms:null,
      last_recv_ms:null,
      first_t_ms:null,
      last_t_ms:null,
      min_depth_m:null,
      max_depth_m:null,
      depth_range_mm:0,
      used_sasoi:{},
      used_speed:{},
      activity_reason:''
    };

    let minD = null, maxD = null;
    for(const r of rows){
      const recv = Number(r.recv_ms || 0);
      if(!Number.isFinite(recv) || recv < startMs || recv > endMs) continue;
      if(!isActivityRow(r)) continue;

      st.rows.push(r);
      st.tlog_count++;

      if(Number.isFinite(r.seq)){
        if(st.first_seq === null || r.seq < st.first_seq) st.first_seq = r.seq;
        if(st.last_seq === null || r.seq > st.last_seq) st.last_seq = r.seq;
      }
      if(Number.isFinite(r.recv_ms)){
        if(st.first_recv_ms === null || r.recv_ms < st.first_recv_ms) st.first_recv_ms = r.recv_ms;
        if(st.last_recv_ms === null || r.recv_ms > st.last_recv_ms) st.last_recv_ms = r.recv_ms;
      }
      if(Number.isFinite(r.t_ms)){
        if(st.first_t_ms === null || r.t_ms < st.first_t_ms) st.first_t_ms = r.t_ms;
        if(st.last_t_ms === null || r.t_ms > st.last_t_ms) st.last_t_ms = r.t_ms;
      }
      if(Number.isFinite(r.depth_mm)){
        if(minD === null || r.depth_mm < minD) minD = r.depth_mm;
        if(maxD === null || r.depth_mm > maxD) maxD = r.depth_mm;
      }
      if(Number(r.motorRun || 0) > 0) st.motor_count++;
      if(Number(r.pulse || 0) !== 0) st.pulse_count++;
      const ev = Number(r.event || 0) | 0;
      if(ev >= 1 && ev <= 5){
        st.fishing_event_count++;
        if(ev === 1) st.fish_count++;
      }
      if(r.speedLevel !== undefined && r.speedLevel !== null && s(r.speedLevel)) st.used_speed[String(r.speedLevel)] = true;
      if(r.sasoiType !== undefined && r.sasoiType !== null && s(r.sasoiType)) st.used_sasoi[String(r.sasoiType)] = true;
    }

    if(minD !== null && maxD !== null){
      st.depth_range_mm = Math.abs(maxD - minD);
      st.min_depth_m = minD / 1000.0;
      st.max_depth_m = maxD / 1000.0;
    }

    const reasons = [];
    if(st.motor_count > 0) reasons.push('motorRun');
    if(st.pulse_count > 0) reasons.push('pulse');
    if(st.fishing_event_count > 0) reasons.push('event');
    if(st.depth_range_mm >= 1) reasons.push('depth');
    st.activity = reasons.length > 0;
    st.activity_reason = reasons.join(',');
    return st;
  }

  function depthText(v){
    const x = Number(v);
    if(!Number.isFinite(x) || x <= 0) return '';
    return x.toFixed(3).replace(/\.?0+$/,'');
  }

  function makeVisitFromCandidate(parent, c, next, rows){
    const start = Number(c.start_ms || 0);
    let end = Number(c.end_ms || c.start_ms || 0);
    if(next && Number(next.start_ms || 0) > start){
      end = Number(next.start_ms) - 1;
    }else{
      end = Math.max(end, Number(parent.last_recv_ms || parent.updated_ms || Date.now()));
    }

    if(!start || !end || end < start) return null;

    const st = statsForWindow(rows, start, end);
    if(!st.activity) return null;

    const maxDepth = st.max_depth_m !== null ? depthText(st.max_depth_m) : '';
    const sid = s(parent.sid);
    const lat = s(c.latest_lat || c.lat);
    const lng = s(c.latest_lng || c.lng);
    const no = Number(c.candidate_no || 0) || 0;

    return {
      v:1,
      source:'gps_recorder_visit_candidate',
      sid:sid,
      gps_visit_id:gpsVisitId(sid, c),
      candidate_no:no,

      visit_start_ms:start,
      visit_end_ms:end,
      start_ms:st.first_recv_ms !== null ? st.first_recv_ms : start,
      updated_ms:st.last_recv_ms !== null ? st.last_recv_ms : end,

      gps_lat:lat,
      gps_lng:lng,
      gps_acc_m:s(c.best_acc_m || c.acc_m || ''),

      place_name:s(parent.place_name || ''),
      line_no:s(parent.line_no || ''),
      sinker_g:s(parent.sinker_g || ''),
      water_temp_c:s(parent.water_temp_c || ''),
      weather_text:s(parent.weather_text || parent.weather || ''),
      weather:s(parent.weather || parent.weather_text || ''),
      wind_dir:s(parent.wind_dir || ''),
      wind_speed_mps:s(parent.wind_speed_mps || ''),
      wind:s(parent.wind || ''),
      note:s(parent.note || ''),

      fishfinder_depth_m:maxDepth,
      water_depth_m:maxDepth,
      depth_source:maxDepth ? 'gps_recorder_reel_log_max' : '',
      depth_measured:maxDepth ? '1' : '0',
      depth_status:maxDepth ? 'measured' : 'not_measured',

      fish_count:Number(st.fish_count || 0),
      mark_count:0,
      tlog_count:Number(st.tlog_count || 0),

      first_seq:st.first_seq !== null ? st.first_seq : '',
      last_seq:st.last_seq !== null ? st.last_seq : '',
      first_t_ms:st.first_t_ms !== null ? st.first_t_ms : '',
      last_t_ms:st.last_t_ms !== null ? st.last_t_ms : '',
      first_recv_ms:st.first_recv_ms !== null ? st.first_recv_ms : '',
      last_recv_ms:st.last_recv_ms !== null ? st.last_recv_ms : '',

      min_depth_m:st.min_depth_m !== null ? st.min_depth_m.toFixed(3) : '',
      max_depth_m:st.max_depth_m !== null ? st.max_depth_m.toFixed(3) : '',
      motor_count:Number(st.motor_count || 0),
      pulse_count:Number(st.pulse_count || 0),
      fishing_event_count:Number(st.fishing_event_count || 0),
      depth_range_mm:Number(st.depth_range_mm || 0),
      activity_reason:s(st.activity_reason || ''),
      used_sasoi:Object.keys(st.used_sasoi || {}).join(','),
      used_speed:Object.keys(st.used_speed || {}).join(','),

      pico_point_visit_id:s(parent.point_visit_id || parent.pico_point_visit_id || ''),
      map_spot_id:s(parent.map_spot_id || ''),
      map_source:s(parent.map_source || '')
    };
  }

  async function injectRecorderVisits(payload){
    if(!payload || payload.__gps_recorder_visit_injected) return payload;
    const sid = s(payload.sid);
    if(!sid) return payload;

    const activityRows = normalizeActivityRows(payload);
    if(!activityRows.length) return payload;

    const candidates = await readCandidates(sid);
    if(!candidates.length) return payload;

    const visits = [];
    for(let i=0;i<candidates.length;i++){
      const v = makeVisitFromCandidate(payload, candidates[i], candidates[i+1] || null, activityRows);
      if(v) visits.push(v);
    }

    if(!visits.length) return payload;

    const out = Object.assign({}, payload);
    const existing = Array.isArray(payload.gps_visit_candidates) ? payload.gps_visit_candidates.slice() : [];
    const byId = new Map();
    for(const v of existing.concat(visits)){
      const id = s(v && (v.gps_visit_id || v.visit_id));
      if(id && !byId.has(id)) byId.set(id, v);
    }

    out.gps_visit_candidates = Array.from(byId.values());
    out.gps_visit_candidate_count = out.gps_visit_candidates.length;
    out.gps_visit_judged = 1;
    out.gps_recorder_candidate_count = candidates.length;
    out.gps_recorder_visit_candidate_count = visits.length;
    out.__gps_recorder_visit_injected = true;
    return out;
  }

  const originalApply = (typeof window.v112_applyLogSyncPayload === 'function') ? window.v112_applyLogSyncPayload : null;
  if(originalApply){
    const wrapped = async function(payload){
      const p2 = await injectRecorderVisits(payload);
      return await originalApply.call(this, p2);
    };
    try{
      window.v112_applyLogSyncPayload = wrapped;
      v112_applyLogSyncPayload = wrapped;
      console.info('[wakasagi] gps recorder visit inject installed', VERSION);
    }catch(e){
      console.warn('[wakasagi] gps recorder visit inject failed', e);
    }
  }else{
    console.warn('[wakasagi] gps recorder visit inject: v112_applyLogSyncPayload not found');
  }

  window.wakasagiGpsRecorderVisitInjectVersion = VERSION;
})();
