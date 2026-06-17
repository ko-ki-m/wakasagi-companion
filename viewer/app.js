'use strict';

const VIEWER_VERSION = 'viewer_import_20260617f';
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

function importSetStatus(text, mode){
  const el = $('importStatus');
  if(el) el.textContent = text;
  setBadge('importBadge', text, mode || '');
}
function importS(v){ return String(v == null ? '' : v).trim(); }
function importN(v){ const x = Number(v); return Number.isFinite(x) ? x : null; }
function importFirstNum(){ for(const v of arguments){ const x = importN(v); if(x !== null && x > 0) return x; } return null; }
function importAnyNum(){ for(const v of arguments){ const x = importN(v); if(x !== null) return x; } return null; }
function importClone(v){ try{ return JSON.parse(JSON.stringify(v == null ? null : v)); }catch(e){ return v; } }
function importGenId(prefix){ return String(prefix || 'T') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,10); }
function importDecodeB64Json(b64){
  const raw = importS(b64);
  if(!raw) return null;
  let bin = '';
  try{ bin = atob(raw); }catch(e){ return null; }
  try{
    if(window.TextDecoder){
      const bytes = new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
      return JSON.parse(new TextDecoder('utf-8').decode(bytes));
    }
  }catch(e){}
  try{ return JSON.parse(decodeURIComponent(escape(bin))); }catch(e){}
  try{ return JSON.parse(bin); }catch(e){}
  return null;
}
function importPayloadFromText(text){
  const raw = importS(text);
  if(!raw) throw new Error('貼り付けデータが空です');
  let target = raw;
  try{
    const u = new URL(raw);
    const h = String(u.hash || '').replace(/^#/, '');
    const hp = new URLSearchParams(h);
    const q = u.searchParams;
    target = hp.get('payload') || hp.get('logsync') || q.get('payload') || q.get('logsync') || raw;
  }catch(e){
    if(raw.startsWith('#')){
      const hp = new URLSearchParams(raw.replace(/^#/, ''));
      target = hp.get('payload') || hp.get('logsync') || raw;
    }
  }
  target = importS(target);
  try{ return JSON.parse(target); }catch(e){}
  try{ return JSON.parse(decodeURIComponent(target)); }catch(e){}
  const b64 = target.replace(/^payload=/,'').replace(/^logsync=/,'');
  const decoded = importDecodeB64Json(b64);
  if(decoded) return decoded;
  throw new Error('JSON / Base64 / URL payload として読めません');
}
function importPutTrip(t){
  return new Promise((resolve) => {
    if(!db){ resolve(false); return; }
    const tx = db.transaction(STORE_TRIPS, 'readwrite');
    tx.objectStore(STORE_TRIPS).put(t);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}
function importHasLatLng(p){
  const a = Number(p && (p.gps_lat || p.latest_lat || p.lat));
  const b = Number(p && (p.gps_lng || p.latest_lng || p.lng));
  return Number.isFinite(a) && Number.isFinite(b) && a >= -90 && a <= 90 && b >= -180 && b <= 180 && !(a === 0 && b === 0);
}
function importHasBodyActivityProof(p){
  if(!p) return false;
  if(Number(p.motor_count || 0) > 0) return true;
  if(Number(p.pulse_count || 0) > 0) return true;
  if(Number(p.fishing_event_count || 0) > 0) return true;
  const r = importS(p.activity_reason || '');
  return /(^|,)(motorRun|pulse|event)(,|$)/.test(r);
}
function importDepthText(){
  for(const v of arguments){
    const t = importS(v);
    if(t && t !== '-' && t !== '0' && t !== '0.0') return t;
  }
  return '';
}
function importMergeVisitPayload(parent, visit){
  const p = Object.assign({}, parent || {}, visit || {});
  p.__viewer_import_single_visit = true;
  p.sid = importS((parent && parent.sid) || (visit && visit.sid));
  const fallbackKeys = [
    'lake_name','point_name','place_name','visit_label','candidate_no',
    'trip_start_ms','trip_end_ms','point_start_ms','point_end_ms','visit_start_ms','visit_end_ms',
    'line_no','sinker_g','sinker_g_x10','fishfinder_m','fishfinder_depth_m','water_depth_m',
    'water_temp_c','weather_text','weather','wind_dir','wind_speed_mps','wind','pressure_hpa','note','memo','map_source','map_spot_id',
    'fish_count','mark_count','tlog_count','tlog_activity_row_count','tlog_activity_rows','depth_range_mm',
    'first_seq','last_seq','first_t_ms','last_t_ms','first_recv_ms','last_recv_ms',
    'min_depth_m','max_depth_m','used_sasoi','used_speed','gps_quality','gps_quality_label',
    'gps_candidate_count','gps_visit_candidate_count','depth_source','depth_measured','depth_status'
  ];
  for(const k of fallbackKeys){
    if(!importS(p[k]) && parent && parent[k] !== undefined) p[k] = parent[k];
  }
  p.gps_visit_id = importS(visit && (visit.gps_visit_id || visit.visit_id));
  p.pico_point_visit_id = importS((visit && visit.pico_point_visit_id) || (parent && (parent.point_visit_id || parent.map_point_key || parent.pico_point_visit_id)));
  p.gps_lat = importS((visit && (visit.gps_lat || visit.latest_lat || visit.lat)) || p.gps_lat || p.lat);
  p.gps_lng = importS((visit && (visit.gps_lng || visit.latest_lng || visit.lng)) || p.gps_lng || p.lng);
  p.gps_acc_m = importS((visit && (visit.gps_acc_m || visit.acc_m || visit.acc)) || p.gps_acc_m || p.acc);
  p.point_visit_id = '';
  p.map_point_key = '';
  const depth = importDepthText(p.fishfinder_depth_m, p.max_depth_m, p.fishfinder_m, p.water_depth_m);
  p.fishfinder_depth_m = depth;
  p.water_depth_m = depth;
  p.depth_status = depth ? 'measured' : 'not_measured';
  return p;
}
function importMakePicoSummary(p){
  return {
    sid:importS(p.sid),
    gps_visit_id:importS(p.gps_visit_id || p.visit_id),
    pico_point_visit_id:importS(p.pico_point_visit_id),
    lake_name:importS(p.lake_name || p.place_name),
    point_name:importS(p.point_name || p.visit_label),
    visit_label:importS(p.visit_label),
    candidate_no:importFirstNum(p.candidate_no) || '',
    trip_start_ms:importFirstNum(p.trip_start_ms, p.start_ms, p.first_recv_ms) || 0,
    trip_end_ms:importFirstNum(p.trip_end_ms, p.last_recv_ms, p.updated_ms, p.visit_end_ms, p.end_ms) || 0,
    point_start_ms:importFirstNum(p.point_start_ms, p.visit_start_ms, p.start_ms, p.first_recv_ms) || 0,
    point_end_ms:importFirstNum(p.point_end_ms, p.last_recv_ms, p.visit_end_ms, p.updated_ms, p.end_ms) || 0,
    visit_start_ms:importFirstNum(p.visit_start_ms) || 0,
    visit_end_ms:importFirstNum(p.visit_end_ms) || 0,
    line_no:importS(p.line_no),
    sinker_g:importS(p.sinker_g),
    fishfinder_depth_m:importS(p.fishfinder_depth_m || p.water_depth_m || p.fishfinder_m || p.max_depth_m),
    water_temp_c:importS(p.water_temp_c),
    weather:importS(p.weather_text || p.weather),
    wind:importS(p.wind || p.wind_dir),
    pressure_hpa:importS(p.pressure_hpa || p.pressure || p.air_pressure_hpa),
    fish_count:importFirstNum(p.fish_count) || 0,
    mark_count:importFirstNum(p.mark_count) || 0,
    tlog_count:importFirstNum(p.tlog_count) || 0,
    tlog_activity_row_count:importFirstNum(p.tlog_activity_row_count) || arr(p.tlog_activity_rows).length || 0,
    first_seq:importAnyNum(p.first_seq) ?? '',
    last_seq:importAnyNum(p.last_seq) ?? '',
    first_t_ms:importAnyNum(p.first_t_ms) ?? '',
    last_t_ms:importAnyNum(p.last_t_ms) ?? '',
    first_recv_ms:importAnyNum(p.first_recv_ms) ?? '',
    last_recv_ms:importAnyNum(p.last_recv_ms) ?? '',
    min_depth_m:importS(p.min_depth_m),
    max_depth_m:importS(p.max_depth_m),
    used_sasoi:importS(p.used_sasoi),
    used_speed:importS(p.used_speed),
    gps_quality:importS(p.gps_quality),
    gps_quality_label:importS(p.gps_quality_label),
    gps_candidate_count:importFirstNum(p.gps_candidate_count) || 0,
    gps_visit_candidate_count:importFirstNum(p.gps_visit_candidate_count) || 0,
    depth_range_mm:importFirstNum(p.depth_range_mm) || '',
    depth_source:importS(p.depth_source),
    depth_status:importS(p.depth_status),
    saved_by:VIEWER_VERSION
  };
}
async function importFindTripForPayload(p){
  const visitKey = importS(p && (p.gps_visit_id || p.visit_id));
  if(!visitKey) return null;
  const trips = await getAllTrips();
  for(const t of trips){
    if(importS(t.gps_visit_id) === visitKey) return t;
    if(t.pico_summary && importS(t.pico_summary.gps_visit_id) === visitKey) return t;
    if(Array.isArray(t.pico_logs) && t.pico_logs.some(l => importS(l.gps_visit_id) === visitKey)) return t;
  }
  return null;
}
function importMakeTripFromPayload(p, existing){
  const now = Date.now();
  const a = Number(p.gps_lat || p.latest_lat || p.lat);
  const b = Number(p.gps_lng || p.latest_lng || p.lng);
  const visitKey = importS(p.gps_visit_id || p.visit_id) || importGenId('GPSV');
  const candidateNo = importFirstNum(p.candidate_no, p.visit_no);
  const visitLabel = importS(p.visit_label || (candidateNo !== null ? ('P' + candidateNo) : ''));
  const tripStart = importFirstNum(p.trip_start_ms, p.start_ms, p.first_recv_ms, p.visit_start_ms);
  const tripEnd = importFirstNum(p.trip_end_ms, p.last_recv_ms, p.updated_ms, p.visit_end_ms, p.end_ms);
  const pStart = importFirstNum(p.point_start_ms, p.visit_start_ms, p.start_ms, p.first_recv_ms);
  const pEnd = importFirstNum(p.point_end_ms, p.last_recv_ms, p.visit_end_ms, p.updated_ms, p.end_ms);
  const depth = importDepthText(p.fishfinder_depth_m, p.max_depth_m, p.fishfinder_m, p.water_depth_m);
  const t = Object.assign({}, existing || {});
  if(!t.trip_id) t.trip_id = importGenId('T');
  t.pico_sid = importS(p.sid);
  t.gps_visit_id = visitKey;
  t.candidate_no = candidateNo !== null ? candidateNo : (t.candidate_no || '');
  t.visit_label = visitLabel || t.visit_label || '';
  t.pico_point_visit_id = importS(p.pico_point_visit_id || p.point_visit_id || p.map_point_key || t.pico_point_visit_id || '');
  t.point_visit_id = '';
  t.map_point_key = '';
  t.map_spot_id = importS(t.map_spot_id || p.map_spot_id || p.spot_id || '');
  t.date_ms = tripStart || t.date_ms || now;
  t.location_time_ms = importFirstNum(p.visit_start_ms, p.gps_ms, p.start_ms, t.location_time_ms, now) || now;
  t.lat = Number.isFinite(a) ? a : Number(t.lat || 0);
  t.lng = Number.isFinite(b) ? b : Number(t.lng || 0);
  t.accuracy_m = importFirstNum(p.gps_acc_m, p.acc_m, p.acc, p.accuracy_m) || t.accuracy_m || 0;
  if(tripStart) t.trip_start_ms = tripStart;
  if(tripEnd) t.trip_end_ms = tripEnd;
  if(pStart) t.point_start_ms = pStart;
  if(pEnd) t.point_end_ms = pEnd;
  if(importFirstNum(p.visit_start_ms)) t.visit_start_ms = importFirstNum(p.visit_start_ms);
  if(importFirstNum(p.visit_end_ms)) t.visit_end_ms = importFirstNum(p.visit_end_ms);
  t.lake_name = importS(t.lake_name || p.lake_name || p.place_name || '');
  t.point_name = importS(t.point_name || p.point_name || visitLabel || 'Pico W実釣地点');
  if(importS(t.point_name) === 'Pico W実釣地点' && visitLabel) t.point_name = visitLabel;
  t.line_no = importS(t.line_no || p.line_no || '');
  t.sinker_g = importS(t.sinker_g || p.sinker_g || '');
  t.fishfinder_depth_m = depth || t.fishfinder_depth_m || '';
  t.depth_status = depth ? 'measured' : (t.depth_status || 'not_measured');
  t.depth_last_sync_ms = now;
  t.water_temp_c = importS(t.water_temp_c || p.water_temp_c || '');
  t.weather_text = importS(t.weather_text || p.weather_text || p.weather || '');
  t.weather = importS(t.weather || p.weather || p.weather_text || '');
  t.wind_dir = importS(t.wind_dir || p.wind_dir || '');
  t.wind_speed_mps = importS(t.wind_speed_mps || p.wind_speed_mps || '');
  t.wind = importS(t.wind || p.wind || p.wind_dir || '');
  t.pressure_hpa = importS(t.pressure_hpa || p.pressure_hpa || p.pressure || p.air_pressure_hpa || '');
  t.memo = importS(t.memo || p.note || '');
  t.fish_count = importFirstNum(p.fish_count) !== null ? importFirstNum(p.fish_count) : (t.fish_count || 0);
  t.mark_count = importFirstNum(p.mark_count) !== null ? importFirstNum(p.mark_count) : (t.mark_count || 0);
  t.tlog_count = importFirstNum(p.tlog_count) !== null ? importFirstNum(p.tlog_count) : (t.tlog_count || 0);
  t.tlog_activity_row_count = importFirstNum(p.tlog_activity_row_count) !== null ? importFirstNum(p.tlog_activity_row_count) : (arr(p.tlog_activity_rows).length || t.tlog_activity_row_count || 0);
  if(Array.isArray(p.tlog_activity_rows)) t.tlog_activity_rows = importClone(p.tlog_activity_rows);
  t.first_seq = importAnyNum(p.first_seq) ?? t.first_seq ?? '';
  t.last_seq = importAnyNum(p.last_seq) ?? t.last_seq ?? '';
  t.first_t_ms = importAnyNum(p.first_t_ms) ?? t.first_t_ms ?? '';
  t.last_t_ms = importAnyNum(p.last_t_ms) ?? t.last_t_ms ?? '';
  t.first_recv_ms = importAnyNum(p.first_recv_ms) ?? t.first_recv_ms ?? '';
  t.last_recv_ms = importAnyNum(p.last_recv_ms) ?? t.last_recv_ms ?? '';
  t.min_depth_m = importS(p.min_depth_m || t.min_depth_m || '');
  t.max_depth_m = importS(p.max_depth_m || t.max_depth_m || '');
  t.used_sasoi = importS(p.used_sasoi || t.used_sasoi || '');
  t.used_speed = importS(p.used_speed || t.used_speed || '');
  t.gps_quality = importS(p.gps_quality || t.gps_quality || '');
  t.gps_quality_label = importS(p.gps_quality_label || t.gps_quality_label || '');
  t.gps_candidate_count = importFirstNum(p.gps_candidate_count) !== null ? importFirstNum(p.gps_candidate_count) : (t.gps_candidate_count || 0);
  t.gps_visit_candidate_count = importFirstNum(p.gps_visit_candidate_count) !== null ? importFirstNum(p.gps_visit_candidate_count) : (t.gps_visit_candidate_count || 0);
  t.depth_source = importS(p.depth_source || t.depth_source || '');
  t.depth_measured = importS(p.depth_measured || t.depth_measured || '');
  t.depth_range_mm = importFirstNum(p.depth_range_mm) !== null ? importFirstNum(p.depth_range_mm) : (t.depth_range_mm || '');
  t.candidate_window_start_ms = importFirstNum(p.candidate_window_start_ms) !== null ? importFirstNum(p.candidate_window_start_ms) : (t.candidate_window_start_ms || '');
  t.candidate_window_end_ms = importFirstNum(p.candidate_window_end_ms) !== null ? importFirstNum(p.candidate_window_end_ms) : (t.candidate_window_end_ms || '');
  t.pico_payload = importClone(p);
  t.pico_payload_saved_ms = now;
  t.pico_logs = Array.isArray(t.pico_logs) ? t.pico_logs : [];
  const summary = importMakePicoSummary(p);
  if(Array.isArray(p.tlog_activity_rows)) summary.tlog_activity_rows = importClone(p.tlog_activity_rows);
  t.pico_logs = t.pico_logs.filter(x => importS(x.gps_visit_id) !== visitKey);
  t.pico_logs.push(summary);
  t.pico_summary = summary;
  if(!t.created_ms) t.created_ms = now;
  t.updated_ms = now;
  t.saved_by = VIEWER_VERSION;
  return t;
}
function importSplitPayload(payload){
  if(!payload) return [];
  if(Array.isArray(payload)) return payload.flatMap(importSplitPayload);
  if(Array.isArray(payload.gps_visit_candidates)){
    return payload.gps_visit_candidates
      .filter(v => v && importS(v.gps_visit_id || v.visit_id) && importHasLatLng(v) && importHasBodyActivityProof(v))
      .map(v => importMergeVisitPayload(payload, v))
      .filter(p => importHasLatLng(p) && importHasBodyActivityProof(p));
  }
  if(importHasLatLng(payload) && importHasBodyActivityProof(payload)) return [payload];
  return [];
}
async function importSavePayload(payload){
  const parts = importSplitPayload(payload);
  if(!parts.length) return {ok:false, saved_count:0, reason:'実釣ありvisitがありません'};
  let saved = 0;
  const ids = [];
  for(const p of parts){
    const ex = await importFindTripForPayload(p);
    const trip = importMakeTripFromPayload(p, ex);
    if(await importPutTrip(trip)){
      saved++;
      ids.push(trip.trip_id);
    }
  }
  return {ok:saved>0, saved_count:saved, trip_ids:ids};
}
async function importTripsFromText(){
  try{
    if(!db) db = await openDb();
    const box = $('importBox');
    const payload = importPayloadFromText(box ? box.value : '');
    importSetStatus('保存中...', 'warn');
    const result = await importSavePayload(payload);
    if(result.ok){
      importSetStatus(`保存完了: ${result.saved_count}地点`, 'good');
      await reload();
      if(result.trip_ids && result.trip_ids.length) selectTrip(result.trip_ids[result.trip_ids.length - 1]);
    }else{
      importSetStatus(`保存なし: ${result.reason || 'unknown'}`, 'bad');
    }
  }catch(e){
    importSetStatus(`取り込み失敗: ${e && e.message ? e.message : e}`, 'bad');
  }
}

function bindEvents(){
  $('searchBox').addEventListener('input', renderList);
  $('sortMode').addEventListener('change', renderList);
  $('btnReload').addEventListener('click', reload);
  $('btnShowMapList').addEventListener('click', showMapList);
  if($('btnImportTrips')) $('btnImportTrips').addEventListener('click', importTripsFromText);
  if($('btnImportClear')) $('btnImportClear').addEventListener('click', () => { if($('importBox')) $('importBox').value = ''; importSetStatus('待機中', ''); });
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
.importBox{width:100%;box-sizing:border-box;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:14px;line-height:1.45;border:1px solid #cbd5e1;border-radius:12px;padding:10px;background:#fff;min-height:170px}
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
