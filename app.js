'use strict';
/*
  wakasagi-companion app.js v116 overwrite
  - 追加 mapsync_topfields_fix_*.js は使わない。
  - 現行 v11.5 app.js（commit 626b19a）を読み込み、#logsync の保存処理だけを上書きする。
  - viewer が読む trip_records トップ階層へ line_no / sinker_g / fishfinder_depth_m / water_temp_c / weather / wind を保存する。
*/
(function(){
  const BASE_APP_URL = 'https://cdn.jsdelivr.net/gh/ko-ki-m/wakasagi-companion@626b19a/app.js';

  function loadBaseAppSynchronously(){
    const xhr = new XMLHttpRequest();
    xhr.open('GET', BASE_APP_URL + '?v=115-base', false);
    xhr.send(null);
    if(xhr.status < 200 || xhr.status >= 300){
      throw new Error('base app.js load failed: HTTP ' + xhr.status);
    }
    (0, eval)(xhr.responseText + '\n//# sourceURL=wakasagi-companion-base-v115.js');
  }

  function text(v){
    return String(v === undefined || v === null ? '' : v).trim();
  }

  function first(){
    for(let i=0;i<arguments.length;i++){
      const s = text(arguments[i]);
      if(s) return s;
    }
    return '';
  }

  function sinkerFromX10(v){
    const n = Number(v);
    if(!Number.isFinite(n) || n <= 0) return '';
    return (n / 10).toFixed(1).replace(/\.0$/, '');
  }

  function normalizedWind(p){
    const w = first(p.wind);
    if(w) return w;
    const dir = first(p.wind_dir, p.wind_direction, p.weather_wind_dir);
    const spd = first(p.wind_speed_mps, p.wind_mps, p.weather_wind_speed_mps);
    return [dir, spd ? (spd + 'm/s') : ''].filter(Boolean).join(' ');
  }

  function topFieldsFromPayload(p){
    const line = first(p.line_no, p.line, p.lineNo);
    const sinker = first(p.sinker_g, p.sinker, sinkerFromX10(p.sinker_g_x10), sinkerFromX10(p.sinker_x10));
    const depth = first(p.fishfinder_depth_m, p.fishfinder_m, p.water_depth_m, p.max_depth_m);
    const waterTemp = first(p.water_temp_c, p.water_temp, p.waterTempC);
    const weather = first(p.weather_text, p.weather, p.weatherText);
    const wind = normalizedWind(p);
    const depthSource = first(p.depth_source, p.fishfinder_depth_m || p.fishfinder_m ? 'fishfinder' : (p.max_depth_m ? 'reel_log_max' : ''));
    return {
      line_no: line,
      sinker_g: sinker,
      fishfinder_depth_m: depth,
      water_temp_c: waterTemp,
      weather: weather,
      wind: wind,
      depth_source: depthSource
    };
  }

  function fillIfEmpty(obj, key, value){
    const v = text(value);
    if(!v) return false;
    if(text(obj[key]) === ''){
      obj[key] = v;
      return true;
    }
    return false;
  }

  function applyTopFieldsToTrip(t, fields){
    let changed = false;
    changed = fillIfEmpty(t, 'line_no', fields.line_no) || changed;
    changed = fillIfEmpty(t, 'sinker_g', fields.sinker_g) || changed;
    changed = fillIfEmpty(t, 'fishfinder_depth_m', fields.fishfinder_depth_m) || changed;
    changed = fillIfEmpty(t, 'water_temp_c', fields.water_temp_c) || changed;
    changed = fillIfEmpty(t, 'weather', fields.weather) || changed;
    changed = fillIfEmpty(t, 'wind', fields.wind) || changed;
    changed = fillIfEmpty(t, 'depth_source', fields.depth_source) || changed;
    return changed;
  }

  function applyTopFieldsToSummary(summary, fields){
    summary.line_no = first(summary.line_no, fields.line_no);
    summary.sinker_g = first(summary.sinker_g, fields.sinker_g);
    summary.fishfinder_depth_m = first(summary.fishfinder_depth_m, fields.fishfinder_depth_m);
    summary.water_temp_c = first(summary.water_temp_c, fields.water_temp_c);
    summary.weather = first(summary.weather, fields.weather);
    summary.wind = first(summary.wind, fields.wind);
    summary.depth_source = first(summary.depth_source, fields.depth_source);
  }

  try{
    loadBaseAppSynchronously();
  }catch(e){
    console.error(e);
    window.addEventListener('load', function(){
      const el = document.getElementById('locStatus') || document.body;
      if(el) el.textContent = 'app.js読込エラー: ' + (e && e.message ? e.message : e);
    });
    return;
  }

  // 新規作成時もトップ階層へ正規化済みフィールドを入れる。
  window.v112_makeTripFromLogSync = function(p){
    const fields = topFieldsFromPayload(p || {});
    const lat = Number((p && (p.gps_lat || p.lat)) || NaN);
    const lng = Number((p && (p.gps_lng || p.lng)) || NaN);
    const now = Date.now();
    return {
      trip_id:String((p && (p.map_spot_id || p.spot_id)) || ('PICO_' + ((p && p.sid) || now))),
      map_spot_id:String((p && (p.map_spot_id || p.spot_id)) || ''),
      date_ms:Number((p && (p.start_ms || p.first_recv_ms)) || now),
      lat:Number.isFinite(lat) ? lat : 0,
      lng:Number.isFinite(lng) ? lng : 0,
      accuracy_m:Number((p && (p.gps_acc_m || p.acc)) || 0),
      location_time_ms:Number((p && (p.gps_ms || p.start_ms)) || now),
      lake_name:String((p && p.lake_name) || ''),
      point_name:String((p && (p.point_name || p.place_name)) || 'Pico Wログ地点'),
      line_no:String(fields.line_no || ''),
      sinker_g:String(fields.sinker_g || ''),
      fishfinder_depth_m:String(fields.fishfinder_depth_m || ''),
      water_temp_c:String(fields.water_temp_c || ''),
      weather:String(fields.weather || ''),
      wind:String(fields.wind || ''),
      depth_source:String(fields.depth_source || ''),
      memo:String((p && p.note) || ''),
      created_ms:now,
      updated_ms:now
    };
  };

  // 既存履歴マージ時もトップ階層と pico_summary の両方へ保存する。
  window.v112_applyLogSyncPayload = async function(p){
    if(!p || p.__error){
      v112_setLogSync('logsync decode error','bad');
      return false;
    }

    const lat = Number(p.gps_lat || p.lat);
    const lng = Number(p.gps_lng || p.lng);
    if(!Number.isFinite(lat) || !Number.isFinite(lng)){
      v112_setLogSync('logsync 座標なし','bad');
      return false;
    }

    let t = await v112_findTripForLogSync(p);
    if(!t) t = window.v112_makeTripFromLogSync(p);

    const fields = topFieldsFromPayload(p);
    const summary = {
      v:1,
      source:'pico_log',
      sid:String(p.sid || ''),
      map_spot_id:String(p.map_spot_id || p.spot_id || ''),
      start_ms:Number(p.start_ms || 0),
      updated_ms:Number(p.updated_ms || Date.now()),
      first_recv_ms:Number(p.first_recv_ms || 0),
      last_recv_ms:Number(p.last_recv_ms || 0),
      fish_count:Number(p.fish_count || 0),
      mark_count:Number(p.mark_count || 0),
      tlog_count:Number(p.tlog_count || 0),
      first_seq:p.first_seq,
      last_seq:p.last_seq,
      first_t_ms:p.first_t_ms,
      last_t_ms:p.last_t_ms,
      min_depth_m:p.min_depth_m,
      max_depth_m:p.max_depth_m,
      used_sasoi:p.used_sasoi,
      used_speed:p.used_speed,
      received_ms:Date.now()
    };
    applyTopFieldsToSummary(summary, fields);

    t.map_spot_id = t.map_spot_id || summary.map_spot_id;
    t.pico_logs = Array.isArray(t.pico_logs) ? t.pico_logs : [];
    t.pico_logs = t.pico_logs.filter(x => String(x.sid || '') !== String(summary.sid || ''));
    t.pico_logs.push(summary);
    t.pico_summary = summary;

    if(!t.lake_name && p.lake_name) t.lake_name = String(p.lake_name);
    if(!t.point_name && (p.point_name || p.place_name)) t.point_name = String(p.point_name || p.place_name);
    applyTopFieldsToTrip(t, fields);
    if(!t.memo && p.note) t.memo = String(p.note);

    t.updated_ms = Date.now();
    await putTrip(t);
    selectedTripId = t.trip_id;

    if(history && history.replaceState){
      history.replaceState(null, document.title, location.pathname + location.search);
    }

    await refreshAll();
    try{ showTripDetail(t, {lat:Number(t.lat), lng:Number(t.lng)}); }catch(e){}
    try{ fitInitialLakeViewOnce(true); }catch(e){}
    v112_setLogSync('同期済み','good');
    return true;
  };
})();
