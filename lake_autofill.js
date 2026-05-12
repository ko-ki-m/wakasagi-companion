/*
  wakasagi-companion / lake_autofill.js
  目的:
    既存トップ階層 app.js は変更せず、Pico W /log から戻った #logsync 保存時だけ、
    lake_name が空の釣行データへ viewer/lakes の全国湖沼JSONから湖名を補完する。

  重要:
    - putTrip() 本体は改造しない。
    - v112_applyLogSyncPayload() の実行中だけ、putTrip(t) を一時的に包んで保存直前に補完する。
    - lake_name / lakeName が既にある場合は絶対に上書きしない。
    - 湖名推定失敗、JSON読込失敗、通信失敗でも保存は止めない。
    - Pico W側、viewer側、既存DB構造は変更しない。
*/
(function(){
  'use strict';

  const INSTALL_FLAG = '__wakasagiLakeAutofillLogsync20260512Installed';
  const WRAP_FLAG = '__wakasagiLakeAutofillLogsyncWrapped';
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

  function getGlobalFunction(name){
    try{
      return typeof window[name] === 'function' ? window[name] : null;
    }catch(e){
      return null;
    }
  }

  function setGlobalPutTrip(fn){
    try{ window.putTrip = fn; }catch(e){}
    try{ putTrip = fn; }catch(e){}
  }

  function installWrapper(){
    const originalApply = getGlobalFunction('v112_applyLogSyncPayload');
    if(!originalApply) return false;
    if(originalApply[WRAP_FLAG]) return true;

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

    wrappedApply[WRAP_FLAG] = true;
    window.v112_applyLogSyncPayload = wrappedApply;
    try{ v112_applyLogSyncPayload = wrappedApply; }catch(e){}

    console.info('[wakasagi] lake_autofill logsync wrapper installed');
    return true;
  }

  let tries = 0;
  function retryInstall(){
    tries++;
    if(installWrapper()) return;
    if(tries < 80){
      setTimeout(retryInstall, 100);
    }else{
      console.warn('[wakasagi] lake_autofill could not find v112_applyLogSyncPayload');
    }
  }

  retryInstall();

  window.__wakasagiLakeAutofill = {
    version: 'logsync-20260512-upload-file',
    fillLakeNameForTrip,
    guessLakeNameFromLatLng,
    installWrapper
  };
})();
