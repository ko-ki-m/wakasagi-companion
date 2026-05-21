/*
  wakasagi-companion / lake_autofill.js
  Version: 2026-05-21 d1 place-visit fix

  目的:
    1) 既存トップ階層 app_pre_stage1_rollback.js は変更しない。
    2) service-worker.js は変更しない。
    3) Pico W /log から戻った #logsync 保存時、
       point_visit_id を地図ピンIDに使わない。
    4) point_visit_id は Pico Wログ区間IDとして保持する。
    5) map_point_key はGPS座標から作る物理地点キーにする。
    6) 同じ point_visit_id の再同期だけ既存trip更新にする。
    7) 同じ場所でも新しい point_visit_id は別visitとして保存し、
       app_pre_stage1_rollback.js 側の 10m group 表示で同じピンにまとまる。
    8) 移動だけのデータは保存しない。tlog_count と seq 差分があるものだけ保存する。
    9) 既存の湖名自動補完は維持する。
*/
(function(){
  'use strict';

  const INSTALL_FLAG = '__wakasagiLakeAutofillPlaceVisitFix20260521d1Installed';
  const WRAP_FLAG = '__wakasagiLakeAutofillPlaceVisitFix20260521d1Wrapped';

  const INDEX_URL = './viewer/lakes/index.json';
  const PREF_BASE_URL = './viewer/lakes/';
  const BBOX_MARGIN_DEG = 0.005;
  const NEAR_LIMIT_M = 500;

  if(window[INSTALL_FLAG]) return;
  window[INSTALL_FLAG] = true;

  let lakeIndexCache = null;
  const lakePrefCache = new Map();

  function validLatLng(lat, lng){
    return Number.isFinite(lat) && Number.isFinite(lng) &&
           lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }

  function normText(v){
    return String(v == null ? '' : v).trim();
  }

  const PLACEHOLDER_WORDS = new Set([
    '', '-', '--', '0', '0.0',
    '未登録', '未設定', '未入力', '不明', 'なし',
    '取得不可', 'na', 'n/a', 'null', 'undefined'
  ]);

  function isPlaceholder(v){
    const s = normText(v)
      .replace(/[　\s]/g, '')
      .replace(/[－ー―—]/g, '-')
      .toLowerCase();
    return PLACEHOLDER_WORDS.has(s);
  }

  function realText(v){
    return isPlaceholder(v) ? '' : normText(v);
  }

  function numOrNull(v){
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function depthNum(v){
    const n = Number(v);
    return (Number.isFinite(n) && n > 0) ? n : null;
  }

  function maxDepthText(){
    let best = null;
    for(const v of arguments){
      const n = depthNum(v);
      if(n === null) continue;
      if(best === null || n > best) best = n;
    }
    return best === null ? '' : best.toFixed(3);
  }

  function payloadVisitId(p){
    return String((p && (p.point_visit_id || p.visit_id)) || '').trim();
  }

  function payloadSid(p){
    return String((p && p.sid) || '').trim();
  }

  function payloadLat(p){
    return Number(p && (p.gps_lat ?? p.lat));
  }

  function payloadLng(p){
    return Number(p && (p.gps_lng ?? p.lng));
  }

  function physicalPlaceKey(lat, lng){
    if(!validLatLng(lat, lng)) return '';
    const latM = 111111.0;
    const lngM = 111111.0 * Math.cos(lat * Math.PI / 180);
    const gy = Math.round((lat * latM) / 10.0);
    const gx = Math.round((lng * lngM) / 10.0);
    return 'PLACE_' + gy + '_' + gx;
  }

  function hasFishingActivity(p){
    const tlog = Number(p && p.tlog_count);
    const firstSeq = Number(p && (p.first_seq ?? p.point_start_seq ?? 0));
    const lastSeq  = Number(p && (p.last_seq  ?? p.point_last_seq  ?? 0));

    if(Number.isFinite(tlog) && tlog > 0 && Number.isFinite(firstSeq) && Number.isFinite(lastSeq) && lastSeq > firstSeq){
      return true;
    }

    // 互換保険。seqが欠けていても、複数ログがある場合だけ実釣あり扱い。
    if(Number.isFinite(tlog) && tlog > 1){
      return true;
    }

    return false;
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

  function normalizeTripFromLogPayload(t, p){
    if(!t || !p || typeof t !== 'object') return t;

    const sid = payloadSid(p);
    const visitId = payloadVisitId(p);
    const lat = payloadLat(p);
    const lng = payloadLng(p);
    const placeKey = physicalPlaceKey(lat, lng);
    const now = Date.now();

    if(sid) t.pico_sid = sid;

    // point_visit_id はログ境界IDとして必ず保持。
    if(visitId) t.point_visit_id = visitId;

    // map_point_key は物理地点キーへ置き換える。point_visit_id は入れない。
    if(placeKey) t.map_point_key = placeKey;

    if(validLatLng(lat, lng)){
      t.lat = lat;
      t.lng = lng;
      t.accuracy_m = numOrNull(p.gps_acc_m || p.acc) || Number(t.accuracy_m || 0) || 0;
      t.location_time_ms = numOrNull(p.gps_ms) || numOrNull(p.start_ms) || Number(t.location_time_ms || 0) || now;
    }

    const line = realText(p.line_no || p.line || p.lineNo);
    if(line) t.line_no = line;

    const sinker = realText(p.sinker_g || p.sinker || p.sinkerG);
    if(sinker) t.sinker_g = sinker;

    const incomingDepth = maxDepthText(p.fishfinder_depth_m, p.max_depth_m, p.fishfinder_m);
    const mergedDepth = maxDepthText(t.fishfinder_depth_m, incomingDepth);
    if(incomingDepth){
      t.fishfinder_depth_m = mergedDepth;
      t.depth_status = 'measured';
    }else if(!t.fishfinder_depth_m){
      t.depth_status = 'not_measured';
    }

    if(t.pico_summary && typeof t.pico_summary === 'object'){
      t.pico_summary.point_visit_id = visitId || String(t.pico_summary.point_visit_id || '');
      t.pico_summary.map_point_key = placeKey || String(t.pico_summary.map_point_key || '');
    }

    if(Array.isArray(t.pico_logs)){
      t.pico_logs = t.pico_logs.map(log=>{
        if(!log || typeof log !== 'object') return log;
        if(visitId && String(log.point_visit_id || '') === visitId){
          log.map_point_key = placeKey || String(log.map_point_key || '');
        }
        return log;
      });
    }

    t.updated_ms = now;
    return t;
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
    try{ eval(name + ' = fn'); }catch(e){}
  }

  function setGlobalPutTrip(fn){
    try{ window.putTrip = fn; }catch(e){}
    try{ putTrip = fn; }catch(e){}
  }

  function visitMatchesTrip(t, visitId){
    if(!t || !visitId) return false;

    if(String(t.point_visit_id || '') === visitId) return true;

    if(t.pico_summary && String(t.pico_summary.point_visit_id || '') === visitId) return true;

    if(Array.isArray(t.pico_logs) && t.pico_logs.some(l => String(l && l.point_visit_id || '') === visitId)){
      return true;
    }

    return false;
  }

  function installWrapper(){
    const originalApply = getGlobalFunction('v112_applyLogSyncPayload');
    const originalFind = getGlobalFunction('v112_findTripForLogSync');

    if(!originalApply || !originalFind) return false;
    if(originalApply[WRAP_FLAG]) return true;

    const wrappedFind = async function(p){
      const trips = await getAllTrips();
      const visitId = payloadVisitId(p);
      const sid = payloadSid(p);

      // 同じログ区間だけ既存更新。
      // map_point_key は物理地点キーなので、保存先検索には使わない。
      if(visitId){
        for(const t of trips){
          if(visitMatchesTrip(t, visitId)) return t;
        }
        return null;
      }

      // 古いpayload互換。visitIdが無い時だけsid一致を許す。
      if(sid){
        for(const t of trips){
          if(String(t.pico_sid || '') === sid) return t;
          if(t.pico_summary && String(t.pico_summary.sid || '') === sid) return t;
          if(Array.isArray(t.pico_logs) && t.pico_logs.some(l => String(l && l.sid || '') === sid)) return t;
        }
      }

      return null;
    };

    const wrappedApply = async function(p){
      if(!p || p.__error){
        return await originalApply.call(this, p);
      }

      const sid = payloadSid(p);
      const visitId = payloadVisitId(p);
      const lat = payloadLat(p);
      const lng = payloadLng(p);

      if(!sid || !visitId || !validLatLng(lat, lng)){
        return await originalApply.call(this, p);
      }

      if(!hasFishingActivity(p)){
        if(typeof window.v112_setLogSync === 'function'){
          try{ window.v112_setLogSync('実釣ログなし', 'warn'); }catch(e){}
        }
        return false;
      }

      const originalPutTrip = getGlobalFunction('putTrip');
      if(!originalPutTrip){
        return await originalApply.call(this, p);
      }

      const wrappedPutTrip = async function(t){
        normalizeTripFromLogPayload(t, p);
        await fillLakeNameForTrip(t);
        return await originalPutTrip.call(this, t);
      };

      setGlobalPutTrip(wrappedPutTrip);

      try{
        const result = await originalApply.call(this, p);

        // originalApply後に、保存済みtripをもう一度整える。
        // debug wrapper が putTrip を監視している場合も、最終状態を明確に残す。
        try{
          const trips = await getAllTrips();
          const t = trips.find(x => visitMatchesTrip(x, visitId));
          if(t){
            normalizeTripFromLogPayload(t, p);
            await fillLakeNameForTrip(t);
            await originalPutTrip.call(this, t);
            if(typeof selectedTripId !== 'undefined') selectedTripId = t.trip_id;
            if(typeof refreshAll === 'function') await refreshAll();
          }
        }catch(e){
          console.warn('[wakasagi] final place-visit normalize skipped:', e);
        }

        return result;
      }finally{
        const cur = getGlobalFunction('putTrip');
        if(cur === wrappedPutTrip){
          setGlobalPutTrip(originalPutTrip);
        }
      }
    };

    wrappedFind[WRAP_FLAG] = true;
    wrappedApply[WRAP_FLAG] = true;

    setGlobalFunction('v112_findTripForLogSync', wrappedFind);
    setGlobalFunction('v112_applyLogSyncPayload', wrappedApply);

    console.info('[wakasagi] place-visit logsync wrapper installed 20260521d1');
    return true;
  }

  let tries = 0;
  function retryInstall(){
    tries++;
    if(installWrapper()) return;
    if(tries < 80){
      setTimeout(retryInstall, 100);
    }else{
      console.warn('[wakasagi] could not find v112 logsync functions');
    }
  }

  retryInstall();

  window.__wakasagiPlaceVisitFix20260521d1 = {
    version: '20260521d1',
    installWrapper,
    physicalPlaceKey,
    hasFishingActivity
  };
})();
