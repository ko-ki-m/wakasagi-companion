/*
  wakasagi-companion / lake_autofill.js
  修正版: 2026-05-12

  目的:
    1) Pico W /log から戻った #logsync 保存時、lake_name が空なら viewer/lakes の全国湖沼JSONから補完する。
    2) 重要修正: #logsync の保存先選定で、過去地点(map_spot_id)へ統合して回数が増えない問題を止める。
       - map_spot_id は「連携元の地点ID」であり、「今回の新規釣行回の保存先ID」ではない。
       - 同じ sid が既に保存済みの場合だけ既存レコードを更新する。
       - 初回の #logsync では必ず新しい trip_records を作らせる。
    3) GitHub -> Pico W へ渡す maplink payload に、同地点20m以内の過去回数/今日回数を付加する。

  守ること:
    - app.js 本体は改造しない。
    - putTrip() 本体は改造しない。
    - Pico W側、viewer側、既存DB構造は変更しない。
    - 失敗しても本体連携・保存処理を止めない。
*/
(function(){
  'use strict';

  const INSTALL_FLAG = '__wakasagiLakeAutofillLogsync20260512FixedInstalled';
  const APPLY_WRAP_FLAG = '__wakasagiLakeAutofillLogsyncWrappedFixed';
  const MAPLINK_WRAP_FLAG = '__wakasagiMaplinkHistoryCountsWrapped20260512';
  const FIND_FIX_FLAG = '__wakasagiLogsyncFindTripFixed20260512';

  const INDEX_URL = './viewer/lakes/index.json';
  const PREF_BASE_URL = './viewer/lakes/';
  const BBOX_MARGIN_DEG = 0.005;
  const NEAR_LIMIT_M = 500;
  const SAME_POINT_M = 20;
  const SAME_AREA_M = 100;

  if(window[INSTALL_FLAG]) return;
  window[INSTALL_FLAG] = true;

  let lakeIndexCache = null;
  const lakePrefCache = new Map();

  function validLatLng(lat, lng){
    return Number.isFinite(lat) && Number.isFinite(lng) &&
           lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }

  function pad2(n){
    return String(n).padStart(2, '0');
  }

  function localDateKey(ms){
    const d = new Date(Number(ms || Date.now()));
    if(Number.isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function asArray(data){
    if(Array.isArray(data)) return data;
    if(data && Array.isArray(data.lakes)) return data.lakes;
    if(data && Array.isArray(data.items)) return data.items;
    if(data && Array.isArray(data.records)) return data.records;
    if(data && Array.isArray(data.features)){
      return data.features.map(f => ({
        name: (f.properties && (f.properties.name || f.properties.lake_name || f.properties.W09_001 || f.properties['W09_001'])) || f.name || '',
        file: (f.properties && f.properties.file) || f.file || '',
        bbox: f.bbox || (f.properties && f.properties.bbox) || null,
        geometry: f.geometry || null,
        properties: f.properties || {}
      }));
    }
    return [];
  }

  function lakeName(lake){
    if(!lake) return '';
    const p = lake.properties || {};
    return String(
      lake.name || lake.lake_name || lake.lakeName || lake.W09_001 || lake['W09_001'] ||
      p.name || p.lake_name || p.lakeName || p.W09_001 || p['W09_001'] || ''
    ).trim();
  }

  function lakeFile(lake){
    if(!lake) return '';
    const p = lake.properties || {};
    return String(lake.file || lake.pref_file || p.file || p.pref_file || '').trim();
  }

  function lakeGeometry(lake){
    if(!lake) return null;
    return lake.geometry || (lake.feature && lake.feature.geometry) || null;
  }

  function geometryBbox(geom){
    if(!geom || !geom.coordinates) return null;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    function walk(a){
      if(!Array.isArray(a)) return;
      if(a.length >= 2 && typeof a[0] === 'number' && typeof a[1] === 'number'){
        const lng = Number(a[0]);
        const lat = Number(a[1]);
        if(Number.isFinite(lng) && Number.isFinite(lat)){
          if(lng < minLng) minLng = lng;
          if(lat < minLat) minLat = lat;
          if(lng > maxLng) maxLng = lng;
          if(lat > maxLat) maxLat = lat;
        }
        return;
      }
      for(const x of a) walk(x);
    }
    walk(geom.coordinates);
    if(!Number.isFinite(minLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLng) || !Number.isFinite(maxLat)) return null;
    return [minLng, minLat, maxLng, maxLat];
  }

  function lakeBbox(lake){
    if(!lake) return null;
    const p = lake.properties || {};
    const b = lake.bbox || lake.bounds || p.bbox || p.bounds || null;
    if(Array.isArray(b) && b.length >= 4) return b.map(Number);
    return geometryBbox(lakeGeometry(lake));
  }

  function inBbox(lng, lat, bbox, marginDeg){
    if(!bbox || bbox.length < 4) return false;
    const minLng = Number(bbox[0]);
    const minLat = Number(bbox[1]);
    const maxLng = Number(bbox[2]);
    const maxLat = Number(bbox[3]);
    if(!Number.isFinite(minLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLng) || !Number.isFinite(maxLat)) return false;
    return lng >= minLng - marginDeg && lat >= minLat - marginDeg &&
           lng <= maxLng + marginDeg && lat <= maxLat + marginDeg;
  }

  async function loadJson(url){
    const res = await fetch(url, { cache: 'force-cache' });
    if(!res.ok) throw new Error(url + ' load failed: ' + res.status);
    return await res.json();
  }

  async function loadLakeIndex(){
    if(lakeIndexCache) return lakeIndexCache;
    lakeIndexCache = asArray(await loadJson(INDEX_URL));
    return lakeIndexCache;
  }

  async function loadLakePrefFile(file){
    if(lakePrefCache.has(file)) return lakePrefCache.get(file);
    const rows = asArray(await loadJson(PREF_BASE_URL + file));
    lakePrefCache.set(file, rows);
    return rows;
  }

  function pointInRing(lng, lat, ring){
    if(!Array.isArray(ring) || ring.length < 3) return false;
    let inside = false;
    for(let i = 0, j = ring.length - 1; i < ring.length; j = i++){
      const xi = Number(ring[i][0]);
      const yi = Number(ring[i][1]);
      const xj = Number(ring[j][0]);
      const yj = Number(ring[j][1]);
      if(!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) continue;
      const hit = ((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
      if(hit) inside = !inside;
    }
    return inside;
  }

  function pointInPolygon(lng, lat, polygonCoords){
    if(!Array.isArray(polygonCoords) || !polygonCoords.length) return false;
    if(!pointInRing(lng, lat, polygonCoords[0])) return false;
    for(let i = 1; i < polygonCoords.length; i++){
      if(pointInRing(lng, lat, polygonCoords[i])) return false;
    }
    return true;
  }

  function pointInGeometry(lng, lat, geom){
    if(!geom || !geom.coordinates) return false;
    if(geom.type === 'Polygon') return pointInPolygon(lng, lat, geom.coordinates);
    if(geom.type === 'MultiPolygon') return geom.coordinates.some(poly => pointInPolygon(lng, lat, poly));
    return false;
  }

  function pointToSegmentDistanceMeters(lat, lng, lat1, lng1, lat2, lng2){
    const R = 6371008.8;
    const baseLatRad = lat * Math.PI / 180;
    const xOf = lon => (lon - lng) * Math.PI / 180 * Math.cos(baseLatRad) * R;
    const yOf = la => (la - lat) * Math.PI / 180 * R;
    const ax = xOf(lng1), ay = yOf(lat1);
    const bx = xOf(lng2), by = yOf(lat2);
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if(len2 <= 1e-9) return Math.sqrt(ax * ax + ay * ay);
    let t = -(ax * dx + ay * dy) / len2;
    if(t < 0) t = 0;
    if(t > 1) t = 1;
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    return Math.sqrt(cx * cx + cy * cy);
  }

  function ringDistanceMeters(lat, lng, ring){
    if(!Array.isArray(ring) || ring.length < 2) return Infinity;
    let best = Infinity;
    for(let i = 0; i < ring.length - 1; i++){
      const a = ring[i], b = ring[i + 1];
      if(!a || !b) continue;
      const d = pointToSegmentDistanceMeters(lat, lng, Number(a[1]), Number(a[0]), Number(b[1]), Number(b[0]));
      if(d < best) best = d;
    }
    return best;
  }

  function geometryDistanceMeters(lat, lng, geom){
    if(!geom || !geom.coordinates) return Infinity;
    let best = Infinity;
    if(geom.type === 'Polygon'){
      for(const ring of geom.coordinates || []) best = Math.min(best, ringDistanceMeters(lat, lng, ring));
    }else if(geom.type === 'MultiPolygon'){
      for(const poly of geom.coordinates || []){
        for(const ring of poly || []) best = Math.min(best, ringDistanceMeters(lat, lng, ring));
      }
    }
    return best;
  }

  async function guessLakeNameFromLatLng(lat, lng){
    if(!validLatLng(lat, lng)) return null;

    const indexRows = await loadLakeIndex();
    const indexCandidates = indexRows.filter(row => {
      const f = lakeFile(row);
      const b = lakeBbox(row);
      return f && b && inBbox(lng, lat, b, BBOX_MARGIN_DEG);
    });

    const files = [...new Set(indexCandidates.map(lakeFile).filter(Boolean))];
    if(!files.length) return null;

    let nearest = null;

    for(const file of files){
      const lakes = await loadLakePrefFile(file);
      for(const lake of lakes){
        const name = lakeName(lake);
        const geom = lakeGeometry(lake);
        if(!name || !geom) continue;

        const b = lakeBbox(lake);
        if(b && !inBbox(lng, lat, b, BBOX_MARGIN_DEG)) continue;

        if(pointInGeometry(lng, lat, geom)){
          return {
            lake_name: name,
            lake_source: 'ksj_w09_polygon',
            lake_confidence: 1.0
          };
        }

        const d = geometryDistanceMeters(lat, lng, geom);
        if(Number.isFinite(d) && d <= NEAR_LIMIT_M){
          if(!nearest || d < nearest.distance_m){
            nearest = {
              lake_name: name,
              lake_source: 'ksj_w09_near',
              lake_confidence: 0.7,
              distance_m: d
            };
          }
        }
      }
    }

    return nearest;
  }

  async function fillLakeNameForTrip(t){
    try{
      if(!t || typeof t !== 'object') return t;

      const current = String(t.lake_name || t.lakeName || '').trim();
      if(current) return t;

      const lat = Number(t.lat);
      const lng = Number(t.lng);
      if(!validLatLng(lat, lng)) return t;

      const guess = await guessLakeNameFromLatLng(lat, lng);
      if(guess && guess.lake_name){
        t.lake_name = guess.lake_name;
        t.lake_source = guess.lake_source || '';
        t.lake_confidence = Number(guess.lake_confidence || 0);
      }
    }catch(e){
      console.warn('[wakasagi] lake_autofill skipped:', e);
    }
    return t;
  }

  function distMeters(lat1, lng1, lat2, lng2){
    const R = 6371008.8;
    const r = v => v * Math.PI / 180;
    const p1 = r(lat1), p2 = r(lat2);
    const dp = r(lat2 - lat1), dl = r(lng2 - lng1);
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function tripTimeMs(t){
    return Number((t && (t.date_ms || t.start_ms || t.created_ms || t.updated_ms)) || 0);
  }

  function tripLat(t){
    return Number(t && t.lat);
  }

  function tripLng(t){
    return Number(t && t.lng);
  }

  function samePointRows(trips, baseLat, baseLng, limitM){
    if(!Array.isArray(trips) || !validLatLng(baseLat, baseLng)) return [];
    return trips
      .filter(t => validLatLng(tripLat(t), tripLng(t)))
      .map(t => ({ t, d: distMeters(baseLat, baseLng, tripLat(t), tripLng(t)) }))
      .filter(x => x.d <= limitM)
      .sort((a, b) => tripTimeMs(b.t) - tripTimeMs(a.t));
  }

  function sidOfPayload(p){
    return String((p && (p.sid || p.session_id || p.log_sid || p.pico_sid)) || '').trim();
  }

  function sidOfTrip(t){
    if(!t || typeof t !== 'object') return '';
    const s = t.pico_summary || t.pico_log_summary || t.log_summary || null;
    if(s && (s.sid || s.session_id)) return String(s.sid || s.session_id).trim();
    return '';
  }

  function tripHasSid(t, sid){
    if(!sid || !t) return false;
    if(sidOfTrip(t) === sid) return true;
    const logs = Array.isArray(t.pico_logs) ? t.pico_logs : [];
    return logs.some(x => String((x && (x.sid || x.session_id)) || '').trim() === sid);
  }

  function getGlobalFunction(name){
    try{
      return typeof window[name] === 'function' ? window[name] : null;
    }catch(e){
      return null;
    }
  }

  function setGlobalFunction(name, fn){
    try{ window[name] = fn; }catch(e){}
    try{ (0, eval)(name + ' = window["' + name + '"]'); }catch(e){}
  }

  function setGlobalPutTrip(fn){
    try{ window.putTrip = fn; }catch(e){}
    try{ putTrip = fn; }catch(e){}
  }

  async function fixedFindTripForLogSync(p){
    try{
      const getAll = getGlobalFunction('getAllTrips');
      if(!getAll) return null;

      const trips = await getAll();
      const sid = sidOfPayload(p);

      // 最重要:
      // 同じsidの再同期だけ既存釣行回へ更新する。
      // map_spot_id は過去地点のIDであり、新規釣行回の保存先ではないため、ここでは絶対に一致検索に使わない。
      if(sid){
        const bySid = trips.find(t => tripHasSid(t, sid));
        if(bySid) return bySid;
      }

      // 明示的に「今回のtrip_id」が送られてきた場合だけ更新を許可する。
      // map_spot_id / spot_id は除外する。
      const explicitTripId = String((p && (p.trip_id || p.current_trip_id || p.log_trip_id)) || '').trim();
      if(explicitTripId){
        const byTripId = trips.find(t => String(t.trip_id || '') === explicitTripId);
        if(byTripId) return byTripId;
      }
    }catch(e){
      console.warn('[wakasagi] fixedFindTripForLogSync failed:', e);
    }

    return null;
  }

  function installFindTripFix(){
    const originalFind = getGlobalFunction('v112_findTripForLogSync');
    if(!originalFind) return false;
    if(originalFind[FIND_FIX_FLAG]) return true;

    fixedFindTripForLogSync[FIND_FIX_FLAG] = true;
    fixedFindTripForLogSync.__original = originalFind;

    window.v112_findTripForLogSync = fixedFindTripForLogSync;
    try{ v112_findTripForLogSync = fixedFindTripForLogSync; }catch(e){}

    console.info('[wakasagi] logsync find-trip fix installed');
    return true;
  }

  function installLakeNameWrapper(){
    const originalApply = getGlobalFunction('v112_applyLogSyncPayload');
    if(!originalApply) return false;
    if(originalApply[APPLY_WRAP_FLAG]) return true;

    const wrappedApply = async function(p){
      const originalPutTrip = getGlobalFunction('putTrip');
      if(!originalPutTrip){
        return await originalApply.call(this, p);
      }

      const wrappedPutTrip = async function(t){
        await fillLakeNameForTrip(t);
        return await originalPutTrip.call(this, t);
      };

      setGlobalPutTrip(wrappedPutTrip);

      try{
        return await originalApply.call(this, p);
      }finally{
        const cur = getGlobalFunction('putTrip');
        if(cur === wrappedPutTrip){
          setGlobalPutTrip(originalPutTrip);
        }
      }
    };

    wrappedApply[APPLY_WRAP_FLAG] = true;
    wrappedApply.__original = originalApply;

    window.v112_applyLogSyncPayload = wrappedApply;
    try{ v112_applyLogSyncPayload = wrappedApply; }catch(e){}

    console.info('[wakasagi] lake_autofill logsync wrapper installed');
    return true;
  }

  async function addHistoryCountsToMaplinkPayload(payload){
    try{
      if(!payload || typeof payload !== 'object') return payload;
      const baseLat = Number(payload.lat);
      const baseLng = Number(payload.lng);
      if(!validLatLng(baseLat, baseLng)) return payload;

      const getAll = getGlobalFunction('getAllTrips');
      if(!getAll) return payload;

      const trips = await getAll();
      const same20 = samePointRows(trips, baseLat, baseLng, SAME_POINT_M);
      const same100 = samePointRows(trips, baseLat, baseLng, SAME_AREA_M);
      const todayKey = localDateKey(Date.now());
      const same20Today = same20.filter(x => localDateKey(tripTimeMs(x.t)) === todayKey);
      const same100Today = same100.filter(x => localDateKey(tripTimeMs(x.t)) === todayKey);

      const dates = same20
        .map(x => localDateKey(tripTimeMs(x.t)))
        .filter(Boolean);
      const uniqueDates = [...new Set(dates)];

      payload.same_point_m = SAME_POINT_M;
      payload.same_area_m = SAME_AREA_M;

      // Pico側の旧実装がどの名前を見ていても拾えるよう、同じ意味の別名も付ける。
      payload.same_point_total_count = same20.length;
      payload.same_point_today_count = same20Today.length;
      payload.same_area_total_count = same100.length;
      payload.same_area_today_count = same100Today.length;

      payload.near20_total_count = same20.length;
      payload.near20_today_count = same20Today.length;
      payload.near100_total_count = same100.length;
      payload.near100_today_count = same100Today.length;

      payload.history_count = same20.length;
      payload.point_history_count = same20.length;
      payload.today_count = same20Today.length;
      payload.today_history_count = same20Today.length;
      payload.same_point_dates = uniqueDates.slice(0, 30);
      payload.latest_history_date_ms = same20.length ? tripTimeMs(same20[0].t) : 0;
      payload.history_counts_source = 'github_indexeddb_trip_records';
      payload.history_counts_ms = Date.now();
    }catch(e){
      console.warn('[wakasagi] maplink history counts skipped:', e);
    }

    return payload;
  }

  function installMaplinkCountsWrapper(){
    const originalMake = getGlobalFunction('v11_makeMapLinkPayload');
    if(!originalMake) return false;
    if(originalMake[MAPLINK_WRAP_FLAG]) return true;

    const wrappedMake = async function(){
      const p = await originalMake.call(this);
      return await addHistoryCountsToMaplinkPayload(p);
    };

    wrappedMake[MAPLINK_WRAP_FLAG] = true;
    wrappedMake.__original = originalMake;

    window.v11_makeMapLinkPayload = wrappedMake;
    try{ v11_makeMapLinkPayload = wrappedMake; }catch(e){}

    console.info('[wakasagi] maplink history-count wrapper installed');
    return true;
  }

  let tries = 0;
  function retryInstall(){
    tries++;

    const a = installFindTripFix();
    const b = installLakeNameWrapper();
    const c = installMaplinkCountsWrapper();

    if(a && b && c) return;

    if(tries < 100){
      setTimeout(retryInstall, 100);
    }else{
      if(!a) console.warn('[wakasagi] could not install logsync find-trip fix');
      if(!b) console.warn('[wakasagi] could not install lake_autofill wrapper');
      if(!c) console.warn('[wakasagi] could not install maplink count wrapper');
    }
  }

  retryInstall();

  window.__wakasagiLakeAutofill = {
    version: 'logsync-new-trip-fix-and-lake-autofill-20260512',
    fillLakeNameForTrip,
    guessLakeNameFromLatLng,
    fixedFindTripForLogSync,
    addHistoryCountsToMaplinkPayload,
    installFindTripFix,
    installLakeNameWrapper,
    installMaplinkCountsWrapper
  };
})();
