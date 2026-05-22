(function(){
  'use strict';

  const INSTALL_FLAG = '__wakasagiStage2VisitReceiver20260522eInstalled';
  if(window[INSTALL_FLAG]) return;
  window[INSTALL_FLAG] = true;

  function s(v){ return String(v == null ? '' : v).trim(); }
  function n(v){ const x = Number(v); return Number.isFinite(x) ? x : null; }
  function hasLatLng(p){ return Number.isFinite(Number(p && (p.gps_lat || p.latest_lat || p.lat))) && Number.isFinite(Number(p && (p.gps_lng || p.latest_lng || p.lng))); }
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
    }
    if(originalFind) return await originalFind.call(this, p);
    return null;
  }

  function stage2MakeTripFromLogSync(p){
    const visitKey = s(p && (p.gps_visit_id || p.visit_id));
    if(!visitKey || !originalMake) return originalMake ? originalMake.call(this, p) : null;

    const t = originalMake.call(this, p);
    if(!t) return t;

    t.gps_visit_id = visitKey;
    t.pico_point_visit_id = s(p.pico_point_visit_id || p.point_visit_id || p.map_point_key);
    t.point_visit_id = '';
    t.map_point_key = '';
    t.date_ms = n(p.start_ms) || n(p.first_recv_ms) || n(p.visit_start_ms) || t.date_ms || Date.now();
    t.location_time_ms = n(p.visit_start_ms) || n(p.gps_ms) || n(p.start_ms) || t.location_time_ms || Date.now();
    if(!s(t.point_name)) t.point_name = 'Pico W実釣地点';
    return t;
  }

  function stage2MakePicoSummary(p){
    const x = originalSummary ? originalSummary.call(this, p) : {};
    if(p && (p.gps_visit_id || p.visit_id)) x.gps_visit_id = s(p.gps_visit_id || p.visit_id);
    if(p && p.pico_point_visit_id) x.pico_point_visit_id = s(p.pico_point_visit_id);
    return x;
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
        v &&
        s(v.gps_visit_id || v.visit_id) &&
        hasLatLng(v)
      );

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

  console.info('[wakasagi] stage2 visit receiver 20260522e installed');
})();
