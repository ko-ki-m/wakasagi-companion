(function(){
  'use strict';
  const INSTALL_FLAG = '__wakasagiStage2VisitReceiver20260522eInstalled';
  if(window[INSTALL_FLAG]) return;
  window[INSTALL_FLAG] = true;

  function s(v){ return String(v == null ? '' : v).trim(); }
  function n(v){ const x = Number(v); return Number.isFinite(x) ? x : null; }
  function firstNum(){
    for(const v of arguments){
      const x = n(v);
      if(x !== null && x > 0) return x;
    }
    return null;
  }
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

    const startMs = firstNum(p.visit_start_ms, p.start_ms, p.first_recv_ms, t.date_ms, Date.now());
    const endMs = firstNum(p.visit_end_ms, p.updated_ms, p.last_recv_ms, p.end_ms);

    t.gps_visit_id = visitKey;
    t.pico_point_visit_id = s(p.pico_point_visit_id || p.point_visit_id || p.map_point_key);
    t.point_visit_id = '';
    t.map_point_key = '';
    t.date_ms = startMs || t.date_ms || Date.now();
    t.visit_start_ms = startMs || t.visit_start_ms || 0;
    t.start_ms = startMs || t.start_ms || 0;
    if(endMs){
      t.visit_end_ms = endMs;
      t.end_ms = endMs;
    }
    t.location_time_ms = firstNum(p.gps_ms, p.visit_start_ms, p.start_ms, t.location_time_ms, Date.now());
    if(!s(t.point_name)) t.point_name = 'Pico W実釣地点';
    if(!s(t.weather_text) && (p.weather_text || p.weather)) t.weather_text = s(p.weather_text || p.weather);
    if(!s(t.wind_dir) && p.wind_dir) t.wind_dir = s(p.wind_dir);
    if(!s(t.wind_speed_mps) && p.wind_speed_mps) t.wind_speed_mps = s(p.wind_speed_mps);
    if(!s(t.pressure_hpa) && (p.pressure_hpa || p.pressure || p.air_pressure_hpa)) t.pressure_hpa = s(p.pressure_hpa || p.pressure || p.air_pressure_hpa);
    return t;
  }

  function stage2MakePicoSummary(p){
    const x = originalSummary ? originalSummary.call(this, p) : {};
    if(p && (p.gps_visit_id || p.visit_id)) x.gps_visit_id = s(p.gps_visit_id || p.visit_id);
    if(p && p.pico_point_visit_id) x.pico_point_visit_id = s(p.pico_point_visit_id);
    const startMs = firstNum(p && p.visit_start_ms, p && p.start_ms, p && p.first_recv_ms);
    const endMs = firstNum(p && p.visit_end_ms, p && p.updated_ms, p && p.last_recv_ms, p && p.end_ms);
    if(startMs){ x.visit_start_ms = startMs; if(!x.start_ms) x.start_ms = startMs; }
    if(endMs){ x.visit_end_ms = endMs; if(!x.updated_ms) x.updated_ms = endMs; }
    if(p){
      x.lake_name = s(p.lake_name || x.lake_name);
      x.point_name = s(p.point_name || p.place_name || x.point_name);
      x.water_temp_c = s(p.water_temp_c || x.water_temp_c);
      x.weather_text = s(p.weather_text || p.weather || x.weather_text);
      x.weather = s(p.weather_text || p.weather || x.weather);
      x.wind_dir = s(p.wind_dir || x.wind_dir);
      x.wind_speed_mps = s(p.wind_speed_mps || x.wind_speed_mps);
      x.wind = s(p.wind || p.wind_dir || x.wind);
      x.pressure_hpa = s(p.pressure_hpa || p.pressure || p.air_pressure_hpa || x.pressure_hpa);
    }
    return x;
  }

  function mergeVisitPayload(parent, visit){
    const p = Object.assign({}, parent || {}, visit || {});
    p.__stage2_single_visit = true;
    p.sid = s((parent && parent.sid) || (visit && visit.sid));
    const fallbackKeys = [
      'lake_name','point_name','place_name','line_no','sinker_g','water_temp_c',
      'weather_text','weather','wind_dir','wind_speed_mps','wind','pressure_hpa',
      'visit_start_ms','visit_end_ms','start_ms','updated_ms','first_recv_ms','last_recv_ms',
      'start_seq','end_seq','first_seq','last_seq','note','map_source'
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
      return await originalApply.call(this, p);
    }

    const fromPicoLog = !!(
      s(p.source) === 'pico_log_summary' ||
      s(p.sid) ||
      Array.isArray(p.gps_visit_candidates) ||
      Array.isArray(p.gps_candidates) ||
      Number(p.gps_candidate_count || 0) > 0 ||
      Number(p.gps_visit_judged || 0) > 0
    );

    if(fromPicoLog){
      const visits = Array.isArray(p.gps_visit_candidates)
        ? p.gps_visit_candidates.filter(v => v && s(v.gps_visit_id || v.visit_id) && hasLatLng(v))
        : [];

      if(!visits.length){
        clearLogSyncHash();
        try{ if(typeof refreshAll === 'function') await refreshAll(); }catch(e){}
        setLogSync('実釣なし: 保存なし','warn');
        return false;
      }

      let saved = 0;
      for(const v of visits){
        const one = mergeVisitPayload(p, v);
        if(await stage2ApplyLogSyncPayload(one)) saved++;
      }
      clearLogSyncHash();
      try{ if(typeof refreshAll === 'function') await refreshAll(); }catch(e){}
      try{ if(typeof fitInitialLakeViewOnce === 'function') fitInitialLakeViewOnce(true); }catch(e){}
      setLogSync('実釣' + saved + '地点同期','good');
      return saved > 0;
    }

    return await originalApply.call(this, p);
  }

  try{ window.v112_findTripForLogSync = stage2FindTripForLogSync; v112_findTripForLogSync = stage2FindTripForLogSync; }catch(e){}
  try{ window.v112_makeTripFromLogSync = stage2MakeTripFromLogSync; v112_makeTripFromLogSync = stage2MakeTripFromLogSync; }catch(e){}
  try{ window.v112_makePicoSummary = stage2MakePicoSummary; v112_makePicoSummary = stage2MakePicoSummary; }catch(e){}
  try{ window.v112_applyLogSyncPayload = stage2ApplyLogSyncPayload; v112_applyLogSyncPayload = stage2ApplyLogSyncPayload; }catch(e){}
  console.info('[wakasagi] stage2 visit receiver 20260611d installed - pico parent requires gps_visit_candidates');
})();
