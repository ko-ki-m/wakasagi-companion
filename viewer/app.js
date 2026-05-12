'use strict';

const DB_NAME = 'wakasagi_trip_map_v10';
const DB_VER = 1;
const STORE_TRIPS = 'trip_records';
const SAME_POINT_M = 20;
const DEFAULT_CENTER = [36.2048, 138.2529];

let db = null;
let allTrips = [];
let selectedTripId = null;
let map = null;
let markers = null;

let g_lakeIndex = null;
const g_lakePrefCache = new Map();
const g_lakeGuessCache = new Map();

const $ = (id) => document.getElementById(id);

function esc(v){
  return String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[m]));
}
function pad(n){ return String(n).padStart(2, '0'); }
function fmtDate(ms){
  const n = Number(ms || 0);
  if(!n) return '-';
  const d = new Date(n);
  if(Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())}`;
}
function fmtDateTime(ms){
  const n = Number(ms || 0);
  if(!n) return '-';
  const d = new Date(n);
  if(Number.isNaN(d.getTime())) return '-';
  return `${fmtDate(n)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function lat(t){ return toNum(t.lat); }
function lng(t){ return toNum(t.lng); }
function tms(t){ return Number(t.date_ms || t.start_ms || t.created_ms || t.location_time_ms || 0); }

async function loadLakeIndex(){
  if(g_lakeIndex) return g_lakeIndex;
  const res = await fetch('./lakes/index.json', {cache:'force-cache'});
  if(!res.ok) throw new Error('lakes/index.json を読めません');
  g_lakeIndex = await res.json();
  return g_lakeIndex;
}

async function loadLakePrefFile(file){
  if(g_lakePrefCache.has(file)) return g_lakePrefCache.get(file);
  const res = await fetch('./lakes/' + file, {cache:'force-cache'});
  if(!res.ok) throw new Error('./lakes/' + file + ' を読めません');
  const data = await res.json();
  g_lakePrefCache.set(file, data);
  return data;
}

function inBboxLngLat(lng, lat, bbox, marginDeg = 0){
  return lng >= bbox[0] - marginDeg &&
         lat >= bbox[1] - marginDeg &&
         lng <= bbox[2] + marginDeg &&
         lat <= bbox[3] + marginDeg;
}

function pointInRing(lng, lat, ring){
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

function pointInPolygon(lng, lat, polygonCoords){
  if(!polygonCoords || !polygonCoords.length) return false;
  if(!pointInRing(lng, lat, polygonCoords[0])) return false;
  for(let i=1; i<polygonCoords.length; i++){
    if(pointInRing(lng, lat, polygonCoords[i])) return false;
  }
  return true;
}

function pointInGeometry(lng, lat, geom){
  if(!geom) return false;
  if(geom.type === 'Polygon'){
    return pointInPolygon(lng, lat, geom.coordinates);
  }
  if(geom.type === 'MultiPolygon'){
    return geom.coordinates.some(poly => pointInPolygon(lng, lat, poly));
  }
  return false;
}

function tripLakeGuessKey(t){
  return String(t.trip_id || '') || (String(t.date_ms || '') + ':' + String(t.lat || '') + ':' + String(t.lng || ''));
}


function distanceMetersLatLng(lat1, lng1, lat2, lng2){
  const R = 6371008.8;
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dp/2) * Math.sin(dp/2) +
            Math.cos(p1) * Math.cos(p2) *
            Math.sin(dl/2) * Math.sin(dl/2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function pointToSegmentDistanceMeters(lat, lng, lat1, lng1, lat2, lng2){
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

function ringDistanceMeters(lat, lng, ring){
  let best = Infinity;
  for(let i=0; i<ring.length-1; i++){
    const a = ring[i];
    const b = ring[i+1];
    const d = pointToSegmentDistanceMeters(lat, lng, a[1], a[0], b[1], b[0]);
    if(d < best) best = d;
  }
  return best;
}

function geometryDistanceMeters(lat, lng, geom){
  if(!geom) return Infinity;
  let best = Infinity;

  if(geom.type === 'Polygon'){
    for(const ring of geom.coordinates){
      const d = ringDistanceMeters(lat, lng, ring);
      if(d < best) best = d;
    }
    return best;
  }

  if(geom.type === 'MultiPolygon'){
    for(const poly of geom.coordinates){
      for(const ring of poly){
        const d = ringDistanceMeters(lat, lng, ring);
        if(d < best) best = d;
      }
    }
    return best;
  }

  return Infinity;
}


async function guessLakeNameFromLatLng(lat, lng){
  if(!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const index = await loadLakeIndex();

  // bbox候補拡張。湖岸付近・GPSずれを拾うため約500m相当に広げる。
  const marginDeg = 0.005;
  const nearLimitM = 500;

  const candidates = (index.lakes || []).filter(lake => inBboxLngLat(lng, lat, lake.bbox, marginDeg));
  if(!candidates.length) return null;

  const files = [...new Set(candidates.map(c => c.file))];
  let nearest = null;

  for(const file of files){
    const lakes = await loadLakePrefFile(file);

    for(const lake of lakes){
      if(!inBboxLngLat(lng, lat, lake.bbox, marginDeg)) continue;

      if(pointInGeometry(lng, lat, lake.geometry)){
        return {
          lake_name: lake.name,
          lake_source: 'ksj_w09_polygon',
          lake_confidence: 1.0
        };
      }

      const d = geometryDistanceMeters(lat, lng, lake.geometry);
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

async function enrichLakeGuessesForTrips(trips){
  try{
    const targets = trips.filter(t => {
      const current = String(t.lake_name || t.lakeName || '').trim();
      return !current && validLatLng(lat(t), lng(t));
    });

    for(const t of targets){
      const key = tripLakeGuessKey(t);
      if(g_lakeGuessCache.has(key)) continue;
      const guess = await guessLakeNameFromLatLng(lat(t), lng(t));
      if(guess && guess.lake_name){
        g_lakeGuessCache.set(key, guess);
      }else{
        g_lakeGuessCache.set(key, null);
      }
    }
  }catch(e){
    // 湖名推定に失敗しても、閲覧機能自体は止めない。
    console.warn('lake guess failed', e);
  }
}

function displayLakeName(t){
  const lake = String(t.lake_name || t.lakeName || '').trim();
  if(lake) return lake;

  const guess = g_lakeGuessCache.get(tripLakeGuessKey(t));
  if(guess && guess.lake_name){
    return guess.lake_name;
  }

  return '湖名未登録';
}
function displayPointName(t){
  const point = String(t.point_name || t.pointName || '').trim();
  return point || 'ポイント未登録';
}
function title(t){
  const lake = displayLakeName(t);
  const point = displayPointName(t);
  if(lake !== '湖名未登録' && point !== 'ポイント未登録') return `${lake} / ${point}`;
  if(lake !== '湖名未登録') return lake;
  if(point !== 'ポイント未登録') return point;
  return '釣行地点';
}
function validLatLng(a,b){
  return Number.isFinite(a) && Number.isFinite(b) && a >= -90 && a <= 90 && b >= -180 && b <= 180;
}
function dist(lat1,lng1,lat2,lng2){
  const R = 6371008.8;
  const r = (v) => v * Math.PI / 180;
  const p1 = r(lat1), p2 = r(lat2), dp = r(lat2-lat1), dl = r(lng2-lng1);
  const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function setBadge(id, text, mode){
  const el = $(id);
  if(!el) return;
  el.textContent = text;
  el.className = (id === 'dbBadge' ? 'badge' : 'pill') + (mode ? ` ${mode}` : '');
}
function flatText(v){
  if(v == null || v === '') return '-';
  if(Array.isArray(v)) return v.join(', ');
  if(typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function openDb(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if(!d.objectStoreNames.contains(STORE_TRIPS)){
        const st = d.createObjectStore(STORE_TRIPS, {keyPath:'trip_id'});
        st.createIndex('date_ms', 'date_ms', {unique:false});
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function getAllTrips(){
  return new Promise((resolve) => {
    if(!db || !db.objectStoreNames.contains(STORE_TRIPS)){
      resolve([]);
      return;
    }
    const tx = db.transaction(STORE_TRIPS, 'readonly');
    const req = tx.objectStore(STORE_TRIPS).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

function filterTrips(){
  const q = ($('searchBox').value || '').trim().toLowerCase();
  const mode = $('sortMode').value || 'date_desc';
  let rows = allTrips.filter((t) => validLatLng(lat(t), lng(t)));

  if(q){
    rows = rows.filter((t) => {
      const s = [
        fmtDateTime(tms(t)),
        title(t),
        displayLakeName(t), displayPointName(t),
        t.lake_name, t.lakeName, t.point_name, t.pointName,
        t.line_no, t.sinker_g, t.fishfinder_depth_m,
        t.water_temp_c, t.weather, t.wind, t.memo
      ].join(' ').toLowerCase();
      return s.includes(q);
    });
  }

  rows.sort((a,b) => {
    if(mode === 'date_asc') return tms(a) - tms(b);
    if(mode === 'name') return title(a).localeCompare(title(b), 'ja');
    return tms(b) - tms(a);
  });

  return rows;
}

function renderList(){
  const rows = filterTrips();
  $('countBadge').textContent = `${rows.length}件`;
  const box = $('tripList');

  if(!allTrips.length){
    box.className = 'tripList empty';
    box.textContent = '保存済みの過去釣行データがありません。';
    return;
  }

  if(!rows.length){
    box.className = 'tripList empty';
    box.textContent = '条件に合う釣行データがありません。';
    return;
  }

  box.className = 'tripList';
  box.innerHTML = rows.map((t) => {
    const id = esc(String(t.trip_id || ''));
    const selected = String(selectedTripId || '') === String(t.trip_id || '');
    return `
      <button type="button" class="tripItem${selected ? ' selected' : ''}" data-trip-id="${id}">
        <div class="tripDate">${esc(fmtDate(tms(t)))}　${esc(displayLakeName(t))}</div>
        <div class="tripTitle">${esc(displayPointName(t))}</div>
        <div class="tripMeta">
          ライン ${esc(t.line_no || '-')} / シンカー ${esc(t.sinker_g || '-')}g /
          魚探 ${esc(t.fishfinder_depth_m || '-')}m / 水温 ${esc(t.water_temp_c || '-')}℃
        </div>
      </button>
    `;
  }).join('');
}

function findTrip(id){
  return allTrips.find((t) => String(t.trip_id || '') === String(id || '')) || null;
}
function samePointTrips(base){
  if(!base || !validLatLng(lat(base), lng(base))) return [];
  return allTrips
    .filter((t) => validLatLng(lat(t), lng(t)))
    .map((t) => ({trip:t, d:dist(lat(base), lng(base), lat(t), lng(t))}))
    .filter((x) => x.d <= SAME_POINT_M)
    .sort((a,b) => tms(b.trip) - tms(a.trip));
}
function picoSummaryHtml(t){
  const s = t.pico_summary || t.pico_log_summary || t.log_summary || {};
  const logs = t.pico_logs || t.logs || [];

  const pick = (names) => {
    for(const n of names){
      if(s && s[n] != null && s[n] !== '') return s[n];
      if(t && t[n] != null && t[n] !== '') return t[n];
    }
    return '';
  };

  const fields = [];
  const fish = pick(['fish_count','fish','fishCount','FISH']);
  const mark = pick(['mark_count','mark','markCount','MARK']);
  const logCount = pick(['log_count','logs_count','count','sample_count']);
  const seqMin = pick(['seq_min','seqStart','seq_start']);
  const seqMax = pick(['seq_max','seqEnd','seq_end']);
  const depthMin = pick(['depth_min_m','depthMinM','min_depth_m','depth_min']);
  const depthMax = pick(['depth_max_m','depthMaxM','max_depth_m','depth_max']);
  const speeds = pick(['speeds','speed_levels','speedLevel','used_speeds']);
  const sasoi = pick(['sasoi','sasoi_types','sasoiType','used_sasoi']);
  const sid = pick(['sid','session_id']);

  if(sid !== '') fields.push(['sid', sid]);
  if(fish !== '') fields.push(['FISH数', fish]);
  if(mark !== '') fields.push(['MARK数', mark]);
  if(logCount !== '') fields.push(['ログ数', logCount]);
  if(seqMin !== '' || seqMax !== '') fields.push(['seq範囲', `${flatText(seqMin)} - ${flatText(seqMax)}`]);
  if(depthMin !== '' || depthMax !== '') fields.push(['深度範囲', `${flatText(depthMin)} - ${flatText(depthMax)}`]);
  if(speeds !== '') fields.push(['使用速度', speeds]);
  if(sasoi !== '') fields.push(['使用誘い', sasoi]);
  if(Array.isArray(logs) && logs.length && logCount === '') fields.push(['ログ数', logs.length]);

  if(!fields.length){
    return `
      <div class="summaryBox">
        <h3>保存済みPico Wログ要約</h3>
        <p>この釣行回に保存済みのログ要約はありません。</p>
      </div>
    `;
  }

  return `
    <div class="summaryBox">
      <h3>保存済みPico Wログ要約</h3>
      <div class="detailGrid">
        ${fields.map(([k,v]) => `<b>${esc(k)}</b><span>${esc(flatText(v))}</span>`).join('')}
      </div>
    </div>
  `;
}
function detailHtml(t){
  const a = lat(t), b = lng(t);
  return `
    <div class="detailGrid">
      <b>日付</b><span>${esc(fmtDateTime(tms(t)))}</span>
      <b>湖名</b><span>${esc(displayLakeName(t))}</span>
      <b>ポイント名</b><span>${esc(displayPointName(t))}</span>
      <b>座標</b><span>${Number.isFinite(a) && Number.isFinite(b) ? `${a.toFixed(7)}, ${b.toFixed(7)}` : '-'}</span>
      <b>ライン</b><span>${esc(t.line_no || t.line || '-')}</span>
      <b>シンカー</b><span>${esc(t.sinker_g || t.sinker || '-')} g</span>
      <b>魚探水深</b><span>${esc(t.fishfinder_depth_m || t.fishfinder_m || '-')} m</span>
      <b>水温</b><span>${esc(t.water_temp_c || '-')} ℃</span>
      <b>天気</b><span>${esc(t.weather || '-')}</span>
      <b>風</b><span>${esc(t.wind || '-')}</span>
      <b>メモ</b><span>${esc(t.memo || '-')}</span>
    </div>
    ${picoSummaryHtml(t)}
  `;
}

function ensureMap(){
  if(map) return true;
  if(!window.L){
    setBadge('mapBadge', '地図不可', 'bad');
    return false;
  }
  map = L.map('map', {zoomControl:true}).setView(DEFAULT_CENTER, 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);
  markers = L.layerGroup().addTo(map);
  setTimeout(() => { try{ map.invalidateSize(); }catch(e){} }, 80);
  setTimeout(() => { try{ map.invalidateSize(); }catch(e){} }, 600);
  return true;
}
function drawMapForTrip(t){
  if(!validLatLng(lat(t), lng(t))) return;

  $('mapCard').classList.remove('hidden');
  ensureMap();
  if(!map || !markers) return;

  markers.clearLayers();

  const related = samePointTrips(t);
  const a = lat(t), b = lng(t);

  const icon = L.divIcon({
    className:'',
    html:`<div class="cluster selected">${related.length || 1}</div>`,
    iconSize:[38,38],
    iconAnchor:[19,19],
    popupAnchor:[0,-18]
  });

  L.marker([a,b], {icon}).addTo(markers).bindPopup(`
    <strong>${esc(title(t))}</strong><br>
    ${esc(fmtDate(tms(t)))}<br>
    この場所の過去 ${esc(related.length || 1)}回
  `);

  L.circle([a,b], {radius:SAME_POINT_M, weight:3, fillOpacity:.04}).addTo(markers);

  map.setView([a,b], 16);
  setTimeout(() => { try{ map.invalidateSize(); map.setView([a,b], 16); }catch(e){} }, 120);

  setBadge('mapBadge', `同地点 ${related.length || 1}回`, 'good');
  renderRelated(t, related);
}
function renderRelated(base, related){
  const box = $('relatedBox');
  if(!related.length){
    box.innerHTML = '<p>同じ場所の過去履歴はありません。</p>';
    return;
  }

  box.innerHTML = `
    <h3>この場所の過去釣行日</h3>
    <p class="relatedHint">見たい日付をタップすると、その釣行回の詳細を表示します。</p>
    <div class="relatedList">
      ${related.map(({trip, d}) => {
        const id = esc(String(trip.trip_id || ''));
        const selected = String(selectedTripId || '') === String(trip.trip_id || '');
        return `
          <button type="button" class="relatedItem relatedButton${selected ? ' selected' : ''}" data-trip-id="${id}">
            <strong>${esc(fmtDate(tms(trip)))}　${esc(displayLakeName(trip))}</strong>
            <span>${esc(displayPointName(trip))} / ${Math.round(d)}m以内 / ライン ${esc(trip.line_no || '-')} / シンカー ${esc(trip.sinker_g || '-')}g</span>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function selectTrip(id){
  const t = findTrip(id);
  if(!t) return;
  selectedTripId = t.trip_id;

  $('detailCard').classList.remove('hidden');
  $('detailLead').textContent = `${fmtDateTime(tms(t))}　${displayLakeName(t)} / ${displayPointName(t)}`;
  setBadge('detailBadge', '表示中', 'good');
  $('detailBox').innerHTML = detailHtml(t);

  drawMapForTrip(t);
  renderList();

  $('detailCard').scrollIntoView({behavior:'smooth', block:'start'});
}

async function reload(){
  setBadge('dbBadge', '読込中', 'warn');
  $('statusText').textContent = '保存済みデータを読み込んでいます。';

  try{
    db = await openDb();
    allTrips = (await getAllTrips()).filter((t) => validLatLng(lat(t), lng(t)));
    setBadge('dbBadge', `${allTrips.length}件`, allTrips.length ? 'good' : 'warn');
    $('statusText').textContent = allTrips.length
      ? `保存済み過去釣行 ${allTrips.length}件を読み込みました。湖名を確認しています...`
      : '保存済み過去釣行データがありません。';

    await enrichLakeGuessesForTrips(allTrips);

    $('statusText').textContent = allTrips.length
      ? `保存済み過去釣行 ${allTrips.length}件を読み込みました。`
      : '保存済み過去釣行データがありません。';

    renderList();
  }catch(e){
    setBadge('dbBadge', '読込失敗', 'bad');
    $('statusText').textContent = `IndexedDBを読み込めませんでした: ${e && e.message ? e.message : e}`;
    $('tripList').className = 'tripList empty';
    $('tripList').textContent = 'データ読込に失敗しました。';
  }
}

function showMapList(){
  const rows = filterTrips();
  const first = rows[0];
  if(!first){
    $('statusText').textContent = '表示できる釣行データがありません。';
    return;
  }
  selectTrip(first.trip_id);
  $('mapCard').scrollIntoView({behavior:'smooth', block:'start'});
}

function bindEvents(){
  $('searchBox').addEventListener('input', renderList);
  $('sortMode').addEventListener('change', renderList);
  $('btnReload').addEventListener('click', reload);
  $('btnShowMapList').addEventListener('click', showMapList);

  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-trip-id]');
    if(!btn) return;
    selectTrip(btn.getAttribute('data-trip-id'));
  });
}

function init(){
  bindEvents();
  reload();
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', init);
}else{
  init();
}
