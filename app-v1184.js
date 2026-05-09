'use strict';

const DB_NAME = 'wakasagi_trip_map_v10';
const DB_VER = 1;
const STORE_TRIPS = 'trip_records';
const OLD_DB_NAME = 'wakasa_companion_v2';
const OLD_STORE_SPOTS = 'fishing_spots';
const SAME_POINT_M = 20;
const DEFAULT_CENTER = [36.2048, 138.2529];

let db = null;
let map = null;
let markerLayer = null;
let groups = [];
let selectedTrip = null;
let selectedGroup = null;
let currentPos = null;

const $ = (id) => document.getElementById(id);

function pad(n){ return String(n).padStart(2, '0'); }
function nowMs(){ return Date.now(); }
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
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function esc(v){
  return String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[m]));
}
function validLatLng(lat, lng){
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
function titleOf(t){
  return t.point_name || t.lake_name || t.place_name || '釣行ポイント';
}
function timeOf(t){
  return Number(t.date_ms || t.start_ms || t.created_ms || t.history_date_ms || 0);
}
function latOf(t){ return Number(t.lat); }
function lngOf(t){ return Number(t.lng); }
function distM(lat1,lng1,lat2,lng2){
  const R = 6371008.8;
  const r = (v)=>v*Math.PI/180;
  const p1=r(lat1), p2=r(lat2), dp=r(lat2-lat1), dl=r(lng2-lng1);
  const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function genId(prefix){
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random()*0xfffff).toString(16).padStart(5,'0')}`;
}
function setBadge(id, text, cls=''){
  const el = $(id);
  if(!el) return;
  el.textContent = text;
  el.className = 'badge ' + cls;
}

function openDb(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if(!d.objectStoreNames.contains(STORE_TRIPS)){
        const st = d.createObjectStore(STORE_TRIPS, {keyPath:'trip_id'});
        st.createIndex('date_ms','date_ms',{unique:false});
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function txStore(name, mode='readonly'){
  return db.transaction(name, mode).objectStore(name);
}
function getAllTrips(){
  return new Promise((resolve) => {
    const r = txStore(STORE_TRIPS).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => resolve([]);
  });
}
function putTrip(t){
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_TRIPS, 'readwrite');
    tx.objectStore(STORE_TRIPS).put(t);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}
function openOldDb(){
  return new Promise((resolve) => {
    const r = indexedDB.open(OLD_DB_NAME);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.onblocked = () => resolve(null);
  });
}
function readOldSpots(oldDb){
  return new Promise((resolve) => {
    if(!oldDb || !oldDb.objectStoreNames.contains(OLD_STORE_SPOTS)){
      resolve([]);
      return;
    }
    const r = oldDb.transaction(OLD_STORE_SPOTS, 'readonly').objectStore(OLD_STORE_SPOTS).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => resolve([]);
  });
}
function normalizeOldSpot(s){
  const lat = Number(s.lat), lng = Number(s.lng);
  if(!validLatLng(lat,lng)) return null;
  return {
    trip_id: s.trip_id || s.spot_id || genId('T'),
    migrated_from: s.spot_id || '',
    date_ms: Number(s.date_ms || s.start_ms || s.created_ms || nowMs()),
    lat, lng,
    accuracy_m: Number(s.accuracy_m || 0),
    lake_name: s.lake_name || '',
    point_name: s.point_name || '',
    line_no: s.line_no || '',
    sinker_g: s.sinker_g || '',
    fishfinder_depth_m: s.fishfinder_depth_m || s.fishfinder_m || '',
    water_temp_c: s.water_temp_c || '',
    weather: s.weather || '',
    wind: s.wind || '',
    memo: s.memo || '',
    pico_summary: s.pico_summary || null,
    created_ms: Number(s.created_ms || s.start_ms || nowMs()),
    updated_ms: Number(s.updated_ms || s.start_ms || nowMs())
  };
}
async function migrateOldDbOnce(){
  try{
    if(localStorage.getItem('wakasagi_old_migrated_v1184_popup_detail') === '1') return;
    const old = await openOldDb();
    const rows = await readOldSpots(old);
    if(!rows.length){
      localStorage.setItem('wakasagi_old_migrated_v1184_popup_detail','1');
      return;
    }
    const existing = await getAllTrips();
    const keys = new Set(existing.map(t => String(t.migrated_from || t.trip_id)));
    let count = 0;
    for(const row of rows){
      const t = normalizeOldSpot(row);
      if(!t) continue;
      const key = String(t.migrated_from || t.trip_id);
      if(keys.has(key)) continue;
      await putTrip(t);
      keys.add(key);
      count++;
    }
    localStorage.setItem('wakasagi_old_migrated_v1184_popup_detail','1');
    if(count > 0) console.log('migrated old spots:', count);
  }catch(e){
    console.warn('old migration skipped', e);
  }
}

function ensureMap(){
  if(map) return true;
  if(!window.L){
    setBadge('secureBadge', 'Leaflet未読込', 'bad');
    return false;
  }
  map = L.map('map', {zoomControl:true}).setView(DEFAULT_CENTER, 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  setTimeout(()=>map.invalidateSize(), 150);
  setTimeout(()=>map.invalidateSize(), 700);
  return true;
}

function makeGroups(trips){
  const valid = trips
    .filter(t => validLatLng(latOf(t), lngOf(t)))
    .sort((a,b) => timeOf(b) - timeOf(a));

  const result = [];
  for(const t of valid){
    let found = null;
    let bestD = Infinity;
    for(const g of result){
      const d = distM(latOf(t), lngOf(t), g.lat, g.lng);
      if(d <= SAME_POINT_M && d < bestD){
        found = g;
        bestD = d;
      }
    }
    if(found){
      found.trips.push(t);
      const n = found.trips.length;
      found.lat = (found.lat * (n-1) + latOf(t)) / n;
      found.lng = (found.lng * (n-1) + lngOf(t)) / n;
    }else{
      result.push({
        group_id: genId('G'),
        lat: latOf(t),
        lng: lngOf(t),
        trips: [t]
      });
    }
  }

  for(const g of result){
    g.trips.sort((a,b) => timeOf(b) - timeOf(a));
    g.latest = g.trips[0];
    g.count = g.trips.length;
  }
  return result.sort((a,b) => timeOf(b.latest) - timeOf(a.latest));
}

function renderDatePopup(g){
  const dateButtons = g.trips.map(t => {
    return `<button class="popupDateBtn" onclick="window.wakaShowTripDetail('${esc(g.group_id)}','${esc(t.trip_id)}')">${esc(fmtDate(timeOf(t)))}</button>`;
  }).join('');

  return `
    <div class="popupTitle">${esc(titleOf(g.latest))}</div>
    <div class="popupHelp">この場所の過去釣行日だけ表示しています。見たい日付を押すと詳細を表示します。</div>
    <div class="popupHelp"><span class="importantNum">${g.count}</span> 回</div>
    ${dateButtons || '<div class="popupHelp">履歴がありません。</div>'}
  `;
}

function detailRows(t){
  const fish = t.pico_summary && (t.pico_summary.fish_count != null) ? t.pico_summary.fish_count : (t.fish_count ?? '');
  const mark = t.pico_summary && (t.pico_summary.mark_count != null) ? t.pico_summary.mark_count : (t.mark_count ?? '');
  const logCount = t.pico_summary && (t.pico_summary.tlog_count != null) ? t.pico_summary.tlog_count : (t.tlog_count ?? '');

  return `
    <div class="detailGrid">
      <div class="k">日付</div><div class="v importantNum">${esc(fmtDate(timeOf(t)))}</div>
      <div class="k">時刻</div><div class="v">${esc(fmtDateTime(timeOf(t)))}</div>
      <div class="k">湖名</div><div class="v">${esc(t.lake_name || '-')}</div>
      <div class="k">ポイント</div><div class="v">${esc(t.point_name || t.place_name || '-')}</div>
      <div class="k">ライン</div><div class="v">${esc(t.line_no || '-')}</div>
      <div class="k">シンカー</div><div class="v">${esc(t.sinker_g || '-')} g</div>
      <div class="k">魚探水深</div><div class="v">${esc(t.fishfinder_depth_m || t.fishfinder_m || '-')} m</div>
      <div class="k">水温</div><div class="v">${esc(t.water_temp_c || '-')} ℃</div>
      <div class="k">天気</div><div class="v">${esc(t.weather || '-')}</div>
      <div class="k">風</div><div class="v">${esc(t.wind || '-')}</div>
      <div class="k">FISH</div><div class="v">${esc(fish || '-')}</div>
      <div class="k">MARK</div><div class="v">${esc(mark || '-')}</div>
      <div class="k">LOG</div><div class="v">${esc(logCount || '-')}</div>
      <div class="k">メモ</div><div class="v">${esc(t.memo || '-')}</div>
    </div>
  `;
}

function renderDetailPopup(g, t){
  return `
    <div class="popupTitle">${esc(titleOf(t))}</div>
    ${detailRows(t)}
    <button class="popupBackBtn" onclick="window.wakaShowDateList('${esc(g.group_id)}')">日付一覧へ戻る</button>
  `;
}

function showDetailPanel(t){
  selectedTrip = t;
  $('selectedDetail').className = 'detailBox';
  $('selectedDetail').innerHTML = `<h3>${esc(titleOf(t))}</h3>${detailRows(t)}`;
  $('btnLinkSelected').disabled = false;
}

window.wakaShowDateList = function(groupId){
  const g = groups.find(x => x.group_id === groupId);
  if(!g || !g.marker) return;
  g.marker.setPopupContent(renderDatePopup(g));
  g.marker.openPopup();
};

window.wakaShowTripDetail = function(groupId, tripId){
  const g = groups.find(x => x.group_id === groupId);
  if(!g || !g.marker) return;
  const t = g.trips.find(x => String(x.trip_id) === String(tripId));
  if(!t) return;
  selectedGroup = g;
  showDetailPanel(t);
  g.marker.setPopupContent(renderDetailPopup(g, t));
  g.marker.openPopup();
};

async function renderMap(){
  ensureMap();
  markerLayer.clearLayers();

  const trips = await getAllTrips();
  groups = makeGroups(trips);
  $('countBadge').textContent = `履歴 ${trips.length}件`;

  const bounds = [];
  for(const g of groups){
    const icon = L.divIcon({
      className: '',
      html: `<div class="clusterPin">${g.count}</div>`,
      iconSize: [44,44],
      iconAnchor: [22,22],
      popupAnchor: [0,-20]
    });

    const marker = L.marker([g.lat, g.lng], {icon}).addTo(markerLayer);
    g.marker = marker;
    marker.bindPopup(renderDatePopup(g), {
      minWidth: 280,
      maxWidth: 440,
      closeButton: true,
      autoPan: true
    });
    marker.on('click', () => {
      selectedGroup = g;
      marker.setPopupContent(renderDatePopup(g));
    });
    bounds.push([g.lat, g.lng]);
  }

  renderHistoryList();

  if(bounds.length){
    map.fitBounds(bounds, {padding:[30,30], maxZoom: 15});
  }
}

function renderHistoryList(){
  const items = [];
  for(const g of groups){
    for(const t of g.trips){
      items.push({g,t});
    }
  }
  items.sort((a,b)=>timeOf(b.t)-timeOf(a.t));

  if(!items.length){
    $('historyList').innerHTML = '履歴がありません。Pico Wの/logからmaplink連携した履歴、または旧DB履歴があればここに表示されます。';
    return;
  }

  $('historyList').innerHTML = items.map(({g,t}) => `
    <button class="historyItem" onclick="window.wakaSelectFromList('${esc(g.group_id)}','${esc(t.trip_id)}')">
      <div class="title">${esc(fmtDate(timeOf(t)))}　${esc(titleOf(t))}</div>
      <div class="sub">ライン ${esc(t.line_no || '-')} / シンカー ${esc(t.sinker_g || '-')}g / 魚探 ${esc(t.fishfinder_depth_m || t.fishfinder_m || '-')}m</div>
    </button>
  `).join('');
}

window.wakaSelectFromList = function(groupId, tripId){
  const g = groups.find(x => x.group_id === groupId);
  if(!g || !g.marker) return;
  const t = g.trips.find(x => String(x.trip_id) === String(tripId));
  if(!t) return;
  selectedGroup = g;
  showDetailPanel(t);
  map.setView([latOf(t), lngOf(t)], 17);
  g.marker.setPopupContent(renderDetailPopup(g,t));
  g.marker.openPopup();
};

function locate(){
  if(!navigator.geolocation){
    alert('この端末は現在地取得に対応していません。');
    return;
  }
  navigator.geolocation.getCurrentPosition((pos)=>{
    const c = pos.coords;
    currentPos = {
      lat: Number(c.latitude),
      lng: Number(c.longitude),
      acc: Number(c.accuracy || 0),
      t: Number(pos.timestamp || nowMs())
    };
    L.marker([currentPos.lat,currentPos.lng]).addTo(map).bindPopup('現在地').openPopup();
    map.setView([currentPos.lat,currentPos.lng], 17);
  }, (err)=>{
    alert('現在地を取得できません: ' + (err && err.message ? err.message : '不明'));
  }, {enableHighAccuracy:true, timeout:15000, maximumAge:10000});
}

function fitAll(){
  const pts = groups.map(g => [g.lat, g.lng]);
  if(!pts.length) return;
  map.fitBounds(pts, {padding:[30,30], maxZoom:15});
}

function getPicoBase(){
  const input = $('picoIpInput').value.trim();
  if(!input) return '';
  if(input.startsWith('http://') || input.startsWith('https://')) return input.replace(/\/+$/,'');
  return 'http://' + input.replace(/\/+$/,'');
}

function safeReturnUrl(){
  const u = new URL(location.href.split('#')[0], location.href);
  u.searchParams.delete('autolink');
  u.searchParams.set('linked', '1');
  return u.toString();
}

function base64Utf8(s){
  return btoa(unescape(encodeURIComponent(s)));
}

function buildMapLinkPayload(t){
  return {
    v: 1,
    source: 'wakasagi_map_v1184',
    map_spot_id: String(t.trip_id || ''),
    lat: Number(t.lat),
    lng: Number(t.lng),
    acc: Number(t.accuracy_m || 0),
    lake_name: String(t.lake_name || ''),
    point_name: String(t.point_name || ''),
    place_name: String(t.point_name || t.lake_name || ''),
    line_no: String(t.line_no || ''),
    sinker_g: String(t.sinker_g || ''),
    fishfinder_m: String(t.fishfinder_depth_m || t.fishfinder_m || ''),
    water_temp_c: String(t.water_temp_c || ''),
    note: String(t.memo || ''),
    history_date_ms: Number(timeOf(t) || 0),
    linked_ms: nowMs(),
    return_url: safeReturnUrl()
  };
}

function linkSelectedToPico(){
  if(!selectedTrip){
    alert('先に日付を選択してください。');
    return;
  }
  const base = getPicoBase();
  if(!base){
    alert('Pico W IPを入力してください。');
    return;
  }
  const payload = buildMapLinkPayload(selectedTrip);
  const encoded = base64Utf8(JSON.stringify(payload));
  $('linkStatus').textContent = 'Pico W /log へ送ります...';
  location.href = `${base}/log#maplink=${encodeURIComponent(encoded)}`;
}

function setupPicoFromUrl(){
  const u = new URL(location.href);
  const pico = u.searchParams.get('pico') || '';
  if(pico){
    $('picoIpInput').value = pico;
    setBadge('picoBadge', 'Pico W: ' + pico, 'good');
  }else{
    setBadge('picoBadge', 'Pico W: 未設定', 'warn');
  }

  // autolink=1 は無限往復防止のため無視する。
  // 地図表示を最優先し、連携は日付選択後の手動ボタンのみ。
}

function setupButtons(){
  $('btnLocate').addEventListener('click', locate);
  $('btnFitAll').addEventListener('click', fitAll);
  $('btnLinkSelected').addEventListener('click', linkSelectedToPico);

  $('btnBackLog').addEventListener('click', ()=>{
    const base = getPicoBase();
    if(base) location.href = `${base}/log`;
  });
  $('btnBackRemote').addEventListener('click', ()=>{
    const base = getPicoBase();
    if(base) location.href = `${base}/remote`;
  });

  $('picoIpInput').addEventListener('input', ()=>{
    const v = $('picoIpInput').value.trim();
    setBadge('picoBadge', v ? ('Pico W: ' + v) : 'Pico W: 未設定', v ? 'good' : 'warn');
  });
}

function setupSecureBadge(){
  if(location.protocol === 'https:'){
    setBadge('secureBadge', 'HTTPS', 'good');
  }else{
    setBadge('secureBadge', 'HTTPS推奨', 'warn');
  }
}

async function main(){
  setupSecureBadge();
  setupPicoFromUrl();
  setupButtons();
  ensureMap();
  db = await openDb();
  await migrateOldDbOnce();
  await renderMap();
}

window.addEventListener('load', () => {
  main().catch((e) => {
    console.error(e);
    alert('地図初期化エラー: ' + (e && e.message ? e.message : e));
  });
});
