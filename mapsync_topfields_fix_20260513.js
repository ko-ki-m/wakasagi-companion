'use strict';

// mapsync_topfields_fix_20260513.js
// 目的:
// - app.js の #logsync 既存保存処理後に、viewer が読む trip_records トップ階層へ不足値を補完する。
// - 既存の手入力値は上書きしない。
// - viewer/app.js は触らない。
// - Pico W 側から届く line_no / sinker_g / sinker_g_x10 / fishfinder_* / water_temp_c / weather* / wind* を受ける。

(function(){
  const PATCH_NAME = 'mapsync_topfields_fix_20260513';
  const SAME_POINT_M_FALLBACK = 20;

  function txt(v){
    return String(v === undefined || v === null ? '' : v).trim();
  }

  function empty(v){
    return txt(v) === '';
  }

  function first(){
    for(const v of arguments){
      const s = txt(v);
      if(s) return s;
    }
    return '';
  }

  function sinkerFromX10(v){
    const n = Number(v);
    if(!Number.isFinite(n) || n <= 0) return '';
    return (n / 10).toFixed(1).replace(/\.0$/, '');
  }

  function windTextFrom(p){
    const already = first(p.wind);
    if(already) return already;
    const dir = first(p.wind_dir, p.wind_direction, p.weather_wind_dir);
    const speed = first(p.wind_speed_mps, p.wind_mps, p.weather_wind_speed_mps);
    return [dir, speed ? (speed + 'm/s') : ''].filter(Boolean).join(' ');
  }

  function pickFieldsFromObject(o){
    if(!o || typeof o !== 'object') return {};
    const out = {};
    out.line_no = first(o.line_no, o.line, o.lineNo);
    out.sinker_g = first(o.sinker_g, o.sinker, sinkerFromX10(o.sinker_g_x10), sinkerFromX10(o.sinker_x10));
    out.fishfinder_depth_m = first(o.fishfinder_depth_m, o.fishfinder_m, o.fishfinderDepthM, o.depth_fishfinder_m);
    out.water_temp_c = first(o.water_temp_c, o.water_temp, o.waterTempC);
    out.weather = first(o.weather_text, o.weather, o.weatherText);
    out.wind = windTextFrom(o);
    return out;
  }

  function pickFieldsFromTripStoredSources(t){
    const out = pickFieldsFromObject(t);

    const srcs = [];
    if(t && typeof t === 'object'){
      if(t.pico_summary) srcs.push(t.pico_summary);
      if(Array.isArray(t.pico_logs)) srcs.push(...t.pico_logs);
      if(Array.isArray(t.logs)) srcs.push(...t.logs);
      if(Array.isArray(t.tlog2)) srcs.push(...t.tlog2);
    }

    let latestSinkerSeq = null;
    let latestSinkerX10 = '';

    for(const s of srcs){
      const f = pickFieldsFromObject(s);
      if(!out.line_no && f.line_no) out.line_no = f.line_no;
      if(!out.sinker_g && f.sinker_g) out.sinker_g = f.sinker_g;
      if(!out.fishfinder_depth_m && f.fishfinder_depth_m) out.fishfinder_depth_m = f.fishfinder_depth_m;
      if(!out.water_temp_c && f.water_temp_c) out.water_temp_c = f.water_temp_c;
      if(!out.weather && f.weather) out.weather = f.weather;
      if(!out.wind && f.wind) out.wind = f.wind;

      const sx = Number(s && s.sinker_g_x10);
      if(Number.isFinite(sx) && sx > 0){
        const seq = Number(s.seq);
        const key = Number.isFinite(seq) ? seq : srcs.indexOf(s);
        if(latestSinkerSeq === null || key >= latestSinkerSeq){
          latestSinkerSeq = key;
          latestSinkerX10 = sx;
        }
      }
    }

    if(!out.sinker_g && latestSinkerX10) out.sinker_g = sinkerFromX10(latestSinkerX10);
    return out;
  }

  function mergeTopFields(t, fields){
    if(!t || typeof t !== 'object') return false;
    let changed = false;
    function fill(k, v){
      const s = txt(v);
      if(!s) return;
      if(empty(t[k])){
        t[k] = s;
        changed = true;
      }
    }

    fill('line_no', fields.line_no);
    fill('sinker_g', fields.sinker_g);
    fill('fishfinder_depth_m', fields.fishfinder_depth_m);
    fill('water_temp_c', fields.water_temp_c);
    fill('weather', fields.weather);
    fill('wind', fields.wind);

    if(t.pico_summary && typeof t.pico_summary === 'object'){
      for(const k of ['line_no','sinker_g','fishfinder_depth_m','water_temp_c','weather','wind']){
        const s = txt(fields[k]);
        if(s && empty(t.pico_summary[k])){
          t.pico_summary[k] = s;
          changed = true;
        }
      }
    }

    if(changed) t.updated_ms = Date.now();
    return changed;
  }

  async function allTrips(){
    if(typeof getAllTrips === 'function') return await getAllTrips();
    return [];
  }

  async function saveTrip(t){
    if(typeof putTrip === 'function') return await putTrip(t);
    return false;
  }

  function distanceOfTrip(t, lat0, lng0){
    const a = Number(lat0), b = Number(lng0);
    const la = Number(t && t.lat), ln = Number(t && t.lng);
    if(!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(la) || !Number.isFinite(ln)) return null;
    if(typeof dBase === 'function') return dBase(t, a, b);
    const R = 6371008.8;
    const r = v => v * Math.PI / 180;
    const p1 = r(a), p2 = r(la), dp = r(la - a), dl = r(ln - b);
    const x = Math.sin(dp/2)**2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2)**2;
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  async function findTripForPayload(p){
    const trips = await allTrips();
    const sid = txt(p.sid);
    const spotId = first(p.map_spot_id, p.spot_id, p.trip_id);

    if(spotId){
      const hit = trips.find(t =>
        txt(t.trip_id) === spotId ||
        txt(t.migrated_from) === spotId ||
        txt(t.map_spot_id) === spotId
      );
      if(hit) return hit;
    }

    if(sid){
      const hit = trips.find(t =>
        txt(t.sid) === sid ||
        (t.pico_summary && txt(t.pico_summary.sid) === sid) ||
        (Array.isArray(t.pico_logs) && t.pico_logs.some(l => txt(l && l.sid) === sid))
      );
      if(hit) return hit;
    }

    const lat0 = Number(first(p.gps_lat, p.lat));
    const lng0 = Number(first(p.gps_lng, p.lng));
    if(Number.isFinite(lat0) && Number.isFinite(lng0)){
      let best = null, bestD = Infinity;
      for(const t of trips){
        const dd = distanceOfTrip(t, lat0, lng0);
        if(dd !== null && dd <= SAME_POINT_M_FALLBACK && dd < bestD){
          best = t;
          bestD = dd;
        }
      }
      if(best) return best;
    }

    return null;
  }

  async function repairFromPayload(p){
    if(!p || typeof p !== 'object') return false;
    const t = await findTripForPayload(p);
    if(!t) return false;
    const fields = pickFieldsFromObject(p);
    const changed = mergeTopFields(t, fields);
    if(changed){
      await saveTrip(t);
      try{
        if(typeof selectedTripId !== 'undefined') selectedTripId = t.trip_id;
      }catch(e){}
    }
    return changed;
  }

  async function repairSavedTrips(){
    const trips = await allTrips();
    let changedCount = 0;
    for(const t of trips){
      const fields = pickFieldsFromTripStoredSources(t);
      if(mergeTopFields(t, fields)){
        await saveTrip(t);
        changedCount++;
      }
    }
    if(changedCount > 0){
      try{ if(typeof refreshAll === 'function') await refreshAll(); }catch(e){}
    }
    return changedCount;
  }

  function patchLogSyncFunction(){
    let original = null;
    try{
      if(typeof v112_applyLogSyncPayload === 'function') original = v112_applyLogSyncPayload;
    }catch(e){}
    if(!original || original.__mapsyncTopFieldsFix) return false;

    const wrapped = async function(p){
      const r = await original(p);
      try{
        const changed = await repairFromPayload(p);
        if(changed && typeof refreshAll === 'function') await refreshAll();
      }catch(e){
        console.warn(PATCH_NAME + ': payload repair failed', e);
      }
      return r;
    };
    wrapped.__mapsyncTopFieldsFix = true;

    try{
      v112_applyLogSyncPayload = wrapped;
      window.v112_applyLogSyncPayload = wrapped;
      return true;
    }catch(e){
      console.warn(PATCH_NAME + ': function patch failed', e);
      return false;
    }
  }

  async function waitDbReady(){
    for(let i=0; i<80; i++){
      try{
        if(typeof db !== 'undefined' && db) return true;
      }catch(e){}
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }

  async function boot(){
    patchLogSyncFunction();
    await waitDbReady();
    patchLogSyncFunction();
    await repairSavedTrips();
  }

  window.addEventListener('load', () => {
    setTimeout(() => { boot().catch(e => console.warn(PATCH_NAME + ': boot failed', e)); }, 50);
  });
})();
