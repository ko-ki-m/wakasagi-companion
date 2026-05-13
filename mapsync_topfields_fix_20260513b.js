'use strict';

// mapsync_topfields_fix_20260513b.js
// 現行 app.js の #logsync 保存完了後に、viewer が読む trip_records トップ階層へ不足値を補完する。
// 重要: payload に無い値は作れない。Pico W側から line_no / sinker_g_x10 / max_depth_m 等を渡すことが前提。
(function(){
  const PATCH_NAME = 'mapsync_topfields_fix_20260513b';
  const SAME_POINT_M_FALLBACK = 20;
  const capturedPayload = decodeLogSyncFromHash(location.hash || '');

  function txt(v){ return String(v === undefined || v === null ? '' : v).trim(); }
  function empty(v){ return txt(v) === ''; }
  function first(){ for(const v of arguments){ const s=txt(v); if(s) return s; } return ''; }
  function sinkerFromX10(v){ const n=Number(v); return (Number.isFinite(n) && n>0) ? (n/10).toFixed(1).replace(/\.0$/,'') : ''; }
  function windTextFrom(o){
    const w = first(o.wind);
    if(w) return w;
    const dir = first(o.wind_dir, o.wind_direction, o.weather_wind_dir);
    const spd = first(o.wind_speed_mps, o.wind_mps, o.weather_wind_speed_mps);
    return [dir, spd ? (spd + 'm/s') : ''].filter(Boolean).join(' ');
  }
  function depthFromPayload(o){
    return first(
      o.fishfinder_depth_m,
      o.fishfinder_m,
      o.fishfinderDepthM,
      o.depth_fishfinder_m,
      o.max_depth_m
    );
  }
  function pickFields(o){
    if(!o || typeof o !== 'object') return {};
    return {
      line_no: first(o.line_no, o.line, o.lineStr, o.line_str),
      sinker_g: first(o.sinker_g, o.sinker, sinkerFromX10(o.sinker_g_x10), sinkerFromX10(o.sinker_x10)),
      fishfinder_depth_m: depthFromPayload(o),
      water_temp_c: first(o.water_temp_c, o.water_temp, o.waterTempC),
      weather: first(o.weather_text, o.weather, o.weatherText),
      wind: windTextFrom(o)
    };
  }
  function decodeLogSyncFromHash(h){
    try{
      if(!h || !h.startsWith('#logsync=')) return null;
      const raw = decodeURIComponent(h.substring('#logsync='.length));
      const bin = atob(raw);
      let json = '';
      try{ json = decodeURIComponent(escape(bin)); }
      catch(e){
        if(window.TextDecoder){
          const bytes = new Uint8Array(bin.length);
          for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
          json = new TextDecoder('utf-8').decode(bytes);
        }else{
          json = bin;
        }
      }
      return JSON.parse(json);
    }catch(e){
      console.warn(PATCH_NAME + ': decode failed', e);
      return null;
    }
  }
  function mergeTopFields(t, fields){
    if(!t || typeof t !== 'object') return false;
    let changed = false;
    function fill(k,v){
      const s = txt(v);
      if(!s) return;
      if(empty(t[k])){ t[k]=s; changed=true; }
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
        if(s && empty(t.pico_summary[k])){ t.pico_summary[k]=s; changed=true; }
      }
    }
    if(changed) t.updated_ms = Date.now();
    return changed;
  }
  async function allTrips(){
    try{ if(typeof getAllTrips === 'function') return await getAllTrips(); }catch(e){}
    return [];
  }
  async function saveTripRecord(t){
    try{ if(typeof putTrip === 'function') return await putTrip(t); }catch(e){}
    return false;
  }
  function distanceOfTrip(t, lat0, lng0){
    const la=Number(t&&t.lat), ln=Number(t&&t.lng), a=Number(lat0), b=Number(lng0);
    if(!Number.isFinite(la)||!Number.isFinite(ln)||!Number.isFinite(a)||!Number.isFinite(b)) return null;
    try{ if(typeof dBase === 'function') return dBase(t,a,b); }catch(e){}
    const R=6371008.8, r=v=>v*Math.PI/180;
    const p1=r(a), p2=r(la), dp=r(la-a), dl=r(ln-b);
    const x=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
  }
  async function findTripForPayload(p){
    const trips = await allTrips();
    const sid = txt(p.sid);
    const spotId = first(p.map_spot_id, p.spot_id, p.trip_id);
    if(spotId){
      const hit = trips.find(t =>
        txt(t.trip_id)===spotId || txt(t.migrated_from)===spotId || txt(t.map_spot_id)===spotId
      );
      if(hit) return hit;
    }
    if(sid){
      const hit = trips.find(t =>
        txt(t.sid)===sid ||
        (t.pico_summary && txt(t.pico_summary.sid)===sid) ||
        (Array.isArray(t.pico_logs) && t.pico_logs.some(l=>txt(l&&l.sid)===sid))
      );
      if(hit) return hit;
    }
    const lat0 = Number(first(p.gps_lat,p.lat));
    const lng0 = Number(first(p.gps_lng,p.lng));
    if(Number.isFinite(lat0)&&Number.isFinite(lng0)){
      let best=null, bestD=Infinity;
      for(const t of trips){
        const d=distanceOfTrip(t,lat0,lng0);
        if(d!==null && d<=SAME_POINT_M_FALLBACK && d<bestD){ best=t; bestD=d; }
      }
      if(best) return best;
    }
    return null;
  }
  async function repairFromPayload(p){
    if(!p || typeof p !== 'object') return false;
    const fields = pickFields(p);
    if(!fields.line_no && !fields.sinker_g && !fields.fishfinder_depth_m && !fields.water_temp_c && !fields.weather && !fields.wind) return false;
    const t = await findTripForPayload(p);
    if(!t) return false;
    const changed = mergeTopFields(t, fields);
    if(changed){
      await saveTripRecord(t);
      try{ if(typeof selectedTripId !== 'undefined') selectedTripId = t.trip_id; }catch(e){}
      try{ if(typeof refreshAll === 'function') await refreshAll(); }catch(e){}
    }
    return changed;
  }
  async function repairSavedTrips(){
    const trips = await allTrips();
    let count=0;
    for(const t of trips){
      const sources = [t];
      if(t && t.pico_summary) sources.push(t.pico_summary);
      if(t && Array.isArray(t.pico_logs)) sources.push(...t.pico_logs);
      let fields = {};
      for(const s of sources){
        const f = pickFields(s);
        fields = {
          line_no: first(fields.line_no, f.line_no),
          sinker_g: first(fields.sinker_g, f.sinker_g),
          fishfinder_depth_m: first(fields.fishfinder_depth_m, f.fishfinder_depth_m),
          water_temp_c: first(fields.water_temp_c, f.water_temp_c),
          weather: first(fields.weather, f.weather),
          wind: first(fields.wind, f.wind)
        };
      }
      if(mergeTopFields(t, fields)){ await saveTripRecord(t); count++; }
    }
    if(count>0){ try{ if(typeof refreshAll === 'function') await refreshAll(); }catch(e){} }
    return count;
  }
  function patchOriginal(){
    let original=null;
    try{ if(typeof v112_applyLogSyncPayload === 'function') original = v112_applyLogSyncPayload; }catch(e){}
    if(!original || original.__mapsyncTopFieldsFixB) return false;
    const wrapped = async function(p){
      const r = await original(p);
      try{ await repairFromPayload(p); }catch(e){ console.warn(PATCH_NAME+': wrapped repair failed',e); }
      return r;
    };
    wrapped.__mapsyncTopFieldsFixB = true;
    try{ v112_applyLogSyncPayload = wrapped; window.v112_applyLogSyncPayload = wrapped; return true; }
    catch(e){ return false; }
  }
  async function waitDbReady(){
    for(let i=0;i<100;i++){
      try{ if(typeof db !== 'undefined' && db) return true; }catch(e){}
      await new Promise(r=>setTimeout(r,100));
    }
    return false;
  }
  async function boot(){
    patchOriginal();
    await waitDbReady();
    patchOriginal();
    if(capturedPayload){
      // original receiver は load後約1.4秒で動くため、その後にも複数回補修する。
      for(const ms of [1800, 2600, 4200, 7000]){
        setTimeout(()=>repairFromPayload(capturedPayload).catch(e=>console.warn(PATCH_NAME+': delayed repair failed',e)), ms);
      }
    }
    setTimeout(()=>repairSavedTrips().catch(e=>console.warn(PATCH_NAME+': saved repair failed',e)), 3200);
  }
  window.addEventListener('load',()=>{ setTimeout(()=>boot().catch(e=>console.warn(PATCH_NAME+': boot failed',e)), 30); });
})();
