'use strict';

const VIEWER_VERSION = 'viewer_full_20260614d';
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

const $ = (id) => document.getElementById(id);

function esc(v){
  return String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function pad(n){ return String(n).padStart(2, '0'); }
function toNum(v){ const n = Number(v); return Number.isFinite(n) ? n : NaN; }
function validMs(v){ const n = Number(v || 0); return Number.isFinite(n) && n > 0 ? n : 0; }
function fmtDate(ms){
  const n = validMs(ms);
  if(!n) return '-';
  const d = new Date(n);
  if(Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())}`;
}
function fmtTime(ms){
  const n = validMs(ms);
  if(!n) return '-';
  const d = new Date(n);
  if(Number.isNaN(d.getTime())) return '-';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function fmtDateTime(ms){
  const n = validMs(ms);
  if(!n) return '-';
  const d = new Date(n);
  if(Number.isNaN(d.getTime())) return '-';
  return `${fmtDate(n)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function fmtDuration(start, end){
  const a = validMs(start), b = validMs(end);
  if(!a || !b || b < a) return '-';
  const sec = Math.round((b - a) / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if(h) return `${h}時間${m}分${s}秒`;
  if(m) return `${m}分${s}秒`;
  return `${s}秒`;
}
function flatText(v){
  if(v == null || v === '') return '-';
  if(Array.isArray(v)) return v.join(', ');
  if(typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function clean(v){ return String(v == null ? '' : v).trim(); }
function arr(v){ return Array.isArray(v) ? v : []; }
function firstValue(obj, names){
  for(const n of names){
    if(obj && obj[n] != null && obj[n] !== '') return obj[n];
  }
  return '';
}
function nestedSources(t){
  return [
    t || {},
    (t && t.pico_summary) || {},
    (t && t.pico_payload) || {},
    (t && Array.isArray(t.pico_logs) && t.pico_logs.length ? t.pico_logs[t.pico_logs.length - 1] : {}) || {}
  ];
}
function pick(t, names){
  for(const src of nestedSources(t)){
    const v = firstValue(src, names);
    if(v !== '') return v;
  }
  return '';
}
function pickMs(t, names){
  for(const src of nestedSources(t)){
    for(const n of names){
      const v = validMs(src && src[n]);
      if(v) return v;
    }
  }
  return 0;
}
function lat(t){ return toNum(pick(t, ['lat','gps_lat','latest_lat'])); }
function lng(t){ return toNum(pick(t, ['lng','gps_lng','latest_lng'])); }
function validLatLng(a,b){ return Number.isFinite(a) && Number.isFinite(b) && a >= -90 && a <= 90 && b >= -180 && b <= 180 && !(a === 0 && b === 0); }
function tripStartMs(t){ return pickMs(t, ['trip_start_ms','date_ms','start_ms','created_ms','location_time_ms','first_recv_ms','visit_start_ms','point_start_ms']); }
function tripEndMs(t){ return pickMs(t, ['trip_end_ms','last_recv_ms','updated_ms','end_ms','visit_end_ms','point_end_ms']); }
function pointStartMs(t){ return pickMs(t, ['point_start_ms','visit_start_ms','first_recv_ms','start_ms','date_ms','location_time_ms']); }
function pointEndMs(t){ return pickMs(t, ['point_end_ms','last_recv_ms','visit_end_ms','updated_ms','trip_end_ms','end_ms']); }
function tms(t){ return pointStartMs(t) || tripStartMs(t) || validMs(t && t.date_ms) || 0; }
function displayLakeName(t){ return clean(pick(t, ['lake_name','lakeName','place_name'])) || '湖名未登録'; }
function displayPointName(t){ return clean(pick(t, ['point_name','pointName','visit_label'])) || 'ポイント未登録'; }
function title(t){
  const lake = displayLakeName(t);
  const point = displayPointName(t);
  if(lake !== '湖名未登録' && point !== 'ポイント未登録') return `${lake} / ${point}`;
  if(lake !== '湖名未登録') return lake;
  if(point !== 'ポイント未登録') return point;
  return '釣行地点';
}
function distanceMetersLatLng(lat1,lng1,lat2,lng2){
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
function safeJson(v){
  try{ return JSON.stringify(v, null, 2); }catch(e){ return String(v); }
}
function row(k, v){ return `<tr><th>${esc(k)}</th><td>${esc(flatText(v))}</td></tr>`; }
function section(titleText, rowsHtml){
  return `<h3>${esc(titleText)}</h3><table class="viewerDataTable"><tbody>${rowsHtml}</tbody></table>`;
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
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}
function getAllTrips(){
  return new Promise((resolve) => {
    if(!db || !db.objectStoreNames.contains(STORE_TRIPS)){ resolve([]); return; }
    const tx = db.transaction(STORE_TRIPS, 'readonly');
    const req = tx.objectStore(STORE_TRIPS).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}
function filterTrips(){
  const q = (($('searchBox') && $('searchBox').value) || '').trim().toLowerCase();
  const mode = (($('sortMode') && $('sortMode').value) || 'date_desc');
  let rows = allTrips.filter((t) => validLatLng(lat(t), lng(t)));
  if(q){
    rows = rows.filter((t) => {
      const s = [
        fmtDateTime(pointStartMs(t)), fmtDateTime(pointEndMs(t)), title(t), displayLakeName(t), displayPointName(t),
        pick(t, ['line_no','line']), pick(t, ['sinker_g','sinker']), pick(t, ['fishfinder_depth_m','water_depth_m','fishfinder_m']),
        pick(t, ['weather_text','weather']), pick(t, ['wind']), pick(t, ['memo','note']),
        pick(t, ['gps_visit_id','visit_id']), pick(t, ['sid','pico_sid']), safeJson(t)
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
    return `<button class="tripItem${selected ? ' selected' : ''}" type="button" data-trip-id="${id}">
      <strong>${esc(fmtDate(pointStartMs(t)))} ${esc(displayLakeName(t))}</strong>
      <span>${esc(displayPointName(t))}</span>
      <small>開始 ${esc(fmtDateTime(pointStartMs(t)))} / 終了 ${esc(fmtDateTime(pointEndMs(t)))} / ライン ${esc(pick(t,['line_no','line']) || '-')} / シンカー ${esc(pick(t,['sinker_g','sinker']) || '-')}g / 魚探 ${esc(pick(t,['fishfinder_depth_m','water_depth_m','fishfinder_m']) || '-')}m</small>
    </button>`;
  }).join('');
}
function findTrip(id){ return allTrips.find((t) => String(t.trip_id || '') === String(id || '')) || null; }
function samePointTrips(base){
  if(!base || !validLatLng(lat(base), lng(base))) return [];
  return allTrips
    .filter((t) => validLatLng(lat(t), lng(t)))
    .map((t) => ({trip:t, d:distanceMetersLatLng(lat(base), lng(base), lat(t), lng(t))}))
    .filter((x) => x.d <= SAME_POINT_M)
    .sort((a,b) => tms(b.trip) - tms(a.trip));
}
function summaryBlock(t){
  const start = pointStartMs(t);
  const end = pointEndMs(t);
  return section('実釣ポイント時間',
    row('ポイント開始時間', fmtDateTime(start)) +
    row('ポイント終了時間', fmtDateTime(end)) +
    row('ポイント実釣時間', fmtDuration(start, end)) +
    row('終了時間の根拠', 'point_end_ms → last_recv_ms → visit_end_ms → updated_ms の順で採用')
  );
}
function basicBlock(t){
  const a = lat(t), b = lng(t);
  return section('基本情報',
    row('湖名', displayLakeName(t)) +
    row('ポイント名', displayPointName(t)) +
    row('座標', validLatLng(a,b) ? `${a.toFixed(7)}, ${b.toFixed(7)}` : '-') +
    row('GPS精度', pick(t, ['accuracy_m','gps_acc_m','acc_m','acc'])) +
    row('GPS品質', pick(t, ['gps_quality_label','gps_quality'])) +
    row('候補番号', pick(t, ['candidate_no','visit_no'])) +
    row('visit ID', pick(t, ['gps_visit_id','visit_id'])) +
    row('sid', pick(t, ['pico_sid','sid','session_id']))
  );
}
function gearBlock(t){
  return section('釣行条件',
    row('ライン', pick(t, ['line_no','line'])) +
    row('シンカー(g)', pick(t, ['sinker_g','sinker'])) +
    row('魚探水深(m)', pick(t, ['fishfinder_depth_m','water_depth_m','fishfinder_m','max_depth_m'])) +
    row('水温(℃)', pick(t, ['water_temp_c'])) +
    row('天気', pick(t, ['weather_text','weather'])) +
    row('風向', pick(t, ['wind_dir'])) +
    row('風速(m/s)', pick(t, ['wind_speed_mps'])) +
    row('風', pick(t, ['wind'])) +
    row('気圧(hPa)', pick(t, ['pressure_hpa','pressure','air_pressure_hpa'])) +
    row('メモ', pick(t, ['memo','note']))
  );
}
function picoBlock(t){
  return section('Pico Wログ要約',
    row('FISH数', pick(t, ['fish_count','fish','fishCount','FISH'])) +
    row('MARK数', pick(t, ['mark_count','mark','markCount','MARK'])) +
    row('ログ数', pick(t, ['tlog_count','log_count','logs_count','count','sample_count'])) +
    row('活動ログ行数', pick(t, ['tlog_activity_row_count'])) +
    row('seq範囲', `${flatText(pick(t, ['first_seq','seq_min','seq_start']))} - ${flatText(pick(t, ['last_seq','seq_max','seq_end']))}`) +
    row('受信時刻範囲', `${fmtDateTime(pickMs(t, ['first_recv_ms']))} - ${fmtDateTime(pickMs(t, ['last_recv_ms']))}`) +
    row('本体t_ms範囲', `${flatText(pick(t, ['first_t_ms']))} - ${flatText(pick(t, ['last_t_ms']))}`) +
    row('深度範囲(m)', `${flatText(pick(t, ['min_depth_m','depth_min_m']))} - ${flatText(pick(t, ['max_depth_m','depth_max_m']))}`) +
    row('深度変化(mm)', pick(t, ['depth_range_mm'])) +
    row('使用誘い', pick(t, ['used_sasoi','sasoi','sasoi_types'])) +
    row('使用速度', pick(t, ['used_speed','speeds','speed_levels']))
  );
}
function savedBlock(t){
  return section('保存・連携情報',
    row('保存元', pick(t, ['saved_by'])) +
    row('作成時刻', fmtDateTime(pickMs(t, ['created_ms']))) +
    row('更新時刻', fmtDateTime(pickMs(t, ['updated_ms']))) +
    row('payload保存時刻', fmtDateTime(pickMs(t, ['pico_payload_saved_ms']))) +
    row('GPS候補数', pick(t, ['gps_candidate_count'])) +
    row('GPS visit候補数', pick(t, ['gps_visit_candidate_count'])) +
    row('候補窓開始', fmtDateTime(pickMs(t, ['candidate_window_start_ms']))) +
    row('候補窓終了', fmtDateTime(pickMs(t, ['candidate_window_end_ms']))) +
    row('map_spot_id', pick(t, ['map_spot_id'])) +
    row('map_source', pick(t, ['map_source']))
  );
}
function activityRowsBlock(t){
  const rows = arr(pick(t, ['tlog_activity_rows']));
  const rawRows = Array.isArray(t.tlog_activity_rows) ? t.tlog_activity_rows : (t.pico_summary && Array.isArray(t.pico_summary.tlog_activity_rows) ? t.pico_summary.tlog_activity_rows : []);
  const useRows = rawRows.slice(-80);
  if(!useRows.length) return '<h3>実釣activity行</h3><p>保存済みactivity行はありません。</p>';
  return `<h3>実釣activity行</h3><p>最後の${useRows.length}行を表示します。</p><div class="viewerScroll"><table class="viewerDataTable"><thead><tr><th>seq</th><th>recv</th><th>depth_mm</th><th>motor</th><th>pulse</th><th>event</th><th>speed</th><th>sasoi</th></tr></thead><tbody>${useRows.map(r => `<tr><td>${esc(r.q ?? r.seq ?? '')}</td><td>${esc(fmtDateTime(r.r || r.recv_ms || ''))}</td><td>${esc(r.d ?? r.depth_mm ?? '')}</td><td>${esc(r.m ?? r.motorRun ?? '')}</td><td>${esc(r.p ?? r.pulse ?? '')}</td><td>${esc(r.e ?? r.event ?? '')}</td><td>${esc(r.sp ?? r.speedLevel ?? '')}</td><td>${esc(r.sa ?? r.sasoiType ?? '')}</td></tr>`).join('')}</tbody></table></div>`;
}
function rawBlock(t){
  return `<details class="viewerRaw"><summary>保存済み全データ(JSON)</summary><pre>${esc(safeJson(t))}</pre></details>`;
}
function detailHtml(t){
  return [summaryBlock(t), basicBlock(t), gearBlock(t), picoBlock(t), savedBlock(t), activityRowsBlock(t), rawBlock(t)].join('');
}
function ensureMap(){
  if(map) return true;
  if(!window.L){ setBadge('mapBadge', '地図不可', 'bad'); return false; }
  map = L.map('map', {zoomControl:true}).setView(DEFAULT_CENTER, 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'© OpenStreetMap contributors'}).addTo(map);
  markers = L.layerGroup().addTo(map);
  setTimeout(() => { try{ map.invalidateSize(); }catch(e){} }, 80);
  setTimeout(() => { try{ map.invalidateSize(); }catch(e){} }, 600);
  return true;
}
function drawMapForTrip(t){
  const a = lat(t), b = lng(t);
  if(!validLatLng(a,b)) return;
  $('mapCard').classList.remove('hidden');
  ensureMap();
  if(!map || !markers) return;
  markers.clearLayers();
  const related = samePointTrips(t);
  const icon = L.divIcon({className:'', html:`<div class="pinBubble">${related.length || 1}</div>`, iconSize:[38,38], iconAnchor:[19,19], popupAnchor:[0,-18]});
  L.marker([a,b], {icon}).addTo(markers).bindPopup(`<strong>${esc(title(t))}</strong><br>${esc(fmtDate(pointStartMs(t)))}<br>開始 ${esc(fmtTime(pointStartMs(t)))} / 終了 ${esc(fmtTime(pointEndMs(t)))}`);
  L.circle([a,b], {radius:SAME_POINT_M, weight:3, fillOpacity:.04}).addTo(markers);
  map.setView([a,b], 16);
  setTimeout(() => { try{ map.invalidateSize(); map.setView([a,b], 16); }catch(e){} }, 120);
  setBadge('mapBadge', `同地点 ${related.length || 1}回`, 'good');
  renderRelated(related);
}
function renderRelated(related){
  const box = $('relatedBox');
  if(!related.length){ box.innerHTML = '<p>同じ場所の過去履歴はありません。</p>'; return; }
  box.innerHTML = `<h3>この場所の過去釣行日</h3><p>見たい日付をタップすると、その釣行回の詳細を表示します。</p>${related.map(({trip, d}) => `<button class="tripItem" type="button" data-trip-id="${esc(String(trip.trip_id || ''))}"><strong>${esc(fmtDate(pointStartMs(trip)))} ${esc(displayLakeName(trip))}</strong><span>${esc(displayPointName(trip))}</span><small>開始 ${esc(fmtTime(pointStartMs(trip)))} / 終了 ${esc(fmtTime(pointEndMs(trip)))} / ${Math.round(d)}m以内</small></button>`).join('')}`;
}
function selectTrip(id){
  const t = findTrip(id);
  if(!t) return;
  selectedTripId = t.trip_id;
  $('detailCard').classList.remove('hidden');
  $('detailLead').textContent = `${fmtDateTime(pointStartMs(t))} - ${fmtDateTime(pointEndMs(t))} ${displayLakeName(t)} / ${displayPointName(t)}`;
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
    $('statusText').textContent = allTrips.length ? `保存済み過去釣行 ${allTrips.length}件を読み込みました。` : '保存済み過去釣行データがありません。';
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
  if(!first){ $('statusText').textContent = '表示できる釣行データがありません。'; return; }
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
function injectViewerCss(){
  const css = `
.viewerDataTable{width:100%;border-collapse:collapse;margin:8px 0 16px;background:#fff;border:1px solid #d6dee9;border-radius:12px;overflow:hidden}
.viewerDataTable th,.viewerDataTable td{border:1px solid #d6dee9;padding:8px;vertical-align:top;text-align:left;word-break:break-word}
.viewerDataTable th{width:36%;background:#eef4fb;color:#0f172a}
.viewerRaw{margin-top:16px;background:#0f172a;color:#e5edf7;border-radius:12px;padding:12px}
.viewerRaw summary{font-weight:900;cursor:pointer}
.viewerRaw pre{white-space:pre-wrap;word-break:break-word;max-height:55vh;overflow:auto}
.viewerScroll{max-height:50vh;overflow:auto;border:1px solid #d6dee9;border-radius:12px}
`;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
}
function init(){
  injectViewerCss();
  bindEvents();
  reload();
  console.log(VIEWER_VERSION);
}
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', init);
}else{
  init();
}
