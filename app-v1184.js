/* WAKASAGI_REAL_TARGET_FIX_20260509 */
'use strict';

const DB_NAME = 'wakasagi_trip_map_v10';
const DB_VER = 1;
const STORE_TRIPS = 'trip_records';
const STORE_META = 'meta';
const OLD_DB_NAME = 'wakasa_companion_v2';
const OLD_STORE_SPOTS = 'fishing_spots';
const SAME_POINT_M = 20;
const SAME_AREA_M = 100;
const DEFAULT_CENTER = [36.2048, 138.2529];

let db = null;
let map = null;
let groupLayer = null;
let currentPos = null;
let currentMarker = null;
let accCircle = null;
let cur20 = null;
let cur100 = null;
let sel20 = null;
let sel100 = null;
let groups = [];
let selectedGroupId = null;
let selectedTripId = null;
let editingTripId = null;
let autoLinkDone = false;

const $ = (id) => document.getElementById(id);

function nowMs(){ return Date.now(); }
function pad(n){ return String(n).padStart(2, '0'); }
function fmtTime(ms){
  const n = Number(ms || 0);
  if (!n) return '-';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toLocal(ms){
  const d = new Date(Number(ms || nowMs()));
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocal(v){
  const n = new Date(v || '').getTime();
  return Number.isFinite(n) ? n : nowMs();
}
function genId(p){ return `${p}${Date.now().toString(36)}${Math.floor(Math.random()*0xfffff).toString(16).padStart(5,'0')}`; }
function esc(v){
  return String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function validLatLng(lat, lng){ return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180; }
function dist(lat1,lng1,lat2,lng2){
  const R = 6371008.8;
  const r = (v) => v * Math.PI / 180;
  const p1 = r(lat1), p2 = r(lat2), dp = r(lat2-lat1), dl = r(lng2-lng1);
  const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function setBadge(id, text, cls=''){
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = (id === 'secureBadge' ? 'badge ' : 'pill ') + cls;
}
function title(t){ return t && (t.point_name || t.lake_name) ? (t.point_name || t.lake_name) : '釣行地点'; }
function lat(t){ return Number(t.lat); }
function lng(t){ return Number(t.lng); }
function tms(t){ return Number(t.date_ms || t.start_ms || t.created_ms || 0); }
function sub(t){ return `ライン ${esc(t.line_no || '-')} / シンカー ${esc(t.sinker_g || '-')}g / 魚探 ${esc(t.fishfinder_depth_m || t.fishfinder_m || '-')}m / 水温 ${esc(t.water_temp_c || '-')}℃`; }
function dCurrent(t){ if(!currentPos) return null; return dist(Number(currentPos.lat), Number(currentPos.lng), lat(t), lng(t)); }
function dBase(t,a,b){ if(!validLatLng(Number(a),Number(b)) || !validLatLng(lat(t),lng(t))) return null; return dist(Number(a),Number(b),lat(t),lng(t)); }

function openDb(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if(!d.objectStoreNames.contains(STORE_TRIPS)){
        const st = d.createObjectStore(STORE_TRIPS, {keyPath:'trip_id'});
        st.createIndex('date_ms', 'date_ms', {unique:false});
      }
      if(!d.objectStoreNames.contains(STORE_META)) d.createObjectStore(STORE_META, {keyPath:'key'});
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function st(name, mode='readonly'){ return db.transaction(name, mode).objectStore(name); }
function getAllTrips(){ return new Promise(res => { const r=st(STORE_TRIPS).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>res([]); }); }
function putTrip(t){ return new Promise(res => { const tx=db.transaction(STORE_TRIPS,'readwrite'); tx.objectStore(STORE_TRIPS).put(t); tx.oncomplete=()=>res(true); tx.onerror=()=>res(false); }); }
function metaGet(k){ return new Promise(res => { const r=st(STORE_META).get(k); r.onsuccess=()=>res(r.result ? r.result.value : null); r.onerror=()=>res(null); }); }
function metaSet(k,v){ return new Promise(res => { const tx=db.transaction(STORE_META,'readwrite'); tx.objectStore(STORE_META).put({key:k,value:v}); tx.oncomplete=()=>res(true); tx.onerror=()=>res(false); }); }

function normalizeOld(s){
  const a = Number(s.lat), b = Number(s.lng);
  if(!validLatLng(a,b)) return null;
  return {
    trip_id: s.trip_id || s.spot_id || genId('T'),
    migrated_from: s.spot_id || '',
    date_ms: Number(s.start_ms || s.created_ms || nowMs()),
    lat: a,
    lng: b,
    accuracy_m: Number(s.accuracy_m || 0),
    location_time_ms: Number(s.location_time_ms || s.start_ms || nowMs()),
    lake_name: s.lake_name || '',
    point_name: s.point_name || '',
    line_no: s.line_no || '',
    sinker_g: s.sinker_g || '',
    fishfinder_depth_m: s.fishfinder_depth_m || s.fishfinder_m || '',
    water_temp_c: s.water_temp_c || '',
    weather: s.weather || '',
    wind: s.wind || '',
    memo: s.memo || '',
    created_ms: Number(s.created_ms || s.start_ms || nowMs()),
    updated_ms: Number(s.updated_ms || s.start_ms || nowMs())
  };
}
function openOld(){ return new Promise(res => { const r=indexedDB.open(OLD_DB_NAME); r.onsuccess=()=>res(r.result); r.onerror=()=>res(null); r.onblocked=()=>res(null); }); }
async function migrateOld(force=false){
  if(!force && await metaGet('old_migrated')) return 0;
  const old = await openOld();
  if(!old || !old.objectStoreNames.contains(OLD_STORE_SPOTS)){ await metaSet('old_migrated', true); return 0; }
  const rows = await new Promise(res => { const r=old.transaction(OLD_STORE_SPOTS,'readonly').objectStore(OLD_STORE_SPOTS).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>res([]); });
  const cur = await getAllTrips();
  const exist = new Set(cur.map(x => String(x.migrated_from || x.trip_id)));
  let c = 0;
  for(const row of rows){
    const t = normalizeOld(row);
    if(!t) continue;
    if(!force && exist.has(String(t.migrated_from || t.trip_id))) continue;
    await putTrip(t);
    c++;
  }
  await metaSet('old_migrated', true);
  return c;
}

function ensureMap(){
  if(map) return true;
  if(!window.L){ $('mapStatus').textContent = '地図ライブラリ未読込'; return false; }
  map = L.map('map', {zoomControl:true}).setView(DEFAULT_CENTER, 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'© OpenStreetMap contributors'}).addTo(map);
  groupLayer = L.layerGroup().addTo(map);
  setTimeout(()=>{ try{ map.invalidateSize(); }catch(e){} }, 100);
  setTimeout(()=>{ try{ map.invalidateSize(); }catch(e){} }, 600);
  $('mapStatus').textContent = '地図を表示しました。';
  return true;
}
function drawCurrent(){
  if(!currentPos || !ensureMap()) return;
  const a=Number(currentPos.lat), b=Number(currentPos.lng), acc=Number(currentPos.acc||0);
  [currentMarker, accCircle, cur20, cur100].forEach(x => { if(x) x.remove(); });
  currentMarker = L.marker([a,b]).addTo(map).bindPopup('現在地');
  if(acc > 0) accCircle = L.circle([a,b], {radius:acc}).addTo(map);
  cur20 = L.circle([a,b], {radius:SAME_POINT_M, weight:2, fillOpacity:.04}).addTo(map);
  cur100 = L.circle([a,b], {radius:SAME_AREA_M, weight:2, fillOpacity:.015}).addTo(map);
  map.setView([a,b], 18);
  setTimeout(()=>{ try{ map.invalidateSize(); }catch(e){} }, 50);
  $('btnFitNear').disabled = false;
  $('btnSaveScroll').disabled = false;
  $('btnSaveTrip').disabled = false;
}
function drawSelected(a,b){
  if(!map) return;
  [sel20, sel100].forEach(x => { if(x) x.remove(); });
  sel20 = L.circle([a,b], {radius:SAME_POINT_M, weight:2, color:'#16a34a', fillOpacity:.05}).addTo(map);
  sel100 = L.circle([a,b], {radius:SAME_AREA_M, weight:2, color:'#f59e0b', fillOpacity:.02}).addTo(map);
}
function makeGroups(trips){
  const valid = trips.filter(x => validLatLng(lat(x), lng(x))).slice().sort((a,b) => tms(b)-tms(a));
  const gs = [];
  for(const t of valid){
    let best = null, bd = Infinity;
    for(const g of gs){
      const dd = dist(lat(t), lng(t), g.lat, g.lng);
      if(dd <= SAME_POINT_M && dd < bd){ best = g; bd = dd; }
    }
    if(!best){
      best = {group_id: genId('G'), lat: lat(t), lng: lng(t), trips: []};
      gs.push(best);
    }
    best.trips.push(t);
  }
  for(const g of gs){
    g.trips.sort((a,b)=>tms(b)-tms(a));
    g.latest = g.trips[0];
    g.count = g.trips.length;
    g.distance_m = currentPos ? dist(Number(currentPos.lat), Number(currentPos.lng), g.lat, g.lng) : null;
    g.latest_ms = tms(g.latest);
  }
  return gs.sort((a,b) => currentPos ? ((a.distance_m ?? Infinity) - (b.distance_m ?? Infinity)) : (b.latest_ms - a.latest_ms));
}
function markerClass(g){
  if(selectedGroupId === g.group_id) return 'cluster selected';
  if(g.distance_m !== null && g.distance_m <= SAME_POINT_M) return 'cluster near20';
  if(g.distance_m !== null && g.distance_m <= SAME_AREA_M) return 'cluster near100';
  return 'cluster';
}
function popupTripMini(t, base){
  if(!t) return '<div class="popupInlineDetail">履歴を選択してください。</div>';
  let dd = '-';
  try{
    const d = base ? dBase(t, base.lat, base.lng) : dCurrent(t);
    if(d !== null && Number.isFinite(d)) dd = Math.round(d) + 'm';
  }catch(e){}
  const s = t.pico_summary || (Array.isArray(t.pico_logs) && t.pico_logs.length ? t.pico_logs[t.pico_logs.length-1] : null);
  const log = s ? `<div class="logMini"><b>Pico Wログ</b><br>FISH ${esc(s.fish_count ?? '-')} / MARK ${esc(s.mark_count ?? '-')} / LOG ${esc(s.tlog_count ?? '-')}</div>` : '';
  return `<div class="popupInlineDetail"><div class="kvMini"><b>日付</b><span>${esc(fmtTime(tms(t)))}</span><b>距離</b><span>${esc(dd)}</span><b>ライン</b><span>${esc(t.line_no || '-')}</span><b>シンカー</b><span>${esc(t.sinker_g || '-')}g</span><b>魚探</b><span>${esc(t.fishfinder_depth_m || t.fishfinder_m || '-')}m</span><b>水温</b><span>${esc(t.water_temp_c || '-')}℃</span><b>メモ</b><span>${esc(t.memo || '-')}</span></div>${log}</div>`;
}
function popup(g){
  const trips = (g.trips || []).slice().sort((a,b) => tms(b)-tms(a));
  const dateList = trips.map(t => {
    const gid = String(g.group_id).replace(/'/g, "\\'");
    const tid = String(t.trip_id).replace(/'/g, "\\'");
    return `<button type="button" class="popupDateBtn" data-group-id="${esc(g.group_id)}" data-trip-id="${esc(t.trip_id)}" onclick="window.wakasagiPopupTrip('${gid}','${tid}')">${esc(fmtTime(tms(t)))}</button>`;
  }).join('');
  return `<div class="popupTitle">${esc(title(g.latest))}</div><div class="popupMeta">この場所の過去釣行日 ${g.count}回</div><div class="popupDates"><b>見たい釣行日を選択</b>${dateList}</div><div class="popupSelectedDetail">日付をタップすると、その釣行回の詳細を表示します。</div>`;
}

function popupDetailForTrip(g, t){
  if(!g || !t) return '<div class="popupSelectedDetail">詳細を表示できません。</div>';
  const gid = String(g.group_id).replace(/'/g, "\\'");
  return `<div class="popupTitle">${esc(title(t))}</div>
          <div class="popupMeta">選択した釣行回の詳細</div>
          ${popupTripMini(t, {lat:g.lat, lng:g.lng})}
          <button type="button" class="popupDateBtn" data-popup-back="1" data-group-id="${esc(g.group_id)}" onclick="window.wakasagiPopupBack('${gid}')">日付一覧へ戻る</button>`;
}

window.wakasagiPopupTrip = async function(groupId, tripId){
  const g = groups.find(x => String(x.group_id) === String(groupId));
  const trips = await getAllTrips();
  const t = trips.find(x => String(x.trip_id) === String(tripId));
  if(!t) return;

  selectedTripId = t.trip_id;
  if(g) selectedGroupId = g.group_id;

  try{ showTripDetail(t, g ? {lat:g.lat, lng:g.lng} : null); }catch(e){}
  try{ if(g) renderPointHistory(g, t.trip_id); }catch(e){}
  try{ if(g) drawSelected(g.lat, g.lng); }catch(e){}
  try{ enableLinkButton(); }catch(e){}
  try{ setBadge('selectedBadge','選択中','good'); }catch(e){}

  if(g && g.marker){
    g.marker.setPopupContent(popupDetailForTrip(g, t));
    g.marker.openPopup();
  }
};

window.wakasagiPopupBack = function(groupId){
  const g = groups.find(x => String(x.group_id) === String(groupId));
  if(g && g.marker){
    g.marker.setPopupContent(popup(g));
    g.marker.openPopup();
  }
};

function showGroupNoRedraw(g){
  if(!g) return;
  selectedGroupId = g.group_id;
  selectedTripId = (g.latest && g.latest.trip_id) || selectedTripId;
  renderPointHistory(g, selectedTripId);
  showTripDetail(g.latest, {lat:g.lat, lng:g.lng});
  drawSelected(g.lat, g.lng);
  setBadge('groupView', `選択 ${g.count}回`, 'good');
  enableLinkButton();
}
async function renderMap(){
  ensureMap();
  if(!groupLayer) return;
  groupLayer.clearLayers();
  const trips = await getAllTrips();
  groups = makeGroups(trips);
  for(const g of groups){
    const ic = L.divIcon({className:'', html:`<div class="${markerClass(g)}">${g.count}</div>`, iconSize:[38,38], iconAnchor:[19,19], popupAnchor:[0,-18]});
    const mk = L.marker([g.lat,g.lng], {icon:ic}).addTo(groupLayer).bindPopup(popup(g), {maxWidth:420, minWidth:280, autoPan:true, closeButton:true});
    g.marker = mk;
    mk.on('click', () => showGroupNoRedraw(g));
  }
  setBadge('allBadge', `${trips.length}件`, trips.length ? 'good' : '');
}
function updatePosition(pos){
  currentPos = {lat:Number(pos.lat), lng:Number(pos.lng), acc:Number(pos.acc||0), t:Number(pos.t||nowMs())};
  $('latView').textContent = currentPos.lat.toFixed(7);
  $('lngView').textContent = currentPos.lng.toFixed(7);
  $('accView').textContent = currentPos.acc ? `±${Math.round(currentPos.acc)}m` : '-';
  $('timeView').textContent = fmtTime(currentPos.t);
  $('locStatus').textContent = '現在地を確認しました。';
  setBadge('locBadge', '取得済み', currentPos.acc > 0 && currentPos.acc <= 20 ? 'good' : 'warn');
  metaSet('last_pos', currentPos);
  drawCurrent();
  refreshAll();
  maybeAutoLink();
}
function locate(){
  if(!window.isSecureContext){ $('locStatus').textContent='HTTPSで開いていません。GitHub Pagesのhttps URLから開いてください。'; setBadge('locBadge','HTTPS必要','bad'); return; }
  if(!('geolocation' in navigator)){ setBadge('locBadge','非対応','bad'); return; }
  $('locStatus').textContent = '現在地を取得しています...';
  setBadge('locBadge','取得中','warn');
  navigator.geolocation.getCurrentPosition(g => {
    const c = g.coords;
    updatePosition({lat:Number(c.latitude), lng:Number(c.longitude), acc:Number(c.accuracy||0), t:Number(g.timestamp||nowMs())});
  }, async e => {
    $('locStatus').textContent = '現在地エラー: ' + (e && e.message ? e.message : '取得できませんでした');
    setBadge('locBadge','未取得','bad');
    const last = await metaGet('last_pos');
    if(last && validLatLng(Number(last.lat), Number(last.lng))){ $('locStatus').textContent = '前回位置を表示しています。'; setBadge('locBadge','前回位置','warn'); updatePosition(last); }
  }, {enableHighAccuracy:true, timeout:15000, maximumAge:10000});
}
function readForm(){
  return {
    date_ms: fromLocal($('tripDate').value),
    lake_name: $('lakeName').value.trim(),
    point_name: $('pointName').value.trim(),
    line_no: $('lineNo').value.trim(),
    sinker_g: $('sinkerG').value.trim(),
    fishfinder_depth_m: $('fishfinderDepthM').value.trim(),
    water_temp_c: $('waterTempC').value.trim(),
    weather: $('weather').value.trim(),
    wind: $('wind').value.trim(),
    memo: $('memo').value.trim()
  };
}
function fillForm(t){
  $('tripDate').value = toLocal(tms(t));
  $('lakeName').value = t.lake_name || '';
  $('pointName').value = t.point_name || '';
  $('lineNo').value = t.line_no || '';
  $('sinkerG').value = t.sinker_g || '';
  $('fishfinderDepthM').value = t.fishfinder_depth_m || t.fishfinder_m || '';
  $('waterTempC').value = t.water_temp_c || '';
  $('weather').value = t.weather || '';
  $('wind').value = t.wind || '';
  $('memo').value = t.memo || '';
}
function clearForm(){
  editingTripId = null;
  $('tripDate').value = toLocal(nowMs());
  ['lakeName','pointName','lineNo','sinkerG','fishfinderDepthM','waterTempC','weather','wind','memo'].forEach(id => $(id).value = '');
  $('btnUpdateTrip').disabled = true;
  setBadge('saveBadge','待機中','');
}
async function saveTrip(){
  if(!currentPos){ alert('現在地がありません。'); return; }
  const f = readForm(), now = nowMs();
  const trips = await getAllTrips();
  const near = trips.filter(t => { const d = dBase(t, currentPos.lat, currentPos.lng); return d !== null && d <= SAME_POINT_M; });
  if(near.length > 0 && !confirm(`20m以内に過去履歴が${near.length}件あります。この場所の新しい釣行回として保存しますか？`)) return;
  const t = {trip_id:genId('T'), ...f, lat:Number(currentPos.lat), lng:Number(currentPos.lng), accuracy_m:Number(currentPos.acc||0), location_time_ms:Number(currentPos.t||now), created_ms:now, updated_ms:now};
  await putTrip(t);
  selectedTripId = t.trip_id;
  setBadge('saveBadge','保存済み','good');
  await refreshAll();
  await selectTrip(t.trip_id);
}
async function updateTrip(){
  if(!editingTripId){ alert('上書き対象がありません。'); return; }
  const trips = await getAllTrips();
  const old = trips.find(x => x.trip_id === editingTripId);
  if(!old) return;
  const t = {...old, ...readForm(), updated_ms:nowMs()};
  await putTrip(t);
  editingTripId = null;
  $('btnUpdateTrip').disabled = true;
  setBadge('saveBadge','上書き済み','good');
  await refreshAll();
  await selectTrip(t.trip_id);
}
function detailHtml(t, base=null){
  let dd = '-';
  if(base){ const d = dBase(t, base.lat, base.lng); if(d !== null) dd = Math.round(d) + 'm'; }
  else if(currentPos){ const d = dCurrent(t); if(d !== null) dd = '現在地から ' + Math.round(d) + 'm'; }
  const s = t.pico_summary || (Array.isArray(t.pico_logs) && t.pico_logs.length ? t.pico_logs[t.pico_logs.length-1] : null);
  const log = s ? `<div class="summaryBox"><h3>Pico Wログ</h3><div class="logGrid"><b>sid</b><span>${esc(s.sid || '-')}</span><b>FISH</b><span>${esc(s.fish_count ?? '-')}</span><b>MARK</b><span>${esc(s.mark_count ?? '-')}</span><b>ログ数</b><span>${esc(s.tlog_count ?? '-')}</span><b>seq</b><span>${esc(s.seq_min ?? '-')} - ${esc(s.seq_max ?? '-')}</span><b>深度範囲</b><span>${esc(s.depth_min_m ?? '-')} - ${esc(s.depth_max_m ?? '-')}m</span></div></div>` : '';
  return `<div class="summaryBox"><div class="kv"><b>日時</b><span>${esc(fmtTime(tms(t)))}</span><b>距離</b><span>${esc(dd)}</span><b>湖名</b><span>${esc(t.lake_name || '-')}</span><b>ポイント名</b><span>${esc(t.point_name || '-')}</span><b>座標</b><span>${Number(t.lat).toFixed(7)}, ${Number(t.lng).toFixed(7)}</span><b>ライン</b><span>${esc(t.line_no || '-')}</span><b>シンカー</b><span>${esc(t.sinker_g || '-')}g</span><b>魚探水深</b><span>${esc(t.fishfinder_depth_m || t.fishfinder_m || '-')}m</span><b>水温</b><span>${esc(t.water_temp_c || '-')}℃</span><b>天気</b><span>${esc(t.weather || '-')}</span><b>風</b><span>${esc(t.wind || '-')}</span><b>メモ</b><span>${esc(t.memo || '-')}</span></div></div>${log}`;
}
function itemHtml(t, label, base, sel=false){
  const d = base ? dBase(t, base.lat, base.lng) : dCurrent(t);
  const cls = d !== null && d <= SAME_POINT_M ? ' near20' : (d !== null && d <= SAME_AREA_M ? ' near100' : '');
  return `<div class="item${cls}${sel ? ' selected' : ''}"><div class="top"><span>${esc(title(t))}</span><span>${esc(label)} ${d !== null ? Math.round(d)+'m' : ''}</span></div><div class="body"><b>${esc(fmtTime(tms(t)))}</b><br>${sub(t)}<br>${esc(t.memo || '')}</div><button type="button" data-trip-id="${esc(t.trip_id)}">この釣行回を表示</button></div>`;
}
function showTripDetail(t, base=null){
  if(!t) return;
  selectedTripId = t.trip_id;
  $('selectedDetail').innerHTML = detailHtml(t, base);
  setBadge('selectedBadge','選択中','good');
  $('btnLoadSelected').disabled = false;
  enableLinkButton();
}
function renderPointHistory(g, activeTripId=null){
  if(!g){ $('sel20List').textContent='未選択'; $('sel100List').textContent='未選択'; return; }
  const base = {lat:g.lat, lng:g.lng};
  getAllTrips().then(trips => {
    const arr = trips.map(t => ({t, d:dBase(t,g.lat,g.lng)})).filter(x => x.d !== null).sort((a,b)=>a.d-b.d || tms(b.t)-tms(a.t));
    const a20 = arr.filter(x => x.d <= SAME_POINT_M);
    const a100 = arr.filter(x => x.d > SAME_POINT_M && x.d <= SAME_AREA_M);
    $('sel20Badge').textContent = `${a20.length}件`;
    $('sel100Badge').textContent = `${a100.length}件`;
    $('sel20List').innerHTML = a20.length ? a20.map(x => itemHtml(x.t, '20m内', base, x.t.trip_id===activeTripId)).join('') : 'なし';
    $('sel100List').innerHTML = a100.length ? a100.map(x => itemHtml(x.t, '100m内', base, x.t.trip_id===activeTripId)).join('') : 'なし';
  });
}
async function selectGroup(groupId){
  const g = groups.find(x => String(x.group_id) === String(groupId));
  if(!g) return;
  showGroupNoRedraw(g);
  await renderMap();
}
async function selectTrip(tripId){
  const trips = await getAllTrips();
  const t = trips.find(x => String(x.trip_id) === String(tripId));
  if(!t) return;
  selectedTripId = t.trip_id;
  showTripDetail(t);
  const g = groups.find(x => (x.trips || []).some(y => String(y.trip_id) === String(t.trip_id)));
  if(g){ selectedGroupId = g.group_id; renderPointHistory(g, t.trip_id); drawSelected(g.lat, g.lng); if(map) map.setView([g.lat,g.lng], Math.max(map.getZoom(), 16)); }
  await renderMap();
}
async function refreshCounts(){
  const trips = await getAllTrips();
  $('totalTrips').textContent = String(trips.length);
  if(!currentPos){ $('count20').textContent='-'; $('count100').textContent='-'; return; }
  const arr = trips.map(t => dCurrent(t)).filter(d => d !== null);
  $('count20').textContent = String(arr.filter(d => d <= SAME_POINT_M).length);
  $('count100').textContent = String(arr.filter(d => d <= SAME_AREA_M).length);
}
function filterTrips(trips){
  const q = ($('searchBox').value || '').trim().toLowerCase();
  let list = trips.slice();
  if(q){ list = list.filter(t => [fmtTime(tms(t)),t.lake_name,t.point_name,t.line_no,t.sinker_g,t.fishfinder_depth_m,t.water_temp_c,t.weather,t.wind,t.memo].join(' ').toLowerCase().includes(q)); }
  const m = $('sortMode').value;
  list.sort((a,b) => {
    if(m === 'date_desc') return tms(b)-tms(a);
    if(m === 'date_asc') return tms(a)-tms(b);
    if(m === 'name') return `${a.lake_name || ''} ${a.point_name || ''}`.localeCompare(`${b.lake_name || ''} ${b.point_name || ''}`, 'ja');
    if(currentPos) return (dCurrent(a) ?? Infinity) - (dCurrent(b) ?? Infinity);
    return tms(b)-tms(a);
  });
  return list;
}
async function renderAllList(){
  const trips = filterTrips(await getAllTrips());
  $('dbView').textContent = `過去釣行履歴 ${trips.length}件表示中`;
  const box = $('allHistoryList');
  box.innerHTML = trips.length ? trips.map(t => itemHtml(t, '履歴', null, t.trip_id===selectedTripId)).join('') : '<div class="emptyBox">履歴なし</div>';
}
async function updateDb(){
  const trips = await getAllTrips();
  groups = makeGroups(trips);
  $('dbView').textContent = `過去釣行履歴 ${trips.length}件 / 地図ポイント ${groups.length}件`;
  setBadge('groupView', `地図${groups.length}`, groups.length ? 'good' : '');
  await renderAllList();
}
async function refreshAll(){ await renderMap(); await refreshCounts(); await updateDb(); }
function loadToForm(id){ getAllTrips().then(trips => { const t=trips.find(x=>x.trip_id===id); if(!t)return; editingTripId=id; fillForm(t); $('btnUpdateTrip').disabled=false; $('btnLoadSelected').disabled=false; setBadge('saveBadge','編集中','warn'); $('tripDate').scrollIntoView({behavior:'smooth', block:'center'}); }); }
function fitAll(){
  if(!map) return;
  const pts = [];
  if(currentPos) pts.push([Number(currentPos.lat), Number(currentPos.lng)]);
  for(const g of groups) pts.push([g.lat, g.lng]);
  if(pts.length === 0) return;
  if(pts.length === 1) map.setView(pts[0], 18);
  else map.fitBounds(L.latLngBounds(pts), {padding:[35,35], maxZoom:18});
}
function fitNear(){
  if(!map || !currentPos) return;
  const pts = [[Number(currentPos.lat), Number(currentPos.lng)]];
  for(const g of groups){ if(g.distance_m !== null && g.distance_m <= SAME_AREA_M) pts.push([g.lat, g.lng]); }
  if(pts.length === 1) map.setView(pts[0], 18);
  else map.fitBounds(L.latLngBounds(pts), {padding:[35,35], maxZoom:18});
}
function downloadBlob(n,t,x){ const b=new Blob([x], {type:t}); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=n; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500); }
async function exportDb(){ const trips=await getAllTrips(); downloadBlob(`wakasagi_map_v10_${Date.now()}.json`, 'application/json', JSON.stringify({version:'10', exported_ms:Date.now(), trips}, null, 2)); }
async function importPayload(payload){
  const rows = Array.isArray(payload) ? payload : (payload.trips || payload.trip_records || payload.spots || []);
  if(!Array.isArray(rows)) return -1;
  let c = 0;
  for(const r of rows){
    let t = r.trip_id ? r : normalizeOld(r);
    if(!t) continue;
    t.trip_id = t.trip_id || genId('T');
    t.date_ms = Number(t.date_ms || t.start_ms || nowMs());
    t.lat = Number(t.lat); t.lng = Number(t.lng);
    if(!validLatLng(t.lat,t.lng)) continue;
    t.updated_ms = nowMs();
    await putTrip(t);
    c++;
  }
  return c;
}

function utf8ToB64(s){ return btoa(unescape(encodeURIComponent(s))); }
function b64ToUtf8(s){ return decodeURIComponent(escape(atob(s))); }
function decodeLogsyncPayload(raw){
  const txt = decodeURIComponent(String(raw || ''));
  try{ return JSON.parse(txt); }catch(e){}
  const b64 = txt.replace(/-/g,'+').replace(/_/g,'/');
  const padded = b64 + '==='.slice((b64.length + 3) % 4);
  try{ return JSON.parse(b64ToUtf8(padded)); }catch(e){}
  try{ return JSON.parse(atob(padded)); }catch(e){}
  throw new Error('logsync JSON/base64 decode failed');
}
function getPicoIp(){
  const el = $('picoIp');
  const v = (el && el.value ? el.value.trim() : '') || localStorage.getItem('pico_ip') || '192.168.4.1';
  return v.replace(/^https?:\/\//,'').replace(/\/.*$/,'');
}
function applyPicoParam(){
  try{
    const p = new URLSearchParams(location.search);
    const pico = p.get('pico');
    if(p.get('autolink') === '1' && p.get('linked') !== '1' && !(location.hash || '').includes('logsync=')){
      sessionStorage.setItem('wakasagi_autolink_once','1');
    } else {
      sessionStorage.removeItem('wakasagi_autolink_once');
    }
    if(p.get('linked') === '1') sessionStorage.setItem('wakasagi_linked_notice','1');
    if(pico){
      const host = decodeURIComponent(pico).replace(/^https?:\/\//,'').replace(/\/.*$/,'');
      if(host) localStorage.setItem('pico_ip', host);
    }
  }catch(e){}
}
function updateFixedNav(){
  const ip = getPicoIp();
  $('fixedPicoHost').textContent = 'Pico W: ' + ip;
  $('fixedPicoLog').onclick = () => { location.href = 'http://' + ip + '/log'; };
  $('fixedPicoRemote').onclick = () => { location.href = 'http://' + ip + '/remote'; };
}
async function getSelectedTripForLink(){
  const trips = await getAllTrips();
  if(selectedTripId){ const t = trips.find(x => String(x.trip_id) === String(selectedTripId)); if(t) return t; }
  if(selectedGroupId){ const g = groups.find(x => String(x.group_id) === String(selectedGroupId)); if(g && g.latest) return g.latest; }
  return null;
}

function makeSafeReturnUrl(){
  const u = new URL(location.href.split('#')[0], location.href);
  u.searchParams.delete('autolink');
  u.searchParams.set('linked','1');
  u.searchParams.set('v','1184');
  return u.toString();
}

async function makeMapLinkPayload(){
  const t = await getSelectedTripForLink();
  if(t){
    return {v:1, source:'wakasagi_map_v11', map_spot_id:String(t.trip_id||''), lat:Number(t.lat), lng:Number(t.lng), acc:Number(t.accuracy_m||0), lake_name:String(t.lake_name||''), point_name:String(t.point_name||''), place_name:String(t.point_name||t.lake_name||''), line_no:String(t.line_no||''), sinker_g:String(t.sinker_g||''), fishfinder_m:String(t.fishfinder_depth_m||t.fishfinder_m||''), water_temp_c:String(t.water_temp_c||''), note:String(t.memo||''), history_date_ms:Number(t.date_ms||t.start_ms||0), linked_ms:Date.now(), return_url:makeSafeReturnUrl()};
  }
  if(currentPos && Number.isFinite(Number(currentPos.lat)) && Number.isFinite(Number(currentPos.lng))){
    return {v:1, source:'wakasagi_map_v11', map_spot_id:'CURRENT_'+Date.now(), lat:Number(currentPos.lat), lng:Number(currentPos.lng), acc:Number(currentPos.acc||0), lake_name:'', point_name:'現在地', place_name:'現在地', line_no:'', sinker_g:'', fishfinder_m:'', water_temp_c:'', note:'地図アプリ現在地から連携', linked_ms:Date.now(), return_url:makeSafeReturnUrl()};
  }
  return null;
}
async function linkToPicoLog(){
  const ip = getPicoIp();
  localStorage.setItem('pico_ip', ip);
  updateFixedNav();
  const payload = await makeMapLinkPayload();
  if(!payload){ setBadge('linkBadge','地点なし','bad'); $('linkStatus').textContent='現在地または地図上の過去地点を選択してください。'; return; }
  const encoded = encodeURIComponent(utf8ToB64(JSON.stringify(payload)));
  setBadge('linkBadge','移動中','warn');
  $('linkStatus').textContent = 'Pico W /logへ移動して、現在sidへ地点情報を保存します。';
  location.href = 'http://' + ip + '/log#maplink=' + encoded;
}
function enableLinkButton(){
  const btn = $('btnLinkToPico');
  if(!btn) return;
  let ok = !!selectedTripId;
  ok = ok || !!(currentPos && Number.isFinite(Number(currentPos.lat)) && Number.isFinite(Number(currentPos.lng)));
  btn.disabled = !ok;
}
async function maybeAutoLink(){
  if(autoLinkDone) return;
  if(sessionStorage.getItem('wakasagi_autolink_once') !== '1') return;
  if(!currentPos) return;
  autoLinkDone = true;
  sessionStorage.removeItem('wakasagi_autolink_once');
  setBadge('autoLinkBadge','自動連携','warn');
  $('autoLinkStatus').textContent = '現在地取得後、自動でPico W /logへ連携します。';
  setTimeout(linkToPicoLog, 800);
}
async function receiveLogSync(){
  if(!location.hash || !location.hash.includes('logsync=')) return;
  try{
    const raw = location.hash.split('logsync=')[1].split('&')[0];
    const payload = decodeLogsyncPayload(raw);
    setBadge('logSyncBadge','同期中','warn');
    let trips = await getAllTrips();
    let target = null;
    if(payload.map_spot_id) target = trips.find(t => String(t.trip_id) === String(payload.map_spot_id));
    if(!target && validLatLng(Number(payload.lat), Number(payload.lng))){
      target = trips.map(t => ({t, d:dBase(t, payload.lat, payload.lng)})).filter(x => x.d !== null).sort((a,b)=>a.d-b.d)[0]?.t || null;
    }
    if(!target && validLatLng(Number(payload.lat), Number(payload.lng))){
      target = {trip_id:String(payload.map_spot_id || genId('T')), date_ms:Number(payload.start_ms || payload.linked_ms || nowMs()), lat:Number(payload.lat), lng:Number(payload.lng), accuracy_m:Number(payload.acc||0), lake_name:String(payload.lake_name||''), point_name:String(payload.place_name||payload.point_name||'Pico Wログ地点'), line_no:String(payload.line_no||''), sinker_g:String(payload.sinker_g||''), fishfinder_depth_m:String(payload.fishfinder_m||''), water_temp_c:String(payload.water_temp_c||''), memo:String(payload.note||''), created_ms:nowMs(), updated_ms:nowMs()};
    }
    if(target){
      const summary = payload.summary || payload;
      const logs = Array.isArray(target.pico_logs) ? target.pico_logs.slice() : [];
      logs.push(summary);
      target.pico_logs = logs.slice(-20);
      target.pico_summary = summary;
      target.updated_ms = nowMs();
      await putTrip(target);
      selectedTripId = target.trip_id;
      setBadge('logSyncBadge','同期済み','good');
      setBadge('linkBadge','連携済み','good');
      setBadge('autoLinkBadge','完了','good');
      $('linkStatus').textContent = 'Pico Wの現在sidへ地点情報を保存し、地図へ戻りました。';
      $('autoLinkStatus').textContent = '自動連携は完了しました。';
      $('logSyncBox').innerHTML = `<div class="logGrid"><b>sid</b><span>${esc(summary.sid||'-')}</span><b>FISH</b><span>${esc(summary.fish_count ?? '-')}</span><b>MARK</b><span>${esc(summary.mark_count ?? '-')}</span><b>ログ数</b><span>${esc(summary.tlog_count ?? '-')}</span></div>`;
      {
        const clean = new URL(location.href);
        clean.hash = '';
        clean.searchParams.delete('autolink');
        clean.searchParams.set('linked','1');
        history.replaceState(null, document.title, clean.pathname + clean.search);
      }
      await refreshAll();
      await selectTrip(target.trip_id);
    } else {
      setBadge('logSyncBadge','座標なし','warn');
      setBadge('linkBadge','未完了','warn');
      $('linkStatus').textContent = 'Pico Wから戻りましたが、保存できる地点情報がありませんでした。';
    }
  }catch(e){ setBadge('logSyncBadge','エラー','bad'); setBadge('linkBadge','エラー','bad'); $('linkStatus').textContent='logsyncを読めません: '+e.message; $('logSyncBox').textContent = 'logsyncを読めません: ' + e.message; }
}

async function init(){
  applyPicoParam();
  if(window.isSecureContext) setBadge('secureBadge','GPS可','good'); else setBadge('secureBadge','HTTPS必要','bad');
  db = await openDb();
  ensureMap();
  $('tripDate').value = toLocal(nowMs());
  const n = await migrateOld(false);
  if(n > 0) $('mapStatus').textContent = `旧データ${n}件を移行しました。`;
  $('btnLocate').onclick = locate;
  $('btnFitAll').onclick = fitAll;
  $('btnFitNear').onclick = fitNear;
  $('btnSaveScroll').onclick = () => $('tripDate').scrollIntoView({behavior:'smooth', block:'center'});
  $('btnSaveTrip').onclick = saveTrip;
  $('btnLoadSelected').onclick = () => selectedTripId && loadToForm(selectedTripId);
  $('btnUpdateTrip').onclick = updateTrip;
  $('btnClearForm').onclick = clearForm;
  $('btnExport').onclick = exportDb;
  $('btnImport').onclick = () => $('importFile').click();
  $('importFile').onchange = async e => { const f=e.target.files && e.target.files[0]; if(!f) return; let p; try{ p=JSON.parse(await f.text()); }catch(err){ alert('JSONを読めません。'); return; } const c=await importPayload(p); alert(`${c}件を読み込みました。`); await refreshAll(); };
  $('btnMigrate').onclick = async () => { const c=await migrateOld(true); alert(`旧データ移行 ${c}件`); await refreshAll(); };
  $('btnClearDb').onclick = async () => { if(confirm('テストDBを消去しますか？')){ const tx=db.transaction([STORE_TRIPS,STORE_META],'readwrite'); tx.objectStore(STORE_TRIPS).clear(); tx.objectStore(STORE_META).clear(); tx.oncomplete=()=>location.reload(); } };
  $('searchBox').oninput = renderAllList;
  $('sortMode').onchange = renderAllList;
  $('picoIp').value = localStorage.getItem('pico_ip') || '192.168.4.1';
  $('picoIp').onchange = () => { localStorage.setItem('pico_ip', getPicoIp()); updateFixedNav(); };
  $('btnLinkToPico').onclick = linkToPicoLog;
  updateFixedNav();
  if(sessionStorage.getItem('wakasagi_linked_notice') === '1'){
    setBadge('linkBadge','連携済み','good');
    setBadge('logSyncBadge','同期済み','good');
    $('linkStatus').textContent = 'Pico Wの現在sidへ地点情報を保存して戻りました。';
    $('autoLinkStatus').textContent = '自動連携は完了しました。';
  }
  document.addEventListener('click', ev => {
    const pd = ev.target.closest('.popupDateBtn[data-trip-id]');
    if(pd){
      ev.preventDefault();
      ev.stopPropagation();
      const id = pd.getAttribute('data-trip-id');
      const gid = pd.getAttribute('data-group-id') || selectedGroupId;
      if(id && window.wakasagiPopupTrip) window.wakasagiPopupTrip(gid, id);
      return;
    }
    const t = ev.target.closest('[data-trip-id]');
    if(t){ ev.preventDefault(); selectTrip(t.getAttribute('data-trip-id')); return; }
    const g = ev.target.closest('[data-group-id]');
    if(g){ ev.preventDefault(); selectGroup(g.getAttribute('data-group-id')); }
  });
  await refreshAll();
  await receiveLogSync();
  const last = await metaGet('last_pos');
  if(last && validLatLng(Number(last.lat), Number(last.lng))) updatePosition(last);
  locate();
  setInterval(enableLinkButton, 700);
}

window.addEventListener('load', () => init().catch(e => {
  console.error(e);
  if($('locStatus')) $('locStatus').textContent = '初期化エラー: ' + (e && e.message ? e.message : e);
  setBadge('locBadge','エラー','bad');
}));
