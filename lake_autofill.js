/*
  wakasagi-companion / lake_autofill.js
  修正版: 2026-05-12 lake-name repair 版

  目的:
    1) Pico W /log から戻った #logsync 保存時、lake_name が空なら補完する。
    2) #logsync の保存先選定で、過去地点(map_spot_id)へ統合して回数が増えない問題を止める。
    3) GitHub -> Pico W へ渡す maplink payload に、同地点20m以内の過去回数/今日回数を付加する。
    4) 既に保存済みで lake_name が空の trip_records も、同じChrome内で補修する。
    5) viewer/lakes の全国湖沼JSONが読めない場合でも、主要ワカサギ湖の内蔵フォールバックで補完する。

  守ること:
    - app.js 本体は改造しない。
    - putTrip() 本体は改造しない。
    - Pico W側、viewer側、既存DB構造は変更しない。
    - 失敗しても本体連携・保存処理を止めない。
*/
(function(){
  'use strict';

  const INSTALL_FLAG = '__wakasagiLakeAutofillLogsync20260512LakeRepairInstalled';
  const APPLY_WRAP_FLAG = '__wakasagiLakeAutofillLogsyncWrappedLakeRepair';
  const MAPLINK_WRAP_FLAG = '__wakasagiMaplinkHistoryCountsWrappedLakeRepair20260512';
  const FIND_FIX_FLAG = '__wakasagiLogsyncFindTripLakeRepair20260512';

  const INDEX_URL = './viewer/lakes/index.json';
  const PREF_BASE_URL = './viewer/lakes/';
  const BBOX_MARGIN_DEG = 0.005;
  const NEAR_LIMIT_M = 500;
  const SAME_POINT_M = 20;
  const SAME_AREA_M = 100;

  const DB_NAME = 'wakasagi_trip_map_v10';
  const STORE_TRIPS = 'trip_records';

  const AUTO_INHERIT_POINT_M = 20;
  const AUTO_INHERIT_AREA_M = 100;
  const AUTO_WEATHER_TIMEOUT_MS = 3500;
  const AUTO_REPAIR_MAX_WEATHER_FETCHES = 8;
  const weatherCache = new Map();

  const AUTO_FIELD_UNREGISTERED = '未登録';
  const AUTO_FIELD_UNAVAILABLE = '取得不可';
  const AUTO_FIELD_PENDING = '取得待ち';
  const START_DEPTH_LOOKUP_LIMIT_MS = 180000;

  // viewer/lakes が未読込・圏外・Pico W Wi-Fi中で外部JSONを読めない場合の最後の保険。
  // W09ポリゴン判定を最優先し、それが失敗した場合だけ使う。
  const BUILTIN_LAKE_FALLBACKS = [
    {name:'野尻湖', lat:36.8325, lng:138.2096, radius_m:3800},
    {name:'諏訪湖', lat:36.0474, lng:138.0835, radius_m:5200},
    {name:'桧原湖', lat:37.6860, lng:140.0600, radius_m:8500},
    {name:'山中湖', lat:35.4180, lng:138.8790, radius_m:5200},
    {name:'河口湖', lat:35.5158, lng:138.7550, radius_m:6500},
    {name:'西湖', lat:35.5008, lng:138.6847, radius_m:3600},
    {name:'精進湖', lat:35.4934, lng:138.6117, radius_m:2600},
    {name:'本栖湖', lat:35.4627, lng:138.5838, radius_m:5200},
    {name:'榛名湖', lat:36.4767, lng:138.8752, radius_m:3000},
    {name:'木崎湖', lat:36.5562, lng:137.8340, radius_m:3800},
    {name:'松原湖', lat:36.0530, lng:138.4650, radius_m:1700},
    {name:'中禅寺湖', lat:36.7407, lng:139.4600, radius_m:9500},
    {name:'芦ノ湖', lat:35.2078, lng:139.0019, radius_m:8500},
    {name:'余呉湖', lat:35.5286, lng:136.1902, radius_m:3000},
    {name:'朱鞠内湖', lat:44.3050, lng:142.1600, radius_m:13000},
    {name:'網走湖', lat:43.9800, lng:144.1650, radius_m:10000},
    {name:'阿寒湖', lat:43.4500, lng:144.1000, radius_m:9000},
    {name:'赤城大沼', lat:36.5453, lng:139.1848, radius_m:2600}
  ];

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
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => {
      try{ ctrl.abort(); }catch(e){}
    }, 2500) : null;

    try{
      const opt = ctrl ? { cache: 'force-cache', signal: ctrl.signal } : { cache: 'force-cache' };
      const res = await fetch(url, opt);
      if(!res.ok) throw new Error(url + ' load failed: ' + res.status);
      return await res.json();
    }finally{
      if(timer) clearTimeout(timer);
    }
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

  function guessLakeNameBuiltIn(lat, lng){
    if(!validLatLng(lat, lng)) return null;

    let best = null;
    for(const lake of BUILTIN_LAKE_FALLBACKS){
      const d = distMeters(lat, lng, lake.lat, lake.lng);
      if(Number.isFinite(d) && d <= lake.radius_m){
        if(!best || d < best.distance_m){
          best = {
            lake_name: lake.name,
            lake_source: 'builtin_wakasagi_lake_fallback',
            lake_confidence: 0.55,
            distance_m: d
          };
        }
      }
    }
    return best;
  }

  async function guessLakeNameFromLatLng(lat, lng){
    if(!validLatLng(lat, lng)) return null;

    const fallback = guessLakeNameBuiltIn(lat, lng);

    try{
      const indexRows = await loadLakeIndex();
      const indexCandidates = indexRows.filter(row => {
        const f = lakeFile(row);
        const b = lakeBbox(row);
        return f && b && inBbox(lng, lat, b, BBOX_MARGIN_DEG);
      });

      const files = [...new Set(indexCandidates.map(lakeFile).filter(Boolean))];
      if(!files.length) return fallback;

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

      return nearest || fallback;
    }catch(e){
      console.warn('[wakasagi] lake json guess failed; builtin fallback used if possible:', e);
      return fallback;
    }
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


  function v20260513_isBadLineSinkerValue(v){
    const s = String(v == null ? '' : v).trim();
    const n = s
      .replace(/[　\s]/g, '')
      .replace(/[－ー―—]/g, '-')
      .toLowerCase();

    return n === '未登録' ||
           n === '未設定' ||
           n === '未入力' ||
           n === '不明' ||
           n === 'なし' ||
           n === '取得不可' ||
           n === '-' ||
           n === '--' ||
           n === '0' ||
           n === '0.0' ||
           n === 'na' ||
           n === 'n/a' ||
           n === 'null' ||
           n === 'undefined';
  }


  function v20260513_cleanExactLine(v){
    const s = String(v == null ? '' : v).trim();
    if(!s) return '';
    if(v20260513_isBadLineSinkerValue(s)) return '';
    return s;
  }

  function v20260513_cleanExactSinker(v){
    const s = String(v == null ? '' : v).trim();
    if(!s) return '';
    if(v20260513_isBadLineSinkerValue(s)) return '';
    return s;
  }

  function v20260513_exactLineFrom(obj){
    if(!obj || typeof obj !== 'object') return '';

    const direct = v20260513_cleanExactLine(obj.line_no);
    if(direct) return direct;

    if(obj.pico_summary && typeof obj.pico_summary === 'object'){
      const v = v20260513_cleanExactLine(obj.pico_summary.line_no);
      if(v) return v;
    }

    if(Array.isArray(obj.pico_logs)){
      for(const row of obj.pico_logs){
        if(row && typeof row === 'object'){
          const v = v20260513_cleanExactLine(row.line_no);
          if(v) return v;

          if(row.pico_summary && typeof row.pico_summary === 'object'){
            const vv = v20260513_cleanExactLine(row.pico_summary.line_no);
            if(vv) return vv;
          }
        }
      }
    }

    return '';
  }

  function v20260513_exactSinkerFrom(obj){
    if(!obj || typeof obj !== 'object') return '';

    const direct = v20260513_cleanExactSinker(obj.sinker_g);
    if(direct) return direct;

    if(obj.pico_summary && typeof obj.pico_summary === 'object'){
      const v = v20260513_cleanExactSinker(obj.pico_summary.sinker_g);
      if(v) return v;
    }

    if(Array.isArray(obj.pico_logs)){
      for(const row of obj.pico_logs){
        if(row && typeof row === 'object'){
          const v = v20260513_cleanExactSinker(row.sinker_g);
          if(v) return v;

          if(row.pico_summary && typeof row.pico_summary === 'object'){
            const vv = v20260513_cleanExactSinker(row.pico_summary.sinker_g);
            if(vv) return vv;
          }
        }
      }
    }

    return '';
  }

  function v20260513_forceExactLineSinker(t, payload){
    if(!t || typeof t !== 'object') return false;

    let changed = false;

    const line = v20260513_exactLineFrom(payload) || v20260513_exactLineFrom(t);
    const sinker = v20260513_exactSinkerFrom(payload) || v20260513_exactSinkerFrom(t);

    if(line && t.line_no !== line){
      t.line_no = line;
      changed = true;
    }

    if(sinker && t.sinker_g !== sinker){
      t.sinker_g = sinker;
      changed = true;
    }

    if(changed){
      t.line_sinker_source = 'exact_line_no_sinker_g';
      t.line_sinker_auto_ms = Date.now();
    }

    return changed;
  }

  function v20260513_forceExactLineSinkerOnPayload(p){
    if(!p || typeof p !== 'object') return p;

    const line = v20260513_exactLineFrom(p);
    const sinker = v20260513_exactSinkerFrom(p);

    if(line) p.line_no = line;
    if(sinker) p.sinker_g = sinker;

    return p;
  }

  async function repairBadLineSinkerPlaceholders(){
    let db = null;

    try{
      db = await openTripDbDirect();
      const rows = await getAllTripsDirect(db);
      let fixed = 0;
      let weatherAttempts = 0;

      for(const t of rows){
        if(!t || typeof t !== 'object') continue;

        let changed = false;

        changed = v20260513_forceExactLineSinker(t, null) || changed;

        if(!v20260513_exactLineFrom(t) && v20260513_isBadLineSinkerValue(t.line_no)){
          delete t.line_no;
          changed = true;
        }

        if(!v20260513_exactSinkerFrom(t) && v20260513_isBadLineSinkerValue(t.sinker_g)){
          delete t.sinker_g;
          changed = true;
        }

        if(changed){
          t.updated_ms = Date.now();
          if(await putTripDirect(db, t)) fixed++;
        }
      }

      if(fixed){
        console.info('[wakasagi] removed bad line/sinker placeholders:', fixed);
      }
    }catch(e){
      console.warn('[wakasagi] repairBadLineSinkerPlaceholders skipped:', e);
    }finally{
      try{ if(db) db.close(); }catch(e){}
    }
  }

  function openTripDbDirect(){
    return new Promise((resolve, reject) => {
      try{
        const req = indexedDB.open(DB_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
      }catch(e){
        reject(e);
      }
    });
  }

  function getAllTripsDirect(db){
    return new Promise((resolve) => {
      try{
        if(!db || !db.objectStoreNames.contains(STORE_TRIPS)){
          resolve([]);
          return;
        }
        const tx = db.transaction(STORE_TRIPS, 'readonly');
        const req = tx.objectStore(STORE_TRIPS).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      }catch(e){
        resolve([]);
      }
    });
  }

  function putTripDirect(db, t){
    return new Promise((resolve) => {
      try{
        const tx = db.transaction(STORE_TRIPS, 'readwrite');
        tx.objectStore(STORE_TRIPS).put(t);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      }catch(e){
        resolve(false);
      }
    });
  }

  async function repairSavedTripLakeNames(){
    let db = null;

    try{
      db = await openTripDbDirect();
      const rows = await getAllTripsDirect(db);
      let fixed = 0;
      let weatherAttempts = 0;

      for(const t of rows){
        if(!t || typeof t !== 'object') continue;

        // lake_name が既に入っている履歴も、水深・天気・風・line/sinker補修の対象にする。
        // ここで continue すると、湖名だけ入った過去履歴の自動補修が一切走らない。
        const beforeAuto = JSON.stringify({
          lake_name: t.lake_name || '',
          line_no: t.line_no || '',
          sinker_g: t.sinker_g || '',
          water_depth_m: t.water_depth_m || '',
          fishfinder_depth_m: t.fishfinder_depth_m || '',
          weather: t.weather || '',
          wind: t.wind || '',
          temp_min_c: t.temp_min_c || '',
          temp_max_c: t.temp_max_c || ''
        });

        await fillLakeNameForTrip(t);

        // 既存履歴補修でも、trip本体 / pico_summary / pico_logs の正規キー line_no / sinker_g から実値を復旧する。
        v20260513_forceExactLineSinker(t, null);

        const needWeather = tripNeedsWeatherAutoFill(t);
        const allowWeather = needWeather && weatherAttempts < AUTO_REPAIR_MAX_WEATHER_FETCHES;
        if(allowWeather) weatherAttempts++;
        await fillAutoFieldsForTrip(t, rows, { allowWeather: allowWeather });

        // fillAutoFields後にも、line/sinkerが未登録へ戻らないよう正規キーを再反映する。
        v20260513_forceExactLineSinker(t, null);

        const afterAuto = JSON.stringify({
          lake_name: t.lake_name || '',
          line_no: t.line_no || '',
          sinker_g: t.sinker_g || '',
          water_depth_m: t.water_depth_m || '',
          fishfinder_depth_m: t.fishfinder_depth_m || '',
          weather: t.weather || '',
          wind: t.wind || '',
          temp_min_c: t.temp_min_c || '',
          temp_max_c: t.temp_max_c || ''
        });

        if(afterAuto !== beforeAuto){
          t.updated_ms = Date.now();
          if(await putTripDirect(db, t)) fixed++;
        }
      }

      if(fixed){
        console.info('[wakasagi] repaired lake/auto fields for saved trips:', fixed);
      }
    }catch(e){
      console.warn('[wakasagi] saved trip lake repair skipped:', e);
    }finally{
      try{ if(db) db.close(); }catch(e){}
    }
  }

  function distMeters(lat1, lng1, lat2, lng2){
    const R = 6371008.8;
    const r = v => v * Math.PI / 180;
    const p1 = r(lat1), p2 = r(lat2);
    const dp = r(lat2 - lat1), dl = r(lng2 - lng1);
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function isBlankValue(v){
    return v === undefined || v === null || String(v).trim() === '';
  }

  function isWeatherPlaceholder(v){
    const x = String(v === undefined || v === null ? '' : v).trim();
    return !x || x === AUTO_FIELD_UNAVAILABLE || x === AUTO_FIELD_PENDING || x === '-' || x === '未取得';
  }

  function tempNumOrNull(v){
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  }

  function formatTempC(v){
    const x = tempNumOrNull(v);
    if(x === null) return '';
    return x.toFixed(1).replace(/\.0$/, '') + '℃';
  }

  function hasTempRangeText(v){
    const x = String(v === undefined || v === null ? '' : v);
    return (x.indexOf('最低') >= 0 && x.indexOf('最高') >= 0);
  }

  function stripTempRangeText(v){
    return String(v === undefined || v === null ? '' : v)
      .replace(/\s*[（(]\s*(?:最低|最高)[^）)]*(?:最低|最高)[^）)]*[）)]/g, '')
      .replace(/\s*(?:最低|最高)-?\d+(?:\.\d+)?℃\s*[\/／]\s*(?:最低|最高)-?\d+(?:\.\d+)?℃/g, '')
      .trim();
  }

  function weatherTextWithTemp(weather, tempMinC, tempMaxC){
    const base = stripTempRangeText(weather) || '';
    const minText = formatTempC(tempMinC);
    const maxText = formatTempC(tempMaxC);
    const range = [];
    if(minText) range.push('最低' + minText);
    if(maxText) range.push('最高' + maxText);
    if(!range.length) return base;
    return (base || '天気') + '（' + range.join(' / ') + '）';
  }

  function tripNeedsWeatherAutoFill(trip){
    if(!trip || typeof trip !== 'object') return false;
    if(isWeatherPlaceholder(trip.weather) || isWeatherPlaceholder(trip.wind)) return true;
    if(!hasTempRangeText(trip.weather)) return true;
    if(isBlankValue(trip.temp_min_c) || isBlankValue(trip.temp_max_c)) return true;
    return false;
  }

  function tripWeatherLat(trip){
    return Number(trip && (
      trip.lat || trip.gps_lat || trip.latest_lat ||
      (trip.pico_summary && trip.pico_summary.gps_lat)
    ));
  }

  function tripWeatherLng(trip){
    return Number(trip && (
      trip.lng || trip.gps_lng || trip.latest_lng ||
      (trip.pico_summary && trip.pico_summary.gps_lng)
    ));
  }

  function firstNonBlank(){
    for(const v of arguments){
      if(!isBlankValue(v)) return String(v).trim();
    }
    return '';
  }

  function sameTripId(a, b){
    return String((a && a.trip_id) || '') === String((b && b.trip_id) || '');
  }

  function pickHistoryValue(historyRows, keys){
    for(const row of historyRows){
      const t = row && row.t ? row.t : row;
      if(!t) continue;
      for(const key of keys){
        const v = t[key];
        if(!isBlankValue(v)) return String(v).trim();
      }
    }
    return '';
  }

  function historyRowsForAutoFill(trip, allTrips, limitM, preferPast){
    const a = Number(trip && trip.lat);
    const b = Number(trip && trip.lng);
    const tm = tripTimeMs(trip);

    if(!validLatLng(a, b) || !Array.isArray(allTrips)) return [];

    let rows = allTrips
      .filter(x => x && !sameTripId(x, trip) && validLatLng(tripLat(x), tripLng(x)))
      .map(x => ({ t: x, d: distMeters(a, b, tripLat(x), tripLng(x)), tm: tripTimeMs(x) }))
      .filter(x => Number.isFinite(x.d) && x.d <= limitM);

    if(preferPast && tm){
      rows = rows.filter(x => !x.tm || x.tm <= tm);
    }

    rows.sort((x, y) => {
      const xt = Number(x.tm || 0);
      const yt = Number(y.tm || 0);
      if(yt !== xt) return yt - xt;
      return x.d - y.d;
    });

    return rows;
  }

  function latestRowsForAutoFill(trip, allTrips){
    if(!Array.isArray(allTrips)) return [];

    return allTrips
      .filter(x => x && !sameTripId(x, trip))
      .map(x => ({ t: x, tm: tripTimeMs(x) }))
      .sort((x, y) => Number(y.tm || 0) - Number(x.tm || 0));
  }

  function setIfBlank(trip, key, value){
    if(!trip || !key) return false;
    if(!isBlankValue(trip[key])) return false;
    if(isBlankValue(value)) return false;
    trip[key] = String(value).trim();
    return true;
  }

  function isPlaceholderValue(v){
    const s = String(v == null ? '' : v).trim();
    return !s || s === AUTO_FIELD_UNREGISTERED || s === AUTO_FIELD_UNAVAILABLE || s === '-' || s === '0' || s === '0.0';
  }

  function setIfBlankOrPlaceholder(trip, key, value){
    if(!trip || !key) return false;
    if(!isPlaceholderValue(trip[key])) return false;
    if(isBlankValue(value)) return false;
    trip[key] = String(value).trim();
    return true;
  }

  function normalizeDepthMeters(value, keyName){
    if(value == null || value === '') return '';
    if(typeof value === 'string'){
      const s = value.trim();
      if(!s || s === AUTO_FIELD_UNREGISTERED || s === AUTO_FIELD_UNAVAILABLE) return '';
      value = s.replace(/[^\d.\-]/g, '');
    }

    const n = Number(value);
    if(!Number.isFinite(n)) return '';

    let m = n;
    const k = String(keyName || '').toLowerCase();

    if(k.includes('mm')){
      m = n / 1000.0;
    }else if(Math.abs(n) > 300){
      // 300を超える水深mは現実的ではないので、mm値とみなす。
      m = n / 1000.0;
    }

    if(!Number.isFinite(m) || m <= 0.05 || m > 120) return '';

    return (Math.round(m * 10) / 10).toFixed(1);
  }

  function pickDepthByKeys(obj, keys){
    if(!obj || typeof obj !== 'object') return '';

    for(const key of keys){
      if(Object.prototype.hasOwnProperty.call(obj, key)){
        const v = normalizeDepthMeters(obj[key], key);
        if(v) return v;
      }
    }

    return '';
  }

  function firstPositiveDepthFromLogs(logs, baseMs){
    if(!Array.isArray(logs) || !logs.length) return '';

    const rows = logs
      .filter(x => x && typeof x === 'object')
      .map((x, idx) => {
        const tm = Number(x.t_ms ?? x.ms ?? x.time_ms ?? x.timestamp_ms ?? x.t ?? 0);
        return {x, idx, tm};
      })
      .sort((a, b) => {
        const at = Number(a.tm || 0);
        const bt = Number(b.tm || 0);
        if(at !== bt) return at - bt;
        return a.idx - b.idx;
      });

    for(const row of rows){
      if(baseMs && row.tm && row.tm - baseMs > START_DEPTH_LOOKUP_LIMIT_MS) break;

      const d = pickDepthByKeys(row.x, [
        'depth_m',
        'depthM',
        'depth',
        'water_depth_m',
        'depth_mm',
        'depthMm',
        'depthMM'
      ]);

      if(d) return d;
    }

    return '';
  }

  function extractStartWaterDepthFromTrip(trip){
    if(!trip || typeof trip !== 'object') return '';

    // 1) すでに水深として保存済みなら最優先。
    let d = pickDepthByKeys(trip, [
      'water_depth_m',
      'start_water_depth_m',
      'start_bottom_depth_m',
      'bottom_depth_m',
      'initial_depth_m',
      'first_depth_m',
      'depth_at_start_m',
      'start_depth_m',
      'start_depth',
      'fishfinder_depth_m',
      'fishfinder_m'
    ]);
    if(d) return d;

    const summaries = [
      trip.pico_summary,
      trip.pico_log_summary,
      trip.log_summary,
      trip.summary
    ].filter(x => x && typeof x === 'object');

    // 2) Picoログ要約に開始直後/底取り系の値があれば使う。
    for(const s of summaries){
      d = pickDepthByKeys(s, [
        'water_depth_m',
        'start_water_depth_m',
        'start_bottom_depth_m',
        'bottom_depth_m',
        'initial_depth_m',
        'first_depth_m',
        'depth_at_start_m',
        'start_depth_m',
        'startDepthM',
        'start_depth',
        'start_depth_mm',
        'bottom_depth_mm'
      ]);
      if(d) return d;
    }

    // 3) ログ配列があれば、釣行開始直後の最初の有効深度を使う。
    const logArrays = [
      trip.raw_logs,
      trip.tlog,
      trip.samples,
      trip.logs
    ].filter(Array.isArray);

    for(const arr of logArrays){
      d = firstPositiveDepthFromLogs(arr, 0);
      if(d) return d;
    }

    // 4) pico_logs は現在は要約配列の可能性が高いが、詳細が入っている場合だけ拾う。
    if(Array.isArray(trip.pico_logs)){
      for(const item of trip.pico_logs){
        if(item && Array.isArray(item.logs)){
          d = firstPositiveDepthFromLogs(item.logs, 0);
          if(d) return d;
        }

        d = pickDepthByKeys(item, [
          'water_depth_m',
          'start_water_depth_m',
          'start_bottom_depth_m',
          'bottom_depth_m',
          'initial_depth_m',
          'first_depth_m',
          'depth_at_start_m',
          'start_depth_m',
          'start_depth',
          'start_depth_mm',
          'bottom_depth_mm'
        ]);
        if(d) return d;
      }
    }

    // 5) 最後の保険。開始値が無い旧データでは、深度範囲の最大値を水深近似として使う。
    for(const s of summaries){
      d = pickDepthByKeys(s, [
        'depth_max_m',
        'max_depth_m',
        'depthMaxM',
        'maxDepthM',
        'depth_max',
        'max_depth',
        'depth_max_mm',
        'max_depth_mm'
      ]);
      if(d) return d;
    }

    return '';
  }

  function applyStartWaterDepth(trip){
    try{
      if(!trip || typeof trip !== 'object') return false;

      const d = extractStartWaterDepthFromTrip(trip);
      let changed = false;

      if(d){
        changed = setIfBlankOrPlaceholder(trip, 'water_depth_m', d) || changed;
        changed = setIfBlankOrPlaceholder(trip, 'fishfinder_depth_m', d) || changed;
        if(changed){
          trip.water_depth_source = trip.water_depth_source || 'start_bottom_depth';
          trip.water_depth_auto_ms = Date.now();
        }
      }

      return changed;
    }catch(e){
      console.warn('[wakasagi] applyStartWaterDepth skipped:', e);
      return false;
    }
  }

  function inheritTripFieldsFromHistory(trip, allTrips){
    try{
      if(!trip || typeof trip !== 'object' || !Array.isArray(allTrips)) return false;

      const searchSets = [
        { rows: historyRowsForAutoFill(trip, allTrips, AUTO_INHERIT_POINT_M, true), source: 'same_point_history_20m_past' },
        { rows: historyRowsForAutoFill(trip, allTrips, AUTO_INHERIT_AREA_M, true), source: 'nearby_history_100m_past' },
        { rows: historyRowsForAutoFill(trip, allTrips, AUTO_INHERIT_POINT_M, false), source: 'same_point_history_20m_any' },
        { rows: historyRowsForAutoFill(trip, allTrips, AUTO_INHERIT_AREA_M, false), source: 'nearby_history_100m_any' },
        { rows: latestRowsForAutoFill(trip, allTrips), source: 'latest_history_anywhere' }
      ];

      let changed = applyStartWaterDepth(trip);
      let source = changed ? 'start_bottom_depth' : '';

      for(const set of searchSets){
        const rows = set.rows || [];
        if(!rows.length) continue;

        if(isPlaceholderValue(trip.water_depth_m) && isPlaceholderValue(trip.fishfinder_depth_m)){
          const v = pickHistoryValue(rows, [
            'water_depth_m',
            'start_water_depth_m',
            'start_bottom_depth_m',
            'bottom_depth_m',
            'fishfinder_depth_m',
            'fishfinder_m',
            'depth_m'
          ]);
          if(v){
            const d = normalizeDepthMeters(v, 'water_depth_m') || String(v).trim();
            changed = setIfBlankOrPlaceholder(trip, 'water_depth_m', d) || changed;
            changed = setIfBlankOrPlaceholder(trip, 'fishfinder_depth_m', d) || changed;
            source = source || set.source;
          }
        }

        if(!isPlaceholderValue(trip.water_depth_m) &&
           !isPlaceholderValue(trip.fishfinder_depth_m)){
          break;
        }
      }

      // ここまで集めても情報源が無い場合は、viewer上で空欄にならないよう未登録で固定する。
      // 実値が後で入った場合は、既存値上書き禁止ルールによりここでは上書きしない。
      if(setIfBlankOrPlaceholder(trip, 'water_depth_m', AUTO_FIELD_UNREGISTERED)) changed = true;
      if(setIfBlankOrPlaceholder(trip, 'fishfinder_depth_m', AUTO_FIELD_UNREGISTERED)) changed = true;

      if(changed){
        trip.auto_inherit_source = source || 'no_history_registered';
        trip.auto_inherit_ms = Date.now();
      }

      return changed;
    }catch(e){
      console.warn('[wakasagi] inheritTripFieldsFromHistory skipped:', e);

      let changed = false;
      changed = setIfBlankOrPlaceholder(trip, 'water_depth_m', AUTO_FIELD_UNREGISTERED) || changed;
      changed = setIfBlankOrPlaceholder(trip, 'fishfinder_depth_m', AUTO_FIELD_UNREGISTERED) || changed;
      return changed;
    }
  }

  function weatherCodeJa(code){
    const c = Number(code);
    const map = {
      0:'快晴',
      1:'晴れ', 2:'一部曇り', 3:'曇り',
      45:'霧', 48:'霧氷',
      51:'弱い霧雨', 53:'霧雨', 55:'強い霧雨',
      56:'弱い着氷性霧雨', 57:'着氷性霧雨',
      61:'弱い雨', 63:'雨', 65:'強い雨',
      66:'弱い着氷性雨', 67:'着氷性雨',
      71:'弱い雪', 73:'雪', 75:'強い雪',
      77:'雪粒',
      80:'弱いにわか雨', 81:'にわか雨', 82:'強いにわか雨',
      85:'弱いにわか雪', 86:'にわか雪',
      95:'雷雨', 96:'雷雨・弱い雹', 99:'雷雨・雹'
    };
    return map[c] || (Number.isFinite(c) ? ('天気コード' + c) : '');
  }

  function windDirJa(deg){
    const d = Number(deg);
    if(!Number.isFinite(d)) return '';
    const names = ['北','北北東','北東','東北東','東','東南東','南東','南南東','南','南南西','南西','西南西','西','西北西','北西','北北西'];
    const idx = Math.round((((d % 360) + 360) % 360) / 22.5) % 16;
    return names[idx];
  }

  function ymdFromMs(ms){
    const d = new Date(Number(ms || Date.now()));
    if(Number.isNaN(d.getTime())) return localDateKey(Date.now());
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function nearestHourlyIndex(times, ms){
    if(!Array.isArray(times) || !times.length) return -1;
    const target = Number(ms || Date.now());
    let best = -1;
    let bestD = Infinity;
    for(let i = 0; i < times.length; i++){
      const tm = new Date(String(times[i])).getTime();
      if(!Number.isFinite(tm)) continue;
      const d = Math.abs(tm - target);
      if(d < bestD){
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  async function fetchJsonTimeout(url, timeoutMs){
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => {
      try{ ctrl.abort(); }catch(e){}
    }, timeoutMs || AUTO_WEATHER_TIMEOUT_MS) : null;

    try{
      const opt = ctrl ? { cache: 'force-cache', signal: ctrl.signal } : { cache: 'force-cache' };
      const res = await fetch(url, opt);
      if(!res.ok) throw new Error('weather fetch failed: ' + res.status);
      return await res.json();
    }finally{
      if(timer) clearTimeout(timer);
    }
  }

  function weatherApiBaseForDate(ms){
    const t = Number(ms || Date.now());
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if(t >= now - sevenDaysMs){
      return 'https://api.open-meteo.com/v1/forecast';
    }
    return 'https://archive-api.open-meteo.com/v1/archive';
  }

  async function getWeatherForTrip(trip){
    const lat = tripWeatherLat(trip);
    const lng = tripWeatherLng(trip);
    const ms = tripTimeMs(trip) || Date.now();

    if(!validLatLng(lat, lng)) return null;

    const dateKey = ymdFromMs(ms);
    const cacheKey = lat.toFixed(3) + ',' + lng.toFixed(3) + ',' + dateKey;
    if(weatherCache.has(cacheKey)) return weatherCache.get(cacheKey);

    const base = weatherApiBaseForDate(ms);
    const url = base +
      '?latitude=' + encodeURIComponent(lat.toFixed(6)) +
      '&longitude=' + encodeURIComponent(lng.toFixed(6)) +
      '&start_date=' + encodeURIComponent(dateKey) +
      '&end_date=' + encodeURIComponent(dateKey) +
      '&hourly=weather_code,wind_speed_10m,wind_direction_10m' +
      '&daily=temperature_2m_max,temperature_2m_min' +
      '&timezone=auto';

    const data = await fetchJsonTimeout(url, AUTO_WEATHER_TIMEOUT_MS);
    const h = data && data.hourly ? data.hourly : null;
    const d = data && data.daily ? data.daily : null;
    const idx = h ? nearestHourlyIndex(h.time || [], ms) : -1;

    if(!h || idx < 0){
      weatherCache.set(cacheKey, null);
      return null;
    }

    const wc = Array.isArray(h.weather_code) ? h.weather_code[idx] : null;
    const ws = Array.isArray(h.wind_speed_10m) ? h.wind_speed_10m[idx] : null;
    const wd = Array.isArray(h.wind_direction_10m) ? h.wind_direction_10m[idx] : null;
    const tempMax = d && Array.isArray(d.temperature_2m_max) ? tempNumOrNull(d.temperature_2m_max[0]) : null;
    const tempMin = d && Array.isArray(d.temperature_2m_min) ? tempNumOrNull(d.temperature_2m_min[0]) : null;

    const weatherBase = weatherCodeJa(wc);
    const weather = weatherTextWithTemp(weatherBase, tempMin, tempMax);
    const dir = windDirJa(wd);
    const spd = Number(ws);
    const wind = (dir || Number.isFinite(spd))
      ? (dir + (Number.isFinite(spd) ? ' ' + spd.toFixed(1) + 'm/s' : '')).trim()
      : '';

    const out = {
      weather,
      wind,
      temp_min_c: tempMin === null ? '' : tempMin.toFixed(1),
      temp_max_c: tempMax === null ? '' : tempMax.toFixed(1),
      weather_source: base.includes('archive-api') ? 'open_meteo_archive' : 'open_meteo_forecast',
      weather_ms: Date.now()
    };

    weatherCache.set(cacheKey, out);
    return out;
  }

  async function fillWeatherForTrip(trip){
    try{
      if(!trip || typeof trip !== 'object') return false;
      if(!tripNeedsWeatherAutoFill(trip)) return false;

      const w = await getWeatherForTrip(trip);
      let changed = false;

      if(w){
        if((isWeatherPlaceholder(trip.weather) || !hasTempRangeText(trip.weather)) && w.weather){
          trip.weather = w.weather;
          changed = true;
        }

        if(isWeatherPlaceholder(trip.wind) && w.wind){
          trip.wind = w.wind;
          changed = true;
        }

        if(!isBlankValue(w.temp_min_c) && String(trip.temp_min_c || '') !== String(w.temp_min_c)){
          trip.temp_min_c = String(w.temp_min_c);
          changed = true;
        }

        if(!isBlankValue(w.temp_max_c) && String(trip.temp_max_c || '') !== String(w.temp_max_c)){
          trip.temp_max_c = String(w.temp_max_c);
          changed = true;
        }

        if(changed){
          trip.weather_source = w.weather_source || '';
          trip.weather_auto_ms = w.weather_ms || Date.now();
        }
      }

      // 通信失敗・APモード・一時的なAPI失敗を「取得不可」で固定しない。
      // 「取得待ち」は後で通常通信時に再取得対象にする。
      if(isWeatherPlaceholder(trip.weather) && isBlankValue(trip.weather)){
        trip.weather = AUTO_FIELD_PENDING;
        trip.weather_source = trip.weather_source || 'open_meteo_pending';
        trip.weather_auto_ms = trip.weather_auto_ms || Date.now();
        changed = true;
      }

      if(isWeatherPlaceholder(trip.wind) && isBlankValue(trip.wind)){
        trip.wind = AUTO_FIELD_PENDING;
        trip.weather_source = trip.weather_source || 'open_meteo_pending';
        trip.weather_auto_ms = trip.weather_auto_ms || Date.now();
        changed = true;
      }

      return changed;
    }catch(e){
      console.warn('[wakasagi] fillWeatherForTrip skipped:', e);

      let changed = false;

      if(isBlankValue(trip.weather)){
        trip.weather = AUTO_FIELD_PENDING;
        trip.weather_source = trip.weather_source || 'open_meteo_pending';
        trip.weather_auto_ms = trip.weather_auto_ms || Date.now();
        changed = true;
      }

      if(isBlankValue(trip.wind)){
        trip.wind = AUTO_FIELD_PENDING;
        trip.weather_source = trip.weather_source || 'open_meteo_pending';
        trip.weather_auto_ms = trip.weather_auto_ms || Date.now();
        changed = true;
      }

      return changed;
    }
  }

  async function fillAutoFieldsForTrip(trip, allTrips, opt){
    let changed = false;

    try{
      changed = applyStartWaterDepth(trip) || changed;
    }catch(e){
      console.warn('[wakasagi] start water depth auto-fill skipped:', e);
    }

    try{
      if(!Array.isArray(allTrips)){
        const getAll = getGlobalFunction('getAllTrips');
        if(getAll) allTrips = await getAll();
      }

      if(Array.isArray(allTrips)){
        changed = inheritTripFieldsFromHistory(trip, allTrips) || changed;
      }
    }catch(e){
      console.warn('[wakasagi] history auto-fill skipped:', e);
    }

    try{
      const allowWeather = !opt || opt.allowWeather !== false;
      if(allowWeather){
        changed = (await fillWeatherForTrip(trip)) || changed;
      }
    }catch(e){
      console.warn('[wakasagi] weather auto-fill skipped:', e);
    }

    return changed;
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
      v20260513_forceExactLineSinkerOnPayload(p);

      const originalPutTrip = getGlobalFunction('putTrip');
      if(!originalPutTrip){
        return await originalApply.call(this, p);
      }

      const wrappedPutTrip = async function(t){
        v20260513_forceExactLineSinker(t, p);
        await fillLakeNameForTrip(t);
        await fillAutoFieldsForTrip(t, null, { allowWeather: true });
        v20260513_forceExactLineSinker(t, p);
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

  function installPutTripLineSinkerRepairWrapper(){
    const originalPutTrip = getGlobalFunction('putTrip');
    if(!originalPutTrip) return false;
    if(originalPutTrip.__wakasagiLineSinkerPutTripRepair20260513) return true;

    const wrappedPutTrip = async function(t){
      try{
        v20260513_forceExactLineSinker(t, null);
      }catch(e){
        console.warn('[wakasagi] putTrip line/sinker repair skipped:', e);
      }

      return await originalPutTrip.call(this, t);
    };

    wrappedPutTrip.__wakasagiLineSinkerPutTripRepair20260513 = true;
    wrappedPutTrip.__original = originalPutTrip;

    setGlobalPutTrip(wrappedPutTrip);

    console.info('[wakasagi] putTrip line/sinker repair wrapper installed');
    return true;
  }

  async function addHistoryCountsToMaplinkPayload(payload){
    try{
      if(!payload || typeof payload !== 'object') return payload;
      const baseLat = Number(payload.lat);
      const baseLng = Number(payload.lng);
      if(!validLatLng(baseLat, baseLng)) return payload;

      if(!String(payload.lake_name || payload.lakeName || '').trim()){
        const tmp = { lat: baseLat, lng: baseLng };
        await fillLakeNameForTrip(tmp);
        if(tmp.lake_name){
          payload.lake_name = tmp.lake_name;
          payload.lake_source = tmp.lake_source || '';
          payload.lake_confidence = Number(tmp.lake_confidence || 0);
        }
      }

      const getAll = getGlobalFunction('getAllTrips');
      if(!getAll) return payload;

      const trips = await getAll();

      // Pico Wへ戻すpayloadには、水深だけ同地点履歴から補完する。
      // line_no / sinker_g は本体ログの正規キーだけを使うため、ここでは履歴補完しない。
      const tmpAuto = {
        trip_id: '__maplink_payload__',
        lat: baseLat,
        lng: baseLng,
        date_ms: Date.now(),
        water_depth_m: payload.water_depth_m || payload.fishfinder_m || payload.fishfinder_depth_m || '',
        fishfinder_depth_m: payload.fishfinder_m || payload.fishfinder_depth_m || ''
      };
      inheritTripFieldsFromHistory(tmpAuto, trips);
      if(!String(payload.fishfinder_m || payload.fishfinder_depth_m || payload.water_depth_m || '').trim()){
        const wd = tmpAuto.water_depth_m || tmpAuto.fishfinder_depth_m || AUTO_FIELD_UNREGISTERED;
        payload.water_depth_m = wd;
        payload.fishfinder_m = wd;
        payload.fishfinder_depth_m = wd;
      }
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
    const d = installPutTripLineSinkerRepairWrapper();

    if(a && b && c && d) return;

    if(tries < 100){
      setTimeout(retryInstall, 100);
    }else{
      if(!a) console.warn('[wakasagi] could not install logsync find-trip fix');
      if(!b) console.warn('[wakasagi] could not install lake_autofill wrapper');
      if(!c) console.warn('[wakasagi] could not install maplink count wrapper');
      if(!d) console.warn('[wakasagi] could not install putTrip line/sinker repair wrapper');
    }
  }

  retryInstall();

  // 既に保存済みの「湖名なし」データも補修する。
  // 1回目は初期表示後、2回目は app.js のDB初期化が遅れた場合の保険。

  setTimeout(repairSavedTripLakeNames, 1200);
  setTimeout(repairSavedTripLakeNames, 5000);
  setTimeout(repairBadLineSinkerPlaceholders, 1300);
  setTimeout(repairBadLineSinkerPlaceholders, 5200);

  window.__wakasagiLakeAutofill = {
    version: 'production-weather-retry-coordinate-check-20260525b',
    fillLakeNameForTrip,
    fillAutoFieldsForTrip,
    fillWeatherForTrip,
    inheritTripFieldsFromHistory,
    extractStartWaterDepthFromTrip,
    applyStartWaterDepth,
    repairSavedTripLakeNames,
    repairBadLineSinkerPlaceholders,
    v20260513_forceExactLineSinker,
    v20260513_forceExactLineSinkerOnPayload,
    guessLakeNameFromLatLng,
    guessLakeNameBuiltIn,
    fixedFindTripForLogSync,
    addHistoryCountsToMaplinkPayload,
    installFindTripFix,
    installLakeNameWrapper,
    installMaplinkCountsWrapper
  };
})();
