(function(){
  'use strict';

  const INSTALL_FLAG = '__wakasagiStage2VisitReceiver20260522eInstalled';
  if(window[INSTALL_FLAG]) return;
  window[INSTALL_FLAG] = true;

  function s(v){ return String(v == null ? '' : v).trim(); }
  function n(v){ const x = Number(v); return Number.isFinite(x) ? x : null; }
  function hasLatLng(p){
    return Number.isFinite(Number(p && (p.gps_lat || p.latest_lat || p.lat))) &&
           Number.isFinite(Number(p && (p.gps_lng || p.latest_lng || p.lng)));
  }
  function depthMaxTextLocal(){
    try{
      if(typeof v112_depthMaxText === 'function') return v112_depthMaxText.apply(null, arguments);
    }catch(e){}
    for(const v of arguments){
      const t = s(v);
      if(t && t !== '-' && t !== '0' && t !== '0.0') return t;
    }
    return '';
  }
  function setLogSync(text, cls){
    try{
      if(typeof v112_setLogSync === 'function') v112_setLogSync(text, cls || '');
    }catch(e){}
  }
  function clearLogSyncHash(){
    try{
      if(history && history.replaceState){
        history.replaceState(null, document.title, location.pathname + location.search);
      }
    }catch(e){}
  }
  function firstNumber(){
    for(let i=0;i<arguments.length;i++){
      const x = n(arguments[i]);
      if(x !== null) return x;
    }
    return null;
  }
  function fmtMs(ms){
    const x = n(ms);
    if(x === null || x <= 0) return '-';
    try{ if(typeof fmtTime === 'function') return fmtTime(x); }catch(e){}
    try{ return new Date(x).toLocaleString('ja-JP'); }catch(e){}
    return String(x);
  }
  function val(v){ return s(v) || '-'; }

  async function stopNoBodyActivity(text){
    clearLogSyncHash();
    try{
      if(typeof refreshAll === 'function') await refreshAll();
    }catch(e){}
    setLogSync(text || '実釣なし: 保存なし','warn');
    return false;
  }
  function hasBodyActivityProof(v){
    if(!v) return false;
    if(Number(v.motor_count || 0) > 0) return true;
    if(Number(v.pulse_count || 0) > 0) return true;
    if(Number(v.fishing_event_count || 0) > 0) return true;
    const r = s(v.activity_reason || '');
    if(/(^|,)(motorRun|pulse|event)(,|$)/.test(r)) return true;
    return false;
  }
  function isPicoLogSyncPayload(p){
    if(!p) return false;
    if(s(p.source) === 'pico_log_summary') return true;
    if(p.gps_visit_judged !== undefined) return true;
    if(Array.isArray(p.gps_visit_candidates)) return true;
    if(Array.isArray(p.gps_candidates)) return true;
    if(Number(p.gps_candidate_count || 0) > 0) return true;
    return false;
  }

  const originalFind = (typeof v112_findTripForLogSync === 'function') ? v112_findTripForLogSync : null;
  const originalMake = (typeof v112_makeTripFromLogSync === 'function') ? v112_makeTripFromLogSync : null;
  const originalSummary = (typeof v112_makePicoSummary === 'function') ? v112_makePicoSummary : null;
  const originalApply = (typeof v112_applyLogSyncPayload === 'function') ? v112_applyLogSyncPayload : null;
  if(!originalApply) return;

  async function stage2FindTripForLogSync(p){
    const visitKey = s(p && (p.gps_visit_id || p.visit_id));
    if(visitKey && typeof getAllTrips === 'function'){
      const trips = await getAllTrips();
      for(const t of trips){
        if(s(t.gps_visit_id) === visitKey) return t;
        if(t.pico_summary && s(t.pico_summary.gps_visit_id) === visitKey) return t;
        if(Array.isArray(t.pico_logs) && t.pico_logs.some(l => s(l.gps_visit_id) === visitKey)) return t;
      }
      return null;
    }
    if(originalFind) return await originalFind.call(this, p);
    return null;
  }

  function stage2MakeTripFromLogSync(p){
    const visitKey = s(p && (p.gps_visit_id || p.visit_id));
    if(!visitKey || !originalMake) return originalMake ? originalMake.call(this, p) : null;

    const t = originalMake.call(this, p);
    if(!t) return t;

    const candidateNo = firstNumber(p.candidate_no, p.visit_no);
    const visitLabel = s(p.visit_label || (candidateNo !== null ? ('P' + candidateNo) : ''));
    const tripStartMs = firstNumber(p.trip_start_ms, p.start_ms, p.first_recv_ms, p.visit_start_ms);
    const tripEndMs = firstNumber(p.trip_end_ms, p.updated_ms, p.last_recv_ms, p.visit_end_ms);
    const pointStartMs = firstNumber(p.point_start_ms, p.visit_start_ms, p.start_ms, p.first_recv_ms);
    const pointEndMs = firstNumber(p.point_end_ms, p.visit_end_ms, p.updated_ms, p.last_recv_ms);

    t.gps_visit_id = visitKey;
    t.candidate_no = candidateNo !== null ? candidateNo : '';
    t.visit_label = visitLabel;
    t.pico_point_visit_id = s(p.pico_point_visit_id || p.point_visit_id || p.map_point_key);
    t.point_visit_id = '';
    t.map_point_key = '';

    t.date_ms = firstNumber(p.start_ms, p.first_recv_ms, p.visit_start_ms) || t.date_ms || Date.now();
    t.location_time_ms = firstNumber(p.visit_start_ms, p.gps_ms, p.start_ms) || t.location_time_ms || Date.now();

    if(tripStartMs !== null) t.trip_start_ms = tripStartMs;
    if(tripEndMs !== null) t.trip_end_ms = tripEndMs;
    if(pointStartMs !== null) t.point_start_ms = pointStartMs;
    if(pointEndMs !== null) t.point_end_ms = pointEndMs;
    if(firstNumber(p.visit_start_ms) !== null) t.visit_start_ms = firstNumber(p.visit_start_ms);
    if(firstNumber(p.visit_end_ms) !== null) t.visit_end_ms = firstNumber(p.visit_end_ms);

    t.fish_count = firstNumber(p.fish_count) !== null ? firstNumber(p.fish_count) : (t.fish_count || 0);
    t.mark_count = firstNumber(p.mark_count) !== null ? firstNumber(p.mark_count) : (t.mark_count || 0);
    t.tlog_count = firstNumber(p.tlog_count) !== null ? firstNumber(p.tlog_count) : (t.tlog_count || 0);
    t.depth_range_mm = firstNumber(p.depth_range_mm) !== null ? firstNumber(p.depth_range_mm) : (t.depth_range_mm || '');
    t.pressure_hpa = s(p.pressure_hpa || t.pressure_hpa || '');

    if(!s(t.lake_name) && (p.lake_name || p.place_name)) t.lake_name = s(p.lake_name || p.place_name);
    if(!s(t.point_name)) t.point_name = s(p.point_name || visitLabel || 'Pico W実釣地点');
    if(s(t.point_name) === 'Pico W実釣地点' && visitLabel) t.point_name = visitLabel;

    return t;
  }

  function stage2MakePicoSummary(p){
    const x = originalSummary ? originalSummary.call(this, p) : {};

    if(p && (p.gps_visit_id || p.visit_id)) x.gps_visit_id = s(p.gps_visit_id || p.visit_id);
    if(p && p.pico_point_visit_id) x.pico_point_visit_id = s(p.pico_point_visit_id);

    x.lake_name = s((p && (p.lake_name || p.place_name)) || x.lake_name || '');
    x.point_name = s((p && (p.point_name || p.visit_label)) || x.point_name || '');
    x.visit_label = s((p && p.visit_label) || x.visit_label || '');
    x.candidate_no = firstNumber(p && p.candidate_no) !== null ? firstNumber(p.candidate_no) : (x.candidate_no || '');

    x.trip_start_ms = firstNumber(p && p.trip_start_ms, p && p.start_ms, p && p.first_recv_ms) || x.trip_start_ms || 0;
    x.trip_end_ms = firstNumber(p && p.trip_end_ms, p && p.updated_ms, p && p.last_recv_ms) || x.trip_end_ms || 0;
    x.point_start_ms = firstNumber(p && p.point_start_ms, p && p.visit_start_ms, p && p.start_ms, p && p.first_recv_ms) || x.point_start_ms || 0;
    x.point_end_ms = firstNumber(p && p.point_end_ms, p && p.visit_end_ms, p && p.updated_ms, p && p.last_recv_ms) || x.point_end_ms || 0;
    x.visit_start_ms = firstNumber(p && p.visit_start_ms) || x.visit_start_ms || 0;
    x.visit_end_ms = firstNumber(p && p.visit_end_ms) || x.visit_end_ms || 0;

    x.line_no = s((p && p.line_no) || x.line_no || '');
    x.sinker_g = s((p && p.sinker_g) || x.sinker_g || '');
    x.fishfinder_depth_m = s((p && (p.fishfinder_depth_m || p.water_depth_m || p.fishfinder_m || p.max_depth_m)) || x.fishfinder_depth_m || '');
    x.water_temp_c = s((p && p.water_temp_c) || x.water_temp_c || '');
    x.weather = s((p && (p.weather_text || p.weather)) || x.weather || '');
    x.wind = s((p && (p.wind || p.wind_dir)) || x.wind || '');
    x.pressure_hpa = s((p && p.pressure_hpa) || x.pressure_hpa || '');
    x.depth_range_mm = firstNumber(p && p.depth_range_mm) !== null ? firstNumber(p.depth_range_mm) : (x.depth_range_mm || '');

    return x;
  }

  function mergeVisitPayload(parent, visit){
    const p = Object.assign({}, parent || {}, visit || {});
    p.__stage2_single_visit = true;
    p.sid = s((parent && parent.sid) || (visit && visit.sid));
    const fallbackKeys = [
      'lake_name','point_name','place_name','visit_label','candidate_no',
      'trip_start_ms','trip_end_ms','point_start_ms','point_end_ms','visit_start_ms','visit_end_ms',
      'line_no','sinker_g','fishfinder_m','fishfinder_depth_m','water_depth_m',
      'water_temp_c','weather_text','weather','wind_dir','wind_speed_mps','wind','pressure_hpa','note','map_source',
      'fish_count','mark_count','tlog_count','depth_range_mm'
    ];
    for(const k of fallbackKeys){
      if(!s(p[k]) && parent && parent[k] !== undefined) p[k] = parent[k];
    }
    p.gps_visit_id = s(visit && (visit.gps_visit_id || visit.visit_id));
    p.pico_point_visit_id = s((visit && visit.pico_point_visit_id) || (parent && (parent.point_visit_id || parent.map_point_key || parent.pico_point_visit_id)));
    p.gps_lat = s((visit && (visit.gps_lat || visit.latest_lat || visit.lat)) || p.gps_lat || p.lat);
    p.gps_lng = s((visit && (visit.gps_lng || visit.latest_lng || visit.lng)) || p.gps_lng || p.lng);
    p.gps_acc_m = s((visit && (visit.gps_acc_m || visit.acc_m || visit.acc)) || p.gps_acc_m || p.acc);
    p.point_visit_id = '';
    p.map_point_key = '';
    const depth = depthMaxTextLocal(p.fishfinder_depth_m, p.max_depth_m, p.fishfinder_m, p.water_depth_m);
    p.fishfinder_depth_m = depth;
    p.water_depth_m = depth;
    p.depth_status = depth ? 'measured' : 'not_measured';
    return p;
  }

  async function stage2ApplyLogSyncPayload(p){
    if(!p || p.__error) return await originalApply.call(this, p);

    if(p.__stage2_single_visit){
      if(!hasBodyActivityProof(p)) return await stopNoBodyActivity('実釣なし: 保存なし');
      return await originalApply.call(this, p);
    }

    if(isPicoLogSyncPayload(p)){
      if(Array.isArray(p.gps_visit_candidates)){
        const visits = p.gps_visit_candidates.filter(v =>
          v &&
          s(v.gps_visit_id || v.visit_id) &&
          hasLatLng(v) &&
          hasBodyActivityProof(v)
        );

        if(!visits.length){
          return await stopNoBodyActivity('実釣なし: 保存なし');
        }

        let saved = 0;
        for(const v of visits){
          const one = mergeVisitPayload(p, v);
          if(await stage2ApplyLogSyncPayload(one)) saved++;
        }

        clearLogSyncHash();
        try{
          if(typeof refreshAll === 'function') await refreshAll();
        }catch(e){}
        try{
          if(typeof fitInitialLakeViewOnce === 'function') fitInitialLakeViewOnce(true);
        }catch(e){}
        setLogSync('実釣' + saved + '地点同期','good');
        return saved > 0;
      }

      return await stopNoBodyActivity('実釣なし: 保存なし');
    }

    return await originalApply.call(this, p);
  }

  function stage2EnvTimeHtml(t){
    const summary = t && (t.pico_summary || (Array.isArray(t.pico_logs) && t.pico_logs.length ? t.pico_logs[t.pico_logs.length-1] : null));
    if(!summary && !t) return '';
    const src = summary || {};
    const lakeName = s((t && t.lake_name) || src.lake_name || '');
    const pointName = s((t && t.point_name) || src.point_name || src.visit_label || '');
    const fishCount = firstNumber((t && t.fish_count), src.fish_count);
    const pressure = s((t && t.pressure_hpa) || src.pressure_hpa || '');
    const tripStart = firstNumber((t && t.trip_start_ms), src.trip_start_ms, (t && t.date_ms), src.start_ms, src.first_recv_ms);
    const tripEnd = firstNumber((t && t.trip_end_ms), src.trip_end_ms, (t && t.updated_ms), src.updated_ms, src.last_recv_ms);
    const pointStart = firstNumber((t && t.point_start_ms), src.point_start_ms, (t && t.visit_start_ms), src.visit_start_ms, src.start_ms, src.first_recv_ms);
    const pointEnd = firstNumber((t && t.point_end_ms), src.point_end_ms, (t && t.visit_end_ms), src.visit_end_ms, src.updated_ms, src.last_recv_ms);
    const visitLabel = s((t && t.visit_label) || src.visit_label || '');
    const depthRange = firstNumber((t && t.depth_range_mm), src.depth_range_mm);
    const gpsVisitId = s((t && t.gps_visit_id) || src.gps_visit_id || '');

    return `
      <div class="detailBlock picoEnvTimeBlock">
        <h3>Pico W地点・環境</h3>
        <dl>
          <dt>湖名</dt><dd>${val(lakeName)}</dd>
          <dt>地点</dt><dd>${val(pointName)}${visitLabel ? ' / ' + val(visitLabel) : ''}</dd>
          <dt>釣行開始</dt><dd>${fmtMs(tripStart)}</dd>
          <dt>釣行終了</dt><dd>${fmtMs(tripEnd)}</dd>
          <dt>ポイント開始</dt><dd>${fmtMs(pointStart)}</dd>
          <dt>ポイント終了</dt><dd>${fmtMs(pointEnd)}</dd>
          <dt>魚数</dt><dd>${fishCount === null ? '-' : String(fishCount)}</dd>
          <dt>気圧</dt><dd>${pressure ? pressure + ' hPa' : '-'}</dd>
          <dt>水深範囲</dt><dd>${depthRange === null ? '-' : String(depthRange) + ' mm'}</dd>
          <dt>GPS visit</dt><dd>${val(gpsVisitId)}</dd>
        </dl>
      </div>`;
  }

  try{
    if(!window.__wakasagiStage2EnvTimeDetailWrapped && typeof detailHtml === 'function'){
      window.__wakasagiStage2EnvTimeDetailWrapped = true;
      const prevDetailHtml = detailHtml;
      detailHtml = function(t, base){
        return prevDetailHtml(t, base) + stage2EnvTimeHtml(t);
      };
      window.detailHtml = detailHtml;
    }
  }catch(e){}

  try{
    window.v112_findTripForLogSync = stage2FindTripForLogSync;
    v112_findTripForLogSync = stage2FindTripForLogSync;
  }catch(e){}
  try{
    window.v112_makeTripFromLogSync = stage2MakeTripFromLogSync;
    v112_makeTripFromLogSync = stage2MakeTripFromLogSync;
  }catch(e){}
  try{
    window.v112_makePicoSummary = stage2MakePicoSummary;
    v112_makePicoSummary = stage2MakePicoSummary;
  }catch(e){}
  try{
    window.v112_applyLogSyncPayload = stage2ApplyLogSyncPayload;
    v112_applyLogSyncPayload = stage2ApplyLogSyncPayload;
  }catch(e){}

  console.info('[wakasagi] stage2 visit receiver 20260611f installed - env time fields');
})();
