'use strict';

const VERSION = '11.9';
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
let autoLinkStarted = false;

const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(window.location.search || '');

function nowMs() { return Date.now(); }
function pad(n) { return String(n).padStart(2, '0'); }
function fmtTime(ms) {
  const n = Number(ms || 0);
  if (!n) return '-';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDateOnly(ms) {
  const n = Number(ms || 0);
  if (!n) return '-';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}
function toLocal(ms) {
  const d = new Date(Number(ms || nowMs()));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocal(v) {
  const n = new Date(v || '').getTime();
  return Number.isFinite(n) ? n : nowMs();
}
function genId(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 0xfffff).toString(16).padStart(5, '0')}`;
}
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function validLatLng(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && a >= -90 && a <= 90 && b >= -180 && b <= 180;
}
function dist(lat1, lng1, lat2, lng2) {
  const R = 6371008.8;
  const r = (v) => v * Math.PI / 180;
  const p1 = r(lat1), p2 = r(lat2), dp = r(lat2 - lat1), dl = r(lng2 - lng1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function setPill(id, text, cls = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = `pill ${cls}`.trim();
}
function title(t) { return (t && (t.point_name || t.lake_name)) || '釣行地点'; }
function lat(t) { return Number(t && t.lat); }
function lng(t) { return Number(t && t.lng); }
function tms(t) { return Number((t && (t.date_ms || t.start_ms || t.created_ms)) || 0); }
function dCurrent(t) {
  if (!currentPos || !t) return null;
  return dist(Number(currentPos.lat), Number(currentPos.lng), lat(t), lng(t));
}
function dBase(t, a, b) {
  if (!t || !validLatLng(Number(a), Number(b)) || !validLatLng(lat(t), lng(t))) return null;
  return dist(Number(a), Number(b), lat(t), lng(t));
}
function sub(t) {
  return `ライン ${esc(t.line_no || '-')} / シンカー ${esc(t.sinker_g || '-')}g / 魚探 ${esc(t.fishfinder_depth_m || t.fishfinder_m || '-')}m / 水温 ${esc(t.water_temp_c || '-')}℃`;
}
function normalizePicoBase(v) {
  let s = String(v || '').trim();
  if (!s) return '';
  try { s = decodeURIComponent(s); } catch (e) {}
  s = s.trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}`;
  } catch (e) {
    return '';
  }
}
function picoBase() {
  const field = $('picoIp');
  const fromField = field ? field.value : '';
  return normalizePicoBase(fromField || qs.get('pico') || localStorage.getItem('wakasagi_pico_base') || '');
}
function currentAppUrl() {
  const base = `${location.origin}${location.pathname}`;
  const p = new URLSearchParams();
  p.set('v', '119');
  const pico = picoBase();
  if (pico) p.set('pico', pico);
  return `${base}?${p.toString()}`;
}
function setPicoUi() {
  const base = picoBase();
  const field = $('picoIp');
  if (field && base && !field.value) field.value = base.replace(/^https?:\/\//, '');
  if (base) {
    localStorage.setItem('wakasagi_pico_base', base);
    $('picoStatus').textContent = `Pico W: ${base}`;
    $('btnBackLog').disabled = false;
    $('btnBackRemote').disabled = false;
  } else {
    $('picoStatus').textContent = 'Pico W: 未設定';
    $('btnBackLog').disabled = true;
    $('btnBackRemote').disabled = true;
  }
}
function openPico(path) {
  const base = picoBase();
  if (!base) return;
  location.href = `${base}${path}`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE_TRIPS)) {
        const st = d.createObjectStore(STORE_TRIPS, { keyPath: 'trip_id' });
        st.createIndex('date_ms', 'date_ms', { unique: false });
      }
      if (!d.objectStoreNames.contains(STORE_META)) d.createObjectStore(STORE_META, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function st(name, mode = 'readonly') { return db.transaction(name, mode).objectStore(name); }
function getAllTrips() {
  return new Promise((resolve) => {
    const r = st(STORE_TRIPS).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => resolve([]);
  });
}
function putTrip(t) {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_TRIPS, 'readwrite');
    tx.objectStore(STORE_TRIPS).put(t);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}
function delTrip(id) {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_TRIPS, 'readwrite');
    tx.objectStore(STORE_TRIPS).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}
function metaGet(k) {
  return new Promise((resolve) => {
    const r = st(STORE_META).get(k);
    r.onsuccess = () => resolve(r.result ? r.result.value : null);
    r.onerror = () => resolve(null);
  });
}
function metaSet(k, v) {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).put({ key: k, value: v });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}
function normalizeOld(s) {
  const a = Number(s && s.lat), b = Number(s && s.lng);
  if (!validLatLng(a, b)) return null;
  return {
    trip_id: s.trip_id || s.spot_id || genId('T'),
    migrated_from: s.spot_id || '',
    date_ms: Number(s.start_ms || s.date_ms || s.created_ms || nowMs()),
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
    pico_sid: s.pico_sid || '',
    pico_summary: s.pico_summary || null,
    created_ms: Number(s.created_ms || s.start_ms || nowMs()),
    updated_ms: Number(s.updated_ms || s.start_ms || nowMs())
  };
}
function openOld() {
  return new Promise((resolve) => {
    const r = indexedDB.open(OLD_DB_NAME);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.onblocked = () => resolve(null);
  });
}
async function migrateOld(force = false) {
  if (!force && await metaGet('old_migrated')) return 0;
  const old = await openOld();
  if (!old || !old.objectStoreNames.contains(OLD_STORE_SPOTS)) {
    await metaSet('old_migrated', true);
    return 0;
  }
  const rows = await new Promise((resolve) => {
    const r = old.transaction(OLD_STORE_SPOTS, 'readonly').objectStore(OLD_STORE_SPOTS).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => resolve([]);
  });
  const cur = await getAllTrips();
  const exists = new Set(cur.map((x) => String(x.migrated_from || x.trip_id)));
  let count = 0;
  for (const row of rows) {
    const t = normalizeOld(row);
    if (!t) continue;
    if (!force && exists.has(String(t.migrated_from || t.trip_id))) continue;
    await putTrip(t);
    count++;
  }
  await metaSet('old_migrated', true);
  return count;
}

function ensureMap() {
  if (map) return true;
  if (!window.L) {
    $('map').innerHTML = '<div class="mapLoading error">地図ライブラリを読み込めませんでした。</div>';
    return false;
  }
  map = L.map('map', { zoomControl: true }).setView(DEFAULT_CENTER, 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  groupLayer = L.layerGroup().addTo(map);
  setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, 100);
  setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, 600);
  return true;
}
function drawCurrent() {
  if (!currentPos || !ensureMap()) return;
  const a = Number(currentPos.lat), b = Number(currentPos.lng), acc = Number(currentPos.acc || 0);
  [currentMarker, accCircle, cur20, cur100].forEach((x) => { if (x) x.remove(); });
  currentMarker = L.marker([a, b]).addTo(map).bindPopup('<div class="seniorPopup"><b>現在地</b></div>');
  if (acc > 0) accCircle = L.circle([a, b], { radius: acc, className: 'accuracyCircle' }).addTo(map);
  cur20 = L.circle([a, b], { radius: SAME_POINT_M, className: 'circle20' }).addTo(map);
  cur100 = L.circle([a, b], { radius: SAME_AREA_M, className: 'circle100' }).addTo(map);
  map.setView([a, b], 18);
  $('btnFitNear').disabled = false;
  $('btnSaveScroll').disabled = false;
  $('btnSaveTrip').disabled = false;
  setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, 50);
}
function makeGroups(trips) {
  const valid = trips.filter((x) => validLatLng(lat(x), lng(x))).slice().sort((a, b) => tms(b) - tms(a));
  const gs = [];
  for (const t of valid) {
    let best = null;
    let bestDist = Infinity;
    for (const g of gs) {
      const dd = dist(lat(t), lng(t), g.lat, g.lng);
      if (dd <= SAME_POINT_M && dd < bestDist) {
        best = g;
        bestDist = dd;
      }
    }
    if (!best) {
      best = { group_id: genId('G'), lat: lat(t), lng: lng(t), trips: [] };
      gs.push(best);
    }
    best.trips.push(t);
    const n = best.trips.length;
    best.lat = best.trips.reduce((sum, x) => sum + lat(x), 0) / n;
    best.lng = best.trips.reduce((sum, x) => sum + lng(x), 0) / n;
  }
  for (const g of gs) {
    g.trips.sort((a, b) => tms(b) - tms(a));
    g.latest = g.trips[0];
    g.count = g.trips.length;
    g.latest_ms = tms(g.latest);
    g.distance_m = currentPos ? dist(Number(currentPos.lat), Number(currentPos.lng), g.lat, g.lng) : null;
    g.group_id = `G_${g.lat.toFixed(5)}_${g.lng.toFixed(5)}`;
  }
  return gs.sort((a, b) => currentPos ? ((a.distance_m ?? Infinity) - (b.distance_m ?? Infinity)) : (b.latest_ms - a.latest_ms));
}
function markerClass(g) {
  if (selectedGroupId === g.group_id) return 'pinCount selected';
  if (g.distance_m !== null && g.distance_m <= SAME_POINT_M) return 'pinCount near20';
  if (g.distance_m !== null && g.distance_m <= SAME_AREA_M) return 'pinCount near100';
  return 'pinCount';
}
function popupDatesHtml(g) {
  const dates = (g.trips || []).slice().sort((a, b) => tms(b) - tms(a)).map((t) => `
    <button class="popupDateBtn" type="button" onclick="window.WKM.selectTrip('${esc(t.trip_id)}')">
      <span>${esc(fmtDateOnly(tms(t)))}</span>
      <small>${esc(fmtTime(tms(t)).slice(11))}</small>
    </button>`).join('');
  return `<div class="seniorPopup">
    <div class="popupTitle">${esc(title(g.latest))}</div>
    <div class="popupCount">この場所の過去釣行日 ${g.count}回</div>
    <div class="popupHelp">日付を選ぶと詳細を表示します。</div>
    <div class="popupDateList">${dates}</div>
  </div>`;
}
async function renderMap() {
  ensureMap();
  if (!groupLayer) return;
  groupLayer.clearLayers();
  const trips = await getAllTrips();
  groups = makeGroups(trips);
  for (const g of groups) {
    const ic = L.divIcon({
      className: '',
      html: `<div class="${markerClass(g)}"><span>${g.count}</span></div>`,
      iconSize: [58, 58],
      iconAnchor: [29, 29],
      popupAnchor: [0, -28]
    });
    L.marker([g.lat, g.lng], { icon: ic })
      .addTo(groupLayer)
      .bindPopup(popupDatesHtml(g), { maxWidth: 360, minWidth: 300, autoPan: true, closeButton: true })
      .on('click', () => showGroupDateList(g));
  }
}
function updatePosition(pos) {
  currentPos = {
    lat: Number(pos.lat),
    lng: Number(pos.lng),
    acc: Number(pos.acc || 0),
    t: Number(pos.t || nowMs())
  };
  $('latView').textContent = currentPos.lat.toFixed(7);
  $('lngView').textContent = currentPos.lng.toFixed(7);
  $('accView').textContent = currentPos.acc ? `±${Math.round(currentPos.acc)}m` : '-';
  $('timeView').textContent = fmtTime(currentPos.t);
  $('locStatus').textContent = '現在地を確認しました。';
  setPill('locBadge', '取得済み', currentPos.acc > 0 && currentPos.acc <= 20 ? 'good' : 'warn');
  metaSet('last_pos', currentPos);
  drawCurrent();
  refreshAll().then(() => maybeAutoLink());
}
function locate() {
  if (!window.isSecureContext) {
    $('locStatus').textContent = 'HTTPSで開いていません。GitHub Pagesのhttps URLから開いてください。';
    setPill('locBadge', 'HTTPS必要', 'bad');
    return;
  }
  if (!('geolocation' in navigator)) {
    $('locStatus').textContent = 'このブラウザは現在地取得に対応していません。';
    setPill('locBadge', '非対応', 'bad');
    return;
  }
  $('locStatus').textContent = '現在地を取得しています...';
  setPill('locBadge', '取得中', 'warn');
  navigator.geolocation.getCurrentPosition((g) => {
    const c = g.coords;
    updatePosition({ lat: Number(c.latitude), lng: Number(c.longitude), acc: Number(c.accuracy || 0), t: Number(g.timestamp || nowMs()) });
  }, async (e) => {
    $('locStatus').textContent = `現在地エラー: ${e && e.message ? e.message : '取得できませんでした'}`;
    setPill('locBadge', '未取得', 'bad');
    const last = await metaGet('last_pos');
    if (last && validLatLng(Number(last.lat), Number(last.lng))) {
      $('locStatus').textContent = '前回位置を表示しています。';
      setPill('locBadge', '前回位置', 'warn');
      updatePosition(last);
    }
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
}
function drawSelected(a, b) {
  if (!ensureMap()) return;
  [sel20, sel100].forEach((x) => { if (x) x.remove(); });
  sel20 = L.circle([a, b], { radius: SAME_POINT_M, className: 'selectedCircle20' }).addTo(map);
  sel100 = L.circle([a, b], { radius: SAME_AREA_M, className: 'selectedCircle100' }).addTo(map);
}
function showGroupDateList(g) {
  if (!g) return;
  selectedGroupId = g.group_id;
  selectedTripId = null;
  drawSelected(g.lat, g.lng);
  renderPointDateList(g);
  $('selectedMini').textContent = `${title(g.latest)} / ${g.count}回`;
  $('selectedLead').innerHTML = `<b>日付を選んでください。</b> この段階では詳細を出しません。`;
  $('selectedTripDetail').className = 'emptyBox largeHint';
  $('selectedTripDetail').textContent = 'ピンを押したので、この場所の過去釣行日を表示しています。見たい日付を押すと詳細が出ます。';
  setPill('selectedBadge', '日付選択中', 'warn');
}
function renderPointDateList(g) {
  const same = (g.trips || []).slice().sort((a, b) => tms(b) - tms(a));
  const all = groups.flatMap((x) => x.trips || []);
  const near = all
    .filter((t) => !same.some((s) => s.trip_id === t.trip_id))
    .map((t) => ({ t, d: dBase(t, g.lat, g.lng) }))
    .filter((x) => x.d !== null && x.d <= SAME_AREA_M)
    .sort((a, b) => a.d - b.d || tms(b.t) - tms(a.t));
  setPill('pointBadge', `同一${same.length}/近辺${near.length}`, 'good');
  $('pointHistoryPanel').className = 'dateChoiceBox';
  $('pointHistoryPanel').innerHTML = `
    <div class="dateChoiceTitle">このポイントの過去釣行日</div>
    <div class="dateChoiceSub">20m以内 ${same.length}回。日付だけを大きく表示しています。</div>
    <div class="dateButtonList">
      ${same.map((t) => dateChoiceButton(t, '同一ポイント')).join('')}
    </div>
    <details class="nearDetails">
      <summary>100m以内の近辺履歴 ${near.length}回</summary>
      <div class="dateButtonList nearList">
        ${near.length ? near.map((x) => dateChoiceButton(x.t, `${Math.round(x.d)}m`)).join('') : '<p class="emptyText">近辺履歴はありません。</p>'}
      </div>
    </details>`;
}
function dateChoiceButton(t, badge) {
  return `<button class="dateChoiceBtn" type="button" data-trip-id="${esc(t.trip_id)}" onclick="window.WKM.selectTrip('${esc(t.trip_id)}')">
    <span class="dateMain">${esc(fmtDateOnly(tms(t)))}</span>
    <span class="dateSub">${esc(badge)} / ${esc(fmtTime(tms(t)).slice(11))}</span>
  </button>`;
}
function picoSummaryHtml(s) {
  if (!s) return '<div class="emptyText">Pico Wログ要約はまだありません。</div>';
  const fish = s.fish_count ?? s.fish ?? '-';
  const mark = s.mark_count ?? s.mark ?? '-';
  const logs = s.tlog_count ?? s.log_count ?? s.logs ?? '-';
  const sid = s.sid ?? s.pico_sid ?? '-';
  const seq = [s.seq_min ?? s.seq_start ?? '', s.seq_max ?? s.seq_end ?? ''].filter((v) => v !== '').join(' - ') || '-';
  const depth = formatDepthRange(s);
  const speed = Array.isArray(s.speed_levels) ? s.speed_levels.join(', ') : (s.speed_levels || s.speedLevel || '-');
  const sasoi = Array.isArray(s.sasoi_types) ? s.sasoi_types.join(', ') : (s.sasoi_types || s.sasoiType || '-');
  return `<div class="picoSummary">
    <div class="bigStats">
      <div><span>FISH</span><b>${esc(fish)}</b></div>
      <div><span>MARK</span><b>${esc(mark)}</b></div>
      <div><span>LOG</span><b>${esc(logs)}</b></div>
    </div>
    <dl class="infoGrid compact">
      <div><dt>Pico W sid</dt><dd>${esc(sid)}</dd></div>
      <div><dt>seq範囲</dt><dd>${esc(seq)}</dd></div>
      <div><dt>開始</dt><dd>${esc(fmtMaybeTime(s.started_ms || s.start_ms))}</dd></div>
      <div><dt>終了</dt><dd>${esc(fmtMaybeTime(s.ended_ms || s.end_ms))}</dd></div>
      <div><dt>深度範囲</dt><dd>${esc(depth)}</dd></div>
      <div><dt>使用速度</dt><dd>${esc(speed)}</dd></div>
      <div><dt>使用誘い</dt><dd>${esc(sasoi)}</dd></div>
    </dl>
  </div>`;
}
function fmtMaybeTime(v) {
  const n = Number(v || 0);
  if (!n) return '-';
  if (n > 100000000000) return fmtTime(n);
  return `${Math.round(n / 1000)}秒`;
}
function formatDepthRange(s) {
  const a = s.depth_min_m ?? (Number.isFinite(Number(s.depth_min_mm)) ? Number(s.depth_min_mm) / 1000 : null);
  const b = s.depth_max_m ?? (Number.isFinite(Number(s.depth_max_mm)) ? Number(s.depth_max_mm) / 1000 : null);
  if (a == null && b == null) return '-';
  return `${a == null ? '-' : Number(a).toFixed(2)}m - ${b == null ? '-' : Number(b).toFixed(2)}m`;
}
function detailHtml(t, base = null) {
  let dd = '-';
  if (base) {
    const d = dBase(t, base.lat, base.lng);
    if (d !== null) dd = `${Math.round(d)}m`;
  } else if (currentPos) {
    const d = dCurrent(t);
    if (d !== null) dd = `現在地から ${Math.round(d)}m`;
  }
  const s = t.pico_summary || (Array.isArray(t.pico_logs) && t.pico_logs.length ? t.pico_logs[t.pico_logs.length - 1] : null);
  return `<div class="tripDetailCard">
    <div class="tripHero">
      <div><span>日付</span><b>${esc(fmtDateOnly(tms(t)))}</b></div>
      <div><span>距離</span><b>${esc(dd)}</b></div>
    </div>
    <dl class="infoGrid">
      <div><dt>湖名</dt><dd>${esc(t.lake_name || '-')}</dd></div>
      <div><dt>ポイント名</dt><dd>${esc(t.point_name || '-')}</dd></div>
      <div><dt>ライン</dt><dd>${esc(t.line_no || '-')}</dd></div>
      <div><dt>シンカー</dt><dd>${esc(t.sinker_g || '-')}g</dd></div>
      <div><dt>魚探水深</dt><dd>${esc(t.fishfinder_depth_m || t.fishfinder_m || '-')}m</dd></div>
      <div><dt>水温</dt><dd>${esc(t.water_temp_c || '-')}℃</dd></div>
      <div><dt>天気</dt><dd>${esc(t.weather || '-')}</dd></div>
      <div><dt>風</dt><dd>${esc(t.wind || '-')}</dd></div>
      <div><dt>座標</dt><dd>${Number(t.lat).toFixed(7)}, ${Number(t.lng).toFixed(7)}</dd></div>
      <div class="wideInfo"><dt>メモ</dt><dd>${esc(t.memo || '-')}</dd></div>
    </dl>
    <h3>Pico Wログ要約</h3>
    ${picoSummaryHtml(s)}
  </div>`;
}
async function selectTrip(id) {
  const trips = await getAllTrips();
  const t = trips.find((x) => x.trip_id === id);
  if (!t) return;
  groups = makeGroups(trips);
  const g = groups.find((gr) => gr.trips.some((x) => x.trip_id === id)) || { group_id: `single_${id}`, lat: lat(t), lng: lng(t), trips: [t], latest: t, count: 1 };
  selectedGroupId = g.group_id;
  selectedTripId = id;
  renderPointDateList(g);
  showTripDetail(t, { lat: g.lat, lng: g.lng });
  drawSelected(g.lat, g.lng);
  await renderMap();
  if (map) map.setView([lat(t), lng(t)], 18);
  document.querySelector('.selectedPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function showTripDetail(t, base = null) {
  selectedTripId = t.trip_id;
  $('selectedMini').textContent = title(t);
  $('selectedLead').innerHTML = `<b>${esc(title(t))}</b><br>${esc(fmtTime(tms(t)))}`;
  setPill('selectedBadge', '詳細表示中', 'good');
  $('selectedTripDetail').className = 'detail';
  $('selectedTripDetail').innerHTML = `${detailHtml(t, base)}
    <div class="buttonRow detailButtons">
      <button id="btnStdSelected" class="wideBtn" type="button">標準地図</button>
      <button id="btnEditSelected" class="wideBtn" type="button">入力欄へ読込</button>
      <button id="btnDeleteSelected" class="wideBtn danger" type="button">この履歴を削除</button>
    </div>`;
  $('btnStdSelected').onclick = () => openStd(lat(t), lng(t));
  $('btnEditSelected').onclick = () => loadToForm(t.trip_id);
  $('btnDeleteSelected').onclick = async () => {
    if (!confirm('この釣行履歴を削除しますか？')) return;
    await delTrip(t.trip_id);
    selectedTripId = null;
    selectedGroupId = null;
    $('selectedTripDetail').className = 'emptyBox';
    $('selectedTripDetail').textContent = '未選択';
    $('selectedLead').textContent = '地図の数字ピンをタップすると、まずその場所の過去釣行日だけを表示します。日付を選ぶと詳細を表示します。';
    setPill('selectedBadge', '未選択');
    await refreshAll();
  };
}
function itemHtml(t, label, base) {
  const d = base ? dBase(t, base.lat, base.lng) : dCurrent(t);
  const distText = d !== null ? `${Math.round(d)}m` : '';
  return `<article class="historyItem">
    <button type="button" class="historySelect" onclick="window.WKM.selectTrip('${esc(t.trip_id)}')">
      <span class="historyTitle">${esc(title(t))}</span>
      <span class="historyDate">${esc(fmtDateOnly(tms(t)))} ${esc(label || '')} ${esc(distText)}</span>
      <span class="historySub">${sub(t)}</span>
      <span class="historyMemo">${esc(t.memo || '')}</span>
      <span class="historyAction">この釣行回を表示</span>
    </button>
  </article>`;
}
async function renderAllHistory() {
  const trips = await getAllTrips();
  const mode = $('sortMode').value;
  const rows = trips.filter((t) => validLatLng(lat(t), lng(t))).slice();
  rows.sort((a, b) => {
    if (mode === 'old') return tms(a) - tms(b);
    if (mode === 'name') return title(a).localeCompare(title(b), 'ja') || (tms(b) - tms(a));
    if (mode === 'near' && currentPos) return (dCurrent(a) ?? Infinity) - (dCurrent(b) ?? Infinity);
    return tms(b) - tms(a);
  });
  setPill('historyBadge', `${rows.length}件`, rows.length ? 'good' : 'warn');
  $('historyList').innerHTML = rows.length ? rows.map((t) => itemHtml(t, '', null)).join('') : '<div class="emptyBox">保存済み履歴はまだありません。</div>';
}
async function updateCounters() {
  const trips = await getAllTrips();
  $('allCount').textContent = String(trips.length);
  if (!currentPos) {
    $('near20Count').textContent = '-';
    $('near100Count').textContent = '-';
    return;
  }
  let n20 = 0, n100 = 0;
  for (const t of trips) {
    const d = dCurrent(t);
    if (d !== null && d <= SAME_POINT_M) n20++;
    if (d !== null && d <= SAME_AREA_M) n100++;
  }
  $('near20Count').textContent = String(n20);
  $('near100Count').textContent = String(n100);
}
async function refreshAll() {
  await renderMap();
  await renderAllHistory();
  await updateCounters();
}
function fitAll() {
  if (!map || !groups.length) return;
  const bounds = L.latLngBounds(groups.map((g) => [g.lat, g.lng]));
  if (currentPos) bounds.extend([currentPos.lat, currentPos.lng]);
  map.fitBounds(bounds.pad(0.12), { maxZoom: 17 });
}
function fitNear() {
  if (!map || !currentPos) return;
  map.setView([currentPos.lat, currentPos.lng], 18);
}
function openStd(a, b) {
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${a},${b}`)}`, '_blank', 'noopener');
}

function readForm() {
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
function fillForm(t) {
  $('tripDate').value = toLocal(t.date_ms);
  $('lakeName').value = t.lake_name || '';
  $('pointName').value = t.point_name || '';
  $('lineNo').value = t.line_no || '';
  $('sinkerG').value = t.sinker_g || '';
  $('fishfinderDepthM').value = t.fishfinder_depth_m || '';
  $('waterTempC').value = t.water_temp_c || '';
  $('weather').value = t.weather || '';
  $('wind').value = t.wind || '';
  $('memo').value = t.memo || '';
}
function clearForm() {
  editingTripId = null;
  $('tripDate').value = toLocal(nowMs());
  ['lakeName', 'pointName', 'lineNo', 'sinkerG', 'fishfinderDepthM', 'waterTempC', 'weather', 'wind', 'memo'].forEach((id) => { $(id).value = ''; });
  $('btnUpdateTrip').disabled = true;
  setPill('saveBadge', '待機中');
}
async function loadToForm(id) {
  const tid = id || selectedTripId;
  if (!tid) return;
  const t = (await getAllTrips()).find((x) => x.trip_id === tid);
  if (!t) return;
  editingTripId = tid;
  fillForm(t);
  $('btnUpdateTrip').disabled = false;
  setPill('saveBadge', '読込済み', 'good');
  $('savePanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function saveTrip() {
  if (!currentPos) {
    alert('現在地がありません。');
    return;
  }
  const now = nowMs();
  const t = {
    trip_id: genId('T'),
    ...readForm(),
    lat: Number(currentPos.lat),
    lng: Number(currentPos.lng),
    accuracy_m: Number(currentPos.acc || 0),
    location_time_ms: Number(currentPos.t || now),
    created_ms: now,
    updated_ms: now
  };
  await putTrip(t);
  selectedTripId = t.trip_id;
  setPill('saveBadge', '保存済み', 'good');
  await refreshAll();
  await selectTrip(t.trip_id);
}
async function updateTrip() {
  if (!editingTripId) return;
  const trips = await getAllTrips();
  const old = trips.find((x) => x.trip_id === editingTripId);
  if (!old) return;
  const t = { ...old, ...readForm(), updated_ms: nowMs() };
  await putTrip(t);
  editingTripId = null;
  $('btnUpdateTrip').disabled = true;
  setPill('saveBadge', '上書き済み', 'good');
  await refreshAll();
  await selectTrip(t.trip_id);
}

function currentLinkTripBase() {
  if (selectedTripId) return selectedTripId;
  return null;
}
function buildMaplinkPayload() {
  const f = readForm();
  let source = null;
  if (selectedTripId) source = { trip_id: selectedTripId };
  const p = {
    schema: 'wakasagi-maplink-v119',
    app_version: VERSION,
    client_ms: nowMs(),
    return_url: currentAppUrl(),
    source,
    ...f
  };
  if (currentPos) {
    p.lat = Number(currentPos.lat);
    p.lng = Number(currentPos.lng);
    p.accuracy_m = Number(currentPos.acc || 0);
    p.location_time_ms = Number(currentPos.t || nowMs());
  }
  return p;
}
async function sendMaplinkToPico(manual = true) {
  const base = picoBase();
  if (!base) {
    setPill('linkBadge', 'Pico未設定', 'bad');
    $('linkStatus').textContent = 'Pico W IPが未設定です。';
    return;
  }
  if (!currentPos && !selectedTripId) {
    setPill('linkBadge', '地点なし', 'bad');
    $('linkStatus').textContent = '現在地または選択履歴がありません。';
    return;
  }
  let payload = buildMaplinkPayload();
  if (selectedTripId) {
    const t = (await getAllTrips()).find((x) => x.trip_id === selectedTripId);
    if (t) {
      payload = { ...payload, ...readTripFieldsForLink(t), source: { trip_id: t.trip_id } };
    }
  }
  await metaSet('pending_maplink', payload);
  await metaSet('pending_maplink_ms', nowMs());
  setPill(manual ? 'linkBadge' : 'autoBadge', manual ? '送信中' : '自動連携中', 'warn');
  const hash = `maplink=${encodeURIComponent(JSON.stringify(payload))}&return_url=${encodeURIComponent(currentAppUrl())}`;
  location.href = `${base}/log#${hash}`;
}
function readTripFieldsForLink(t) {
  return {
    trip_id: t.trip_id,
    lat: lat(t),
    lng: lng(t),
    accuracy_m: Number(t.accuracy_m || 0),
    location_time_ms: Number(t.location_time_ms || t.date_ms || nowMs()),
    date_ms: tms(t),
    lake_name: t.lake_name || '',
    point_name: t.point_name || '',
    line_no: t.line_no || '',
    sinker_g: t.sinker_g || '',
    fishfinder_depth_m: t.fishfinder_depth_m || t.fishfinder_m || '',
    water_temp_c: t.water_temp_c || '',
    weather: t.weather || '',
    wind: t.wind || '',
    memo: t.memo || ''
  };
}
async function maybeAutoLink() {
  if (autoLinkStarted) return;
  if (qs.get('autolink') !== '1') {
    setPill('autoBadge', '待機');
    $('autoStatus').textContent = '通常起動時は自動連携しません。';
    return;
  }
  if (!picoBase()) {
    setPill('autoBadge', 'Pico未設定', 'bad');
    $('autoStatus').textContent = 'autolink=1ですがPico Wアドレスがありません。';
    return;
  }
  if (!currentPos) return;
  autoLinkStarted = true;
  setPill('autoBadge', '自動連携', 'warn');
  $('autoStatus').textContent = '現在地を取得したので、Pico W /logへ地点情報を渡します。';
  await sendMaplinkToPico(false);
}
function decodePayload(raw) {
  if (!raw) return null;
  const tries = [];
  try { tries.push(decodeURIComponent(raw)); } catch (e) {}
  tries.push(raw);
  for (const s of tries) {
    try { return JSON.parse(s); } catch (e) {}
    try { return JSON.parse(atob(s)); } catch (e) {}
  }
  return null;
}
function normalizeSummary(d) {
  if (!d || typeof d !== 'object') return null;
  const s = d.summary && typeof d.summary === 'object' ? d.summary : d;
  return {
    ...s,
    sid: s.sid || s.pico_sid || d.sid || '',
    fish_count: s.fish_count ?? s.fish ?? d.fish_count ?? d.fish,
    mark_count: s.mark_count ?? s.mark ?? d.mark_count ?? d.mark,
    tlog_count: s.tlog_count ?? s.log_count ?? s.logs ?? d.tlog_count ?? d.log_count,
    synced_ms: nowMs()
  };
}
async function handleHash() {
  const h = (location.hash || '').replace(/^#/, '');
  if (!h) return;
  const hp = new URLSearchParams(h);
  const logsyncRaw = hp.get('logsync') || hp.get('log') || hp.get('summary');
  if (!logsyncRaw) return;
  const payload = decodePayload(logsyncRaw);
  const summary = normalizeSummary(payload);
  if (!summary) {
    setPill('logsyncBadge', '同期失敗', 'bad');
    $('logsyncView').textContent = 'logsyncデータを読み取れませんでした。';
    return;
  }
  await metaSet('last_logsync', summary);
  await applyLogsync(summary);
  history.replaceState(null, '', `${location.pathname}${location.search}`);
}
async function applyLogsync(summary) {
  let trips = await getAllTrips();
  const sid = String(summary.sid || '');
  let target = null;
  if (sid) {
    target = trips.find((t) => String(t.pico_sid || '') === sid || String((t.pico_summary && t.pico_summary.sid) || '') === sid);
  }
  const pending = await metaGet('pending_maplink');
  if (!target && pending && validLatLng(Number(pending.lat), Number(pending.lng))) {
    target = trips.find((t) => pending.source && pending.source.trip_id && t.trip_id === pending.source.trip_id);
    if (!target) {
      const now = nowMs();
      target = {
        trip_id: pending.trip_id || genId('T'),
        date_ms: Number(pending.date_ms || now),
        lat: Number(pending.lat),
        lng: Number(pending.lng),
        accuracy_m: Number(pending.accuracy_m || 0),
        location_time_ms: Number(pending.location_time_ms || now),
        lake_name: pending.lake_name || '',
        point_name: pending.point_name || '',
        line_no: pending.line_no || '',
        sinker_g: pending.sinker_g || '',
        fishfinder_depth_m: pending.fishfinder_depth_m || '',
        water_temp_c: pending.water_temp_c || '',
        weather: pending.weather || '',
        wind: pending.wind || '',
        memo: pending.memo || '',
        created_ms: now,
        updated_ms: now
      };
    }
  }
  if (!target && selectedTripId) {
    target = trips.find((t) => t.trip_id === selectedTripId);
  }
  if (!target && currentPos) {
    const now = nowMs();
    target = {
      trip_id: genId('T'),
      date_ms: now,
      lat: Number(currentPos.lat),
      lng: Number(currentPos.lng),
      accuracy_m: Number(currentPos.acc || 0),
      location_time_ms: Number(currentPos.t || now),
      created_ms: now,
      updated_ms: now
    };
  }
  if (target) {
    target.pico_sid = summary.sid || target.pico_sid || '';
    target.pico_summary = summary;
    target.pico_logs = Array.isArray(target.pico_logs) ? target.pico_logs.concat([summary]).slice(-10) : [summary];
    target.updated_ms = nowMs();
    await putTrip(target);
    selectedTripId = target.trip_id;
  }
  setPill('logsyncBadge', '同期済み', 'good');
  $('logsyncView').className = 'detail';
  $('logsyncView').innerHTML = picoSummaryHtml(summary);
  await refreshAll();
  if (target) await selectTrip(target.trip_id);
}

function initEvents() {
  $('btnBackLog').addEventListener('click', () => openPico('/log'));
  $('btnBackRemote').addEventListener('click', () => openPico('/remote'));
  $('picoIp').addEventListener('change', () => { setPicoUi(); });
  $('btnLocate').addEventListener('click', locate);
  $('btnFitAll').addEventListener('click', fitAll);
  $('btnFitNear').addEventListener('click', fitNear);
  $('btnSaveScroll').addEventListener('click', () => $('savePanel').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  $('btnLinkPico').addEventListener('click', () => sendMaplinkToPico(true));
  $('sortMode').addEventListener('change', renderAllHistory);
  $('btnSaveTrip').addEventListener('click', saveTrip);
  $('btnLoadSelected').addEventListener('click', () => loadToForm(selectedTripId));
  $('btnUpdateTrip').addEventListener('click', updateTrip);
  $('btnClearForm').addEventListener('click', clearForm);
}
async function boot() {
  document.title = 'Wakasagi Map v11.9 Senior UI';
  setPicoUi();
  initEvents();
  clearForm();
  db = await openDb();
  await migrateOld(false);
  ensureMap();
  await handleHash();
  await refreshAll();
  const last = await metaGet('last_logsync');
  if (last) {
    $('logsyncView').className = 'detail';
    $('logsyncView').innerHTML = picoSummaryHtml(last);
    setPill('logsyncBadge', '前回同期', 'warn');
  }
  if (qs.get('autolink') === '1') {
    setPill('autoBadge', '現在地待ち', 'warn');
    $('autoStatus').textContent = 'autolink=1です。現在地取得後、自動でPico W /logへ連携します。';
    locate();
  } else {
    const lastPos = await metaGet('last_pos');
    if (lastPos && validLatLng(Number(lastPos.lat), Number(lastPos.lng))) {
      $('locStatus').textContent = '前回位置があります。必要なら「現在地」を押してください。';
      $('latView').textContent = Number(lastPos.lat).toFixed(7);
      $('lngView').textContent = Number(lastPos.lng).toFixed(7);
      $('accView').textContent = lastPos.acc ? `±${Math.round(lastPos.acc)}m` : '-';
      $('timeView').textContent = fmtTime(lastPos.t);
      setPill('locBadge', '前回位置', 'warn');
    }
  }
}
window.WKM = { selectTrip, showGroupDateList, refreshAll };
window.addEventListener('load', () => boot().catch((e) => {
  console.error(e);
  const m = $('map');
  if (m) m.innerHTML = '<div class="mapLoading error">起動エラーが発生しました。</div>';
}));
