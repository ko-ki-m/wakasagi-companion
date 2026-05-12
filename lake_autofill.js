'use strict';

/*
  Wakasagi root page lake-name autofill patch.

  Scope:
  - Existing top-level map/log-link page only.
  - Replaces manual saveTrip() behavior only.
  - Does NOT modify putTrip(), logsync, maplink, /remote, Pico W sketch.
  - Existing lake_name is never overwritten.
  - If lake dataset cannot be read, save continues without lake_name.
*/

let g_rootLakeIndex = null;
const g_rootLakePrefCache = new Map();

async function rootLakeLoadIndex(){
  if(g_rootLakeIndex) return g_rootLakeIndex;
  const res = await fetch('./viewer/lakes/index.json', {cache:'force-cache'});
  if(!res.ok) throw new Error('viewer/lakes/index.json を読めません');
  g_rootLakeIndex = await res.json();
  return g_rootLakeIndex;
}

async function rootLakeLoadPrefFile(file){
  if(g_rootLakePrefCache.has(file)) return g_rootLakePrefCache.get(file);
  const res = await fetch('./viewer/lakes/' + file, {cache:'force-cache'});
  if(!res.ok) throw new Error('./viewer/lakes/' + file + ' を読めません');
  const data = await res.json();
  g_rootLakePrefCache.set(file, data);
  return data;
}

function rootLakeInBbox(lng, lat, bbox, marginDeg = 0){
  return lng >= bbox[0] - marginDeg &&
         lat >= bbox[1] - marginDeg &&
         lng <= bbox[2] + marginDeg &&
         lat <= bbox[3] + marginDeg;
}

function rootLakePointInRing(lng, lat, ring){
  let inside = false;
  for(let i=0, j=ring.length-1; i<ring.length; j=i++){
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
    if(intersect) inside = !inside;
  }
  return inside;
}

function rootLakePointInPolygon(lng, lat, polygonCoords){
  if(!polygonCoords || !polygonCoords.length) return false;
  if(!rootLakePointInRing(lng, lat, polygonCoords[0])) return false;
  for(let i=1; i<polygonCoords.length; i++){
    if(rootLakePointInRing(lng, lat, polygonCoords[i])) return false;
  }
  return true;
}

function rootLakePointInGeometry(lng, lat, geom){
  if(!geom) return false;
  if(geom.type === 'Polygon'){
    return rootLakePointInPolygon(lng, lat, geom.coordinates);
  }
  if(geom.type === 'MultiPolygon'){
    return geom.coordinates.some(poly => rootLakePointInPolygon(lng, lat, poly));
  }
  return false;
}

function rootLakePointToSegmentDistanceMeters(lat, lng, lat1, lng1, lat2, lng2){
  const R = 6371008.8;
  const baseLatRad = lat * Math.PI / 180;

  function xOf(lon){ return (lon - lng) * Math.PI / 180 * Math.cos(baseLatRad) * R; }
  function yOf(la){ return (la - lat) * Math.PI / 180 * R; }

  const ax = xOf(lng1), ay = yOf(lat1);
  const bx = xOf(lng2), by = yOf(lat2);
  const dx = bx - ax, dy = by - ay;
  const len2 = dx*dx + dy*dy;

  if(len2 <= 1e-9){
    return Math.sqrt(ax*ax + ay*ay);
  }

  let t = -(ax*dx + ay*dy) / len2;
  if(t < 0) t = 0;
  if(t > 1) t = 1;

  const cx = ax + t*dx;
  const cy = ay + t*dy;
  return Math.sqrt(cx*cx + cy*cy);
}

function rootLakeRingDistanceMeters(lat, lng, ring){
  let best = Infinity;
  for(let i=0; i<ring.length-1; i++){
    const a = ring[i];
    const b = ring[i+1];
    const d = rootLakePointToSegmentDistanceMeters(lat, lng, a[1], a[0], b[1], b[0]);
    if(d < best) best = d;
  }
  return best;
}

function rootLakeGeometryDistanceMeters(lat, lng, geom){
  if(!geom) return Infinity;
  let best = Infinity;

  if(geom.type === 'Polygon'){
    for(const ring of geom.coordinates){
      const d = rootLakeRingDistanceMeters(lat, lng, ring);
      if(d < best) best = d;
    }
    return best;
  }

  if(geom.type === 'MultiPolygon'){
    for(const poly of geom.coordinates){
      for(const ring of poly){
        const d = rootLakeRingDistanceMeters(lat, lng, ring);
        if(d < best) best = d;
      }
    }
    return best;
  }

  return Infinity;
}

async function rootLakeGuessFromLatLng(lat, lng){
  if(!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const index = await rootLakeLoadIndex();

  const marginDeg = 0.005;
  const nearLimitM = 500;

  const candidates = (index.lakes || []).filter(lake => rootLakeInBbox(lng, lat, lake.bbox, marginDeg));
  if(!candidates.length) return null;

  const files = [...new Set(candidates.map(c => c.file))];
  let nearest = null;

  for(const file of files){
    const lakes = await rootLakeLoadPrefFile(file);

    for(const lake of lakes){
      if(!rootLakeInBbox(lng, lat, lake.bbox, marginDeg)) continue;

      if(rootLakePointInGeometry(lng, lat, lake.geometry)){
        return {
          lake_name: lake.name,
          lake_source: 'ksj_w09_polygon',
          lake_confidence: 1.0
        };
      }

      const d = rootLakeGeometryDistanceMeters(lat, lng, lake.geometry);
      if(Number.isFinite(d) && d <= nearLimitM){
        if(!nearest || d < nearest.distance_m){
          nearest = {
            lake_name: lake.name,
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

async function rootLakeFillLakeNameIfEmpty(t){
  try{
    const current = String(t.lake_name || t.lakeName || '').trim();
    if(current) return t;

    const a = Number(t.lat);
    const b = Number(t.lng);
    if(!validLatLng(a,b)) return t;

    const guess = await rootLakeGuessFromLatLng(a,b);
    if(guess && guess.lake_name){
      t.lake_name = guess.lake_name;
      t.lake_source = guess.lake_source || '';
      t.lake_confidence = Number(guess.lake_confidence || 0);
    }
  }catch(e){
    console.warn('root lake autofill failed', e);
  }
  return t;
}

(function installRootLakeSaveTripPatch(){
  if(typeof saveTrip !== 'function'){
    console.warn('saveTrip not found; lake autofill patch not installed');
    return;
  }

  saveTrip = async function saveTripWithLakeNameAutofill(){
    if(!currentPos){
      alert('現在地がありません。');
      return;
    }

    const f = readForm();
    const now = nowMs();
    const trips = await getAllTrips();

    const near = trips.filter(t =>
      dBase(t,currentPos.lat,currentPos.lng) !== null &&
      dBase(t,currentPos.lat,currentPos.lng) <= SAME_POINT_M
    );

    if(near.length > 0 && !confirm(`20m以内に過去履歴が${near.length}件あります。この場所の新しい釣行回として保存しますか？`)){
      return;
    }

    const t = {
      trip_id: genId('T'),
      ...f,
      lat: Number(currentPos.lat),
      lng: Number(currentPos.lng),
      accuracy_m: Number(currentPos.acc || 0),
      location_time_ms: Number(currentPos.t || now),
      created_ms: now,
      updated_ms: now
    };

    await rootLakeFillLakeNameIfEmpty(t);

    await putTrip(t);
    selectedTripId = t.trip_id;
    setBadge('saveBadge','保存済み','good');
    await refreshAll();
    await selectTrip(t.trip_id);
  };

  console.log('root lake autofill patch installed: saveTrip only');
})();
