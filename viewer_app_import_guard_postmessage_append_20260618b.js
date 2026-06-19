/*
  viewer_app_import_guard_postmessage_append_20260618b.js

  追加位置:
    viewer/app.js の一番最後、既存の次の行の直後へ追加する。
      if(document.readyState === 'loading'){ document.addEventListener('DOMContentLoaded', init); }else{ init(); }

  目的:
    - Pico W側 .ino / GPS Bridge / gps-recorder / Map自動起動は一切触らない。
    - 既存viewerの貼り付け取り込みボタンをcapture段階で捕捉し、旧取り込み処理を止める。
    - 入力を URL(#payload/#logsync) / JSON / gps_visit_candidates / visits のどれでも受け、内部で normalized_visits[] に正規化する。
    - 保存前に 座標・実釣証拠・開始/終了時刻 を検証し、1970/Date.now代用保存を避ける。
    - 保存先は、viewer自身の wakasagi_trip_map_v10 / trip_records のまま。
*/
(function(){
  'use strict';

  const PATCH_VERSION = 'viewer_import_guard_postmessage_20260618b';
  const INSTALL_FLAG = '__wakasagiViewerImportGuardPostMessage20260618bInstalled';
  if(window[INSTALL_FLAG]) return;
  window[INSTALL_FLAG] = true;

  const MIN_REAL_MS = Date.UTC(2020, 0, 1);

  function el(id){ return document.getElementById(id); }
  function s(v){ return String(v == null ? '' : v).trim(); }
  function num(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }
  function posNum(){
    for(const v of arguments){
      const n = num(v);
      if(n !== null && n > 0) return n;
    }
    return null;
  }
  function anyNum(){
    for(const v of arguments){
      const n = num(v);
      if(n !== null) return n;
    }
    return null;
  }
  function clean(v){
    const x = s(v);
    if(!x || x === '-' || x === '未登録' || x === '未取得' || x === '未入力' || x === 'undefined' || x === 'null') return '';
    return x;
  }
  function clone(v){
    try{ return JSON.parse(JSON.stringify(v == null ? null : v)); }catch(e){ return v; }
  }
  function arr(v){ return Array.isArray(v) ? v : []; }
  function setStatus(text, mode){
    try{
      if(typeof importSetStatus === 'function') importSetStatus(text, mode || '');
      else if(el('importStatus')) el('importStatus').textContent = text;
    }catch(e){
      if(el('importStatus')) el('importStatus').textContent = text;
    }
  }
  function genId(prefix){
    try{ if(typeof importGenId === 'function') return importGenId(prefix); }catch(e){}
    return String(prefix || 'T') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }
  function validRealMs(v){
    const n = num(v);
    return n !== null && n >= MIN_REAL_MS ? n : 0;
  }
  function validLatLng(a, b){
    return Number.isFinite(a) && Number.isFinite(b) &&
      a >= -90 && a <= 90 && b >= -180 && b <= 180 && !(a === 0 && b === 0);
  }
  function firstText(){
    for(const v of arguments){
      const x = clean(v);
      if(x) return x;
    }
    return '';
  }
  function depthText(){
    let best = null;
    for(const v of arguments){
      const raw = s(v).replace(/[^0-9.\-]/g, '');
      const n = Number(raw);
      if(!Number.isFinite(n) || n <= 0) continue;
      if(best === null || n > best) best = n;
    }
    return best === null ? '' : String(best);
  }

  function decodeB64Json(raw){
    const x = s(raw);
    if(!x) return null;
    let bin = '';
    try{ bin = atob(x.replace(/-/g, '+').replace(/_/g, '/')); }catch(e){ return null; }
    try{
      if(window.TextDecoder){
        const bytes = new Uint8Array(bin.length);
        for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
        return JSON.parse(new TextDecoder('utf-8').decode(bytes));
      }
      return JSON.parse(decodeURIComponent(escape(bin)));
    }catch(e){
      try{ return JSON.parse(bin); }catch(e2){ return null; }
    }
  }

  function parseInput(text){
    const raw = s(text);
    if(!raw) throw new Error('入力が空です');

    try{ return JSON.parse(raw); }catch(e){}

    let hash = '';
    try{
      const u = new URL(raw, location.href);
      hash = s(u.hash || '');
    }catch(e){
      const i = raw.indexOf('#');
      if(i >= 0) hash = raw.slice(i);
    }
    if(hash && hash.charAt(0) === '#') hash = hash.slice(1);

    if(hash){
      const sp = new URLSearchParams(hash.replace(/^\?/, ''));
      const payload = sp.get('payload') || sp.get('logsync') || sp.get('gps_trip_save') || '';
      if(payload){
        const decoded = decodeB64Json(payload);
        if(decoded) return decoded;
        try{ return JSON.parse(decodeURIComponent(payload)); }catch(e){}
      }
    }

    const decodedWhole = decodeB64Json(raw);
    if(decodedWhole) return decodedWhole;

    throw new Error('JSON / #payload / #logsync として読めません');
  }

  function latOf(p){ return num(p && (p.gps_lat ?? p.latest_lat ?? p.lat)); }
  function lngOf(p){ return num(p && (p.gps_lng ?? p.latest_lng ?? p.lng)); }
  function accOf(p){ return posNum(p && (p.gps_acc_m ?? p.acc_m ?? p.acc ?? p.accuracy_m)) || 0; }

  function activityProof(p){
    if(!p) return {ok:false, reason:'no_payload'};
    if(posNum(p.motor_count, p.motorRun_count, p.motorRun) !== null) return {ok:true, reason:'motor_count'};
    if(posNum(p.pulse_count, p.pulseCount, p.pulse) !== null) return {ok:true, reason:'pulse_count'};
    if(posNum(p.fishing_event_count, p.event_count) !== null) return {ok:true, reason:'fishing_event_count'};
    if(posNum(p.tlog_activity_row_count) !== null) return {ok:true, reason:'tlog_activity_row_count'};
    if(Array.isArray(p.tlog_activity_rows) && p.tlog_activity_rows.length > 0) return {ok:true, reason:'tlog_activity_rows'};
    if(posNum(p.fish_count, p.mark_count) !== null) return {ok:true, reason:'fish_or_mark_count'};
    const r = s(p.activity_reason || p.body_activity_reason || '');
    if(/(^|,|\s)(motorRun|motor|pulse|event|fish|mark|tlog_activity)(,|\s|$)/i.test(r)) return {ok:true, reason:'activity_reason'};
    return {ok:false, reason:'activity_proof_missing'};
  }

  function pointStartOf(p){
    return validRealMs(
      p && (p.point_start_ms ?? p.visit_start_ms ?? p.body_start_ms ?? p.activity_start_ms ?? p.first_recv_ms ?? p.start_ms ?? p.trip_start_ms)
    );
  }
  function pointEndOf(p){
    return validRealMs(
      p && (p.point_end_ms ?? p.visit_end_ms ?? p.body_end_ms ?? p.activity_end_ms ?? p.last_recv_ms ?? p.end_ms ?? p.trip_end_ms)
    );
  }
  function tripStartOf(p, pStart){
    return validRealMs(p && (p.trip_start_ms ?? p.start_ms ?? p.first_recv_ms)) || pStart || 0;
  }
  function tripEndOf(p, pEnd){
    return validRealMs(p && (p.trip_end_ms ?? p.last_recv_ms ?? p.end_ms)) || pEnd || 0;
  }

  function mergeParent(parent, visit){
    const p = Object.assign({}, parent || {}, visit || {});
    p.__viewer_import_normalized_source = 'merged_visit';
    p.sid = firstText((visit && visit.sid), (parent && parent.sid));
    p.gps_lat = firstText((visit && (visit.gps_lat ?? visit.latest_lat ?? visit.lat)), (parent && (parent.gps_lat ?? parent.latest_lat ?? parent.lat)));
    p.gps_lng = firstText((visit && (visit.gps_lng ?? visit.latest_lng ?? visit.lng)), (parent && (parent.gps_lng ?? parent.latest_lng ?? parent.lng)));
    p.gps_acc_m = firstText((visit && (visit.gps_acc_m ?? visit.acc_m ?? visit.acc ?? visit.accuracy_m)), (parent && (parent.gps_acc_m ?? parent.acc_m ?? parent.acc ?? parent.accuracy_m)));

    const keys = [
      'lake_name','point_name','place_name','visit_label','candidate_no','visit_no',
      'trip_start_ms','trip_end_ms','point_start_ms','point_end_ms','visit_start_ms','visit_end_ms','start_ms','end_ms','first_recv_ms','last_recv_ms',
      'line_no','sinker_g','fishfinder_m','fishfinder_depth_m','water_depth_m','water_temp_c',
      'weather_text','weather','wind_dir','wind_speed_mps','wind','pressure_hpa','note','memo',
      'map_source','map_spot_id','fish_count','mark_count','tlog_count','tlog_activity_row_count','tlog_activity_rows',
      'depth_range_mm','first_seq','last_seq','first_t_ms','last_t_ms','min_depth_m','max_depth_m','used_sasoi','used_speed',
      'gps_quality','gps_quality_label','gps_candidate_count','gps_visit_candidate_count','depth_source','depth_measured','depth_status',
      'motor_count','pulse_count','fishing_event_count','activity_reason'
    ];
    for(const k of keys){
      if((p[k] == null || p[k] === '') && parent && parent[k] != null) p[k] = parent[k];
    }
    p.gps_visit_id = firstText(visit && (visit.gps_visit_id ?? visit.visit_id), parent && (parent.gps_visit_id ?? parent.visit_id));
    p.pico_point_visit_id = firstText(visit && visit.pico_point_visit_id, parent && (parent.point_visit_id ?? parent.map_point_key ?? parent.pico_point_visit_id));
    return p;
  }

  function expandPayload(payload){
    if(!payload) return [];
    if(Array.isArray(payload)) return payload.flatMap(expandPayload);
    if(Array.isArray(payload.visits)) return payload.visits.map(v => mergeParent(payload, v));
    if(Array.isArray(payload.normalized_visits)) return payload.normalized_visits.map(v => mergeParent(payload, v));
    if(Array.isArray(payload.gps_visit_candidates)) return payload.gps_visit_candidates.map(v => mergeParent(payload, v));
    if(payload.payload && typeof payload.payload === 'object') return expandPayload(payload.payload);
    return [payload];
  }

  function normalizeOne(raw, idx){
    const a = latOf(raw), b = lngOf(raw);
    if(!validLatLng(a, b)) return {ok:false, reason:'座標なし', raw};

    const proof = activityProof(raw);
    if(!proof.ok) return {ok:false, reason:'実釣証拠なし', raw};

    const pStart = pointStartOf(raw);
    const pEnd = pointEndOf(raw);
    if(!pStart) return {ok:false, reason:'ポイント開始時刻なし', raw};
    if(!pEnd) return {ok:false, reason:'ポイント終了時刻なし', raw};
    if(pEnd < pStart) return {ok:false, reason:'ポイント終了が開始より前', raw};

    const visitKey = firstText(raw.gps_visit_id, raw.visit_id) || ('VISIT_' + (idx + 1));
    const candidateNo = posNum(raw.candidate_no, raw.visit_no) || (idx + 1);
    const pointName = firstText(raw.point_name, raw.visit_label, candidateNo ? ('P' + candidateNo) : '', 'Pico W実釣地点');
    const depth = depthText(raw.fishfinder_depth_m, raw.water_depth_m, raw.fishfinder_m, raw.max_depth_m);

    const tripStart = tripStartOf(raw, pStart);
    const tripEnd = tripEndOf(raw, pEnd);

    return {
      ok:true,
      visit:{
        schema:'wakasagi.viewer_import.normalized_visit.v1',
        source:PATCH_VERSION,
        sid:firstText(raw.sid, raw.pico_sid),
        gps_visit_id:visitKey,
        candidate_no:candidateNo,
        visit_label:firstText(raw.visit_label, pointName),
        pico_point_visit_id:firstText(raw.pico_point_visit_id, raw.point_visit_id, raw.map_point_key),
        map_spot_id:firstText(raw.map_spot_id, raw.spot_id),

        lat:a,
        lng:b,
        accuracy_m:accOf(raw),
        location_time_ms:validRealMs(raw.gps_ms) || pStart,

        trip_start_ms:tripStart,
        trip_end_ms:tripEnd,
        point_start_ms:pStart,
        point_end_ms:pEnd,
        date_ms:tripStart || pStart,

        lake_name:firstText(raw.lake_name, raw.place_name),
        point_name:pointName,
        line_no:firstText(raw.line_no, raw.line),
        sinker_g:firstText(raw.sinker_g, raw.sinker),
        fishfinder_depth_m:depth,
        water_depth_m:depth,
        depth_status:depth ? 'measured' : firstText(raw.depth_status, 'not_measured'),
        water_temp_c:firstText(raw.water_temp_c),
        weather_text:firstText(raw.weather_text, raw.weather),
        weather:firstText(raw.weather, raw.weather_text),
        wind_dir:firstText(raw.wind_dir),
        wind_speed_mps:firstText(raw.wind_speed_mps),
        wind:firstText(raw.wind, raw.wind_dir),
        pressure_hpa:firstText(raw.pressure_hpa, raw.pressure, raw.air_pressure_hpa),
        memo:firstText(raw.memo, raw.note),

        fish_count:posNum(raw.fish_count) || 0,
        mark_count:posNum(raw.mark_count) || 0,
        tlog_count:posNum(raw.tlog_count) || 0,
        tlog_activity_row_count:posNum(raw.tlog_activity_row_count) || arr(raw.tlog_activity_rows).length || 0,
        tlog_activity_rows:Array.isArray(raw.tlog_activity_rows) ? clone(raw.tlog_activity_rows) : [],
        activity_reason:firstText(raw.activity_reason, proof.reason),
        activity_proof_reason:proof.reason,
        motor_count:posNum(raw.motor_count) || 0,
        pulse_count:posNum(raw.pulse_count) || 0,
        fishing_event_count:posNum(raw.fishing_event_count) || 0,

        first_seq:anyNum(raw.first_seq) ?? '',
        last_seq:anyNum(raw.last_seq) ?? '',
        first_t_ms:anyNum(raw.first_t_ms) ?? '',
        last_t_ms:anyNum(raw.last_t_ms) ?? '',
        first_recv_ms:validRealMs(raw.first_recv_ms) || '',
        last_recv_ms:validRealMs(raw.last_recv_ms) || '',
        min_depth_m:firstText(raw.min_depth_m),
        max_depth_m:firstText(raw.max_depth_m),
        depth_range_mm:posNum(raw.depth_range_mm) || '',
        used_sasoi:firstText(raw.used_sasoi),
        used_speed:firstText(raw.used_speed),
        gps_quality:firstText(raw.gps_quality),
        gps_quality_label:firstText(raw.gps_quality_label),
        gps_candidate_count:posNum(raw.gps_candidate_count) || 0,
        gps_visit_candidate_count:posNum(raw.gps_visit_candidate_count) || 0,
        candidate_window_start_ms:validRealMs(raw.candidate_window_start_ms) || '',
        candidate_window_end_ms:validRealMs(raw.candidate_window_end_ms) || '',
        raw_payload:clone(raw)
      }
    };
  }

  function normalizePayload(payload){
    const expanded = expandPayload(payload);
    const visits = [];
    const rejected = [];
    expanded.forEach((raw, idx) => {
      const r = normalizeOne(raw, idx);
      if(r.ok) visits.push(r.visit);
      else rejected.push({reason:r.reason, index:idx});
    });
    return {visits, rejected, total:expanded.length};
  }

  function makePicoSummary(v){
    return {
      v:2,
      source:PATCH_VERSION,
      sid:v.sid,
      gps_visit_id:v.gps_visit_id,
      pico_point_visit_id:v.pico_point_visit_id,
      lake_name:v.lake_name,
      point_name:v.point_name,
      visit_label:v.visit_label,
      candidate_no:v.candidate_no,
      trip_start_ms:v.trip_start_ms,
      trip_end_ms:v.trip_end_ms,
      point_start_ms:v.point_start_ms,
      point_end_ms:v.point_end_ms,
      line_no:v.line_no,
      sinker_g:v.sinker_g,
      fishfinder_depth_m:v.fishfinder_depth_m,
      water_temp_c:v.water_temp_c,
      weather:v.weather_text || v.weather,
      wind:v.wind,
      pressure_hpa:v.pressure_hpa,
      fish_count:v.fish_count,
      mark_count:v.mark_count,
      tlog_count:v.tlog_count,
      tlog_activity_row_count:v.tlog_activity_row_count,
      tlog_activity_rows:clone(v.tlog_activity_rows),
      activity_proof_reason:v.activity_proof_reason,
      first_seq:v.first_seq,
      last_seq:v.last_seq,
      first_t_ms:v.first_t_ms,
      last_t_ms:v.last_t_ms,
      first_recv_ms:v.first_recv_ms,
      last_recv_ms:v.last_recv_ms,
      min_depth_m:v.min_depth_m,
      max_depth_m:v.max_depth_m,
      depth_range_mm:v.depth_range_mm,
      used_sasoi:v.used_sasoi,
      used_speed:v.used_speed,
      gps_quality:v.gps_quality,
      gps_quality_label:v.gps_quality_label,
      received_ms:Date.now()
    };
  }

  async function findExisting(v){
    let rows = [];
    try{ rows = await getAllTrips(); }catch(e){ rows = []; }
    const visitKey = s(v.gps_visit_id);
    const pointKey = s(v.pico_point_visit_id);
    for(const t of rows){
      if(visitKey && s(t.gps_visit_id) === visitKey) return t;
      if(visitKey && t.pico_summary && s(t.pico_summary.gps_visit_id) === visitKey) return t;
      if(visitKey && Array.isArray(t.pico_logs) && t.pico_logs.some(x => s(x.gps_visit_id) === visitKey)) return t;
      if(pointKey && s(t.pico_point_visit_id) === pointKey) return t;
      if(pointKey && t.pico_summary && s(t.pico_summary.pico_point_visit_id) === pointKey) return t;
    }
    return null;
  }

  function putIfBlank(t, k, v){
    const x = clean(v);
    if(x && !clean(t[k])) t[k] = x;
  }

  function makeTrip(v, existing){
    const now = Date.now();
    const t = Object.assign({}, existing || {});
    if(!t.trip_id) t.trip_id = genId('T');

    t.pico_sid = v.sid;
    t.gps_visit_id = v.gps_visit_id;
    t.candidate_no = v.candidate_no;
    t.visit_label = v.visit_label;
    t.pico_point_visit_id = v.pico_point_visit_id;
    t.point_visit_id = '';
    t.map_point_key = '';
    t.map_spot_id = t.map_spot_id || v.map_spot_id || '';

    t.date_ms = v.date_ms;
    t.location_time_ms = v.location_time_ms;
    t.trip_start_ms = v.trip_start_ms;
    t.trip_end_ms = v.trip_end_ms;
    t.point_start_ms = v.point_start_ms;
    t.point_end_ms = v.point_end_ms;

    t.lat = v.lat;
    t.lng = v.lng;
    t.accuracy_m = v.accuracy_m;

    putIfBlank(t, 'lake_name', v.lake_name);
    putIfBlank(t, 'point_name', v.point_name);
    putIfBlank(t, 'line_no', v.line_no);
    putIfBlank(t, 'sinker_g', v.sinker_g);
    putIfBlank(t, 'water_temp_c', v.water_temp_c);
    putIfBlank(t, 'weather_text', v.weather_text);
    putIfBlank(t, 'weather', v.weather);
    putIfBlank(t, 'wind_dir', v.wind_dir);
    putIfBlank(t, 'wind_speed_mps', v.wind_speed_mps);
    putIfBlank(t, 'wind', v.wind);
    putIfBlank(t, 'pressure_hpa', v.pressure_hpa);
    putIfBlank(t, 'memo', v.memo);

    if(v.fishfinder_depth_m){
      t.fishfinder_depth_m = depthText(t.fishfinder_depth_m, v.fishfinder_depth_m);
      t.water_depth_m = t.fishfinder_depth_m;
      t.depth_status = 'measured';
    }else if(!t.depth_status){
      t.depth_status = v.depth_status || 'not_measured';
    }
    t.depth_last_sync_ms = now;

    t.fish_count = v.fish_count;
    t.mark_count = v.mark_count;
    t.tlog_count = v.tlog_count;
    t.tlog_activity_row_count = v.tlog_activity_row_count;
    if(Array.isArray(v.tlog_activity_rows) && v.tlog_activity_rows.length) t.tlog_activity_rows = clone(v.tlog_activity_rows);
    t.activity_proof_reason = v.activity_proof_reason;
    t.motor_count = v.motor_count;
    t.pulse_count = v.pulse_count;
    t.fishing_event_count = v.fishing_event_count;

    t.first_seq = v.first_seq;
    t.last_seq = v.last_seq;
    t.first_t_ms = v.first_t_ms;
    t.last_t_ms = v.last_t_ms;
    t.first_recv_ms = v.first_recv_ms;
    t.last_recv_ms = v.last_recv_ms;
    t.min_depth_m = v.min_depth_m;
    t.max_depth_m = v.max_depth_m;
    t.depth_range_mm = v.depth_range_mm;
    t.used_sasoi = v.used_sasoi;
    t.used_speed = v.used_speed;
    t.gps_quality = v.gps_quality;
    t.gps_quality_label = v.gps_quality_label;
    t.gps_candidate_count = v.gps_candidate_count;
    t.gps_visit_candidate_count = v.gps_visit_candidate_count;
    t.candidate_window_start_ms = v.candidate_window_start_ms;
    t.candidate_window_end_ms = v.candidate_window_end_ms;

    t.pico_payload = clone(v.raw_payload);
    t.pico_payload_saved_ms = now;
    t.import_schema = v.schema;
    t.import_source = PATCH_VERSION;

    t.pico_logs = Array.isArray(t.pico_logs) ? t.pico_logs : [];
    const summary = makePicoSummary(v);
    t.pico_logs = t.pico_logs.filter(x => s(x.gps_visit_id) !== s(v.gps_visit_id));
    t.pico_logs.push(summary);
    t.pico_summary = summary;

    if(!t.created_ms) t.created_ms = now;
    t.updated_ms = now;
    t.saved_by = PATCH_VERSION;
    return t;
  }

  function putTripDirect(t){
    return new Promise(resolve => {
      try{
        if(!db){ resolve(false); return; }
        const tx = db.transaction('trip_records', 'readwrite');
        tx.objectStore('trip_records').put(t);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      }catch(e){ resolve(false); }
    });
  }

  async function safeImportFromText(){
    if(!db) db = await openDb();
    const box = el('importBox');
    const payload = parseInput(box ? box.value : '');
    const norm = normalizePayload(payload);
    if(!norm.visits.length){
      const reasons = norm.rejected.map(x => x.reason).filter(Boolean).join(' / ') || '保存可能なvisitなし';
      return {ok:false, saved_count:0, reason:reasons};
    }

    let saved = 0;
    const ids = [];
    for(const v of norm.visits){
      const existing = await findExisting(v);
      const trip = makeTrip(v, existing);
      if(await putTripDirect(trip)){
        saved++;
        ids.push(trip.trip_id);
      }
    }
    return {ok:saved > 0, saved_count:saved, trip_ids:ids, rejected:norm.rejected};
  }

  async function onImportClick(ev){
    if(ev){
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
    }
    try{
      setStatus('検証中...', 'warn');
      const result = await safeImportFromText();
      if(result.ok){
        const rej = result.rejected && result.rejected.length ? ` / 除外 ${result.rejected.length}件` : '';
        setStatus(`保存完了: ${result.saved_count}地点${rej}`, 'good');
        try{ await reload(); }catch(e){}
        try{ if(result.trip_ids && result.trip_ids.length) selectTrip(result.trip_ids[result.trip_ids.length - 1]); }catch(e){}
      }else{
        setStatus(`保存なし: ${result.reason || 'unknown'}`, 'bad');
      }
    }catch(e){
      setStatus(`取り込み失敗: ${e && e.message ? e.message : e}`, 'bad');
    }
  }

  function install(){
    const btn = el('btnImportTrips');
    if(!btn) return;
    btn.addEventListener('click', onImportClick, true);
    setStatus('待機中', '');
    try{ console.log(PATCH_VERSION); }catch(e){}
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', () => setTimeout(install, 0));
  }else{
    setTimeout(install, 0);
  }


  async function safeImportFromPayloadObject(payload){
    if(!db) db = await openDb();
    const norm = normalizePayload(payload);
    if(!norm.visits.length){
      const reasons = norm.rejected.map(x => x.reason).filter(Boolean).join(' / ') || '保存可能なvisitなし';
      return {ok:false, saved_count:0, reason:reasons, rejected:norm.rejected};
    }

    let saved = 0;
    const ids = [];
    for(const v of norm.visits){
      const existing = await findExisting(v);
      const trip = makeTrip(v, existing);
      if(await putTripDirect(trip)){
        saved++;
        ids.push(trip.trip_id);
      }
    }
    return {ok:saved > 0, saved_count:saved, trip_ids:ids, rejected:norm.rejected};
  }

  async function receivePostMessage(ev){
    try{
      const d = ev && ev.data;
      if(!d || d.type !== 'wakasagi.viewer_import.v1') return;
      const payload = d.payload || d.data || null;
      if(!payload){
        setStatus('受信失敗: payloadなし', 'bad');
        return;
      }

      const box = el('importBox');
      if(box){
        try{ box.value = JSON.stringify(payload, null, 2); }catch(e){ box.value = String(payload); }
      }

      setStatus('受信済み。検証中...', 'warn');
      const result = await safeImportFromPayloadObject(payload);
      if(result.ok){
        const rej = result.rejected && result.rejected.length ? ` / 除外 ${result.rejected.length}件` : '';
        setStatus(`保存完了: ${result.saved_count}地点${rej}`, 'good');
        try{ await reload(); }catch(e){}
        try{ if(result.trip_ids && result.trip_ids.length) selectTrip(result.trip_ids[result.trip_ids.length - 1]); }catch(e){}
      }else{
        setStatus(`保存なし: ${result.reason || 'unknown'}`, 'bad');
      }

      try{
        if(ev.source && ev.source.postMessage){
          ev.source.postMessage({type:'wakasagi.viewer_import.result', ok:!!result.ok, saved_count:result.saved_count||0, reason:result.reason||'', at_ms:Date.now()}, ev.origin || '*');
        }
      }catch(e){}
    }catch(e){
      setStatus(`受信取り込み失敗: ${e && e.message ? e.message : e}`, 'bad');
    }
  }

  window.addEventListener('message', receivePostMessage, false);

})();
