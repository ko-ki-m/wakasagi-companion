'use strict';

const DB_NAME = 'wakasa_companion_v2';
const DB_VER = 2;
const STORE_SPOTS = 'fishing_spots';
const STORE_META = 'meta';
const SAME_POINT_M = 20;
const SAME_AREA_M = 100;
const DEFAULT_CENTER = [36.2048, 138.2529];

let db = null;
let currentPos = null;
let map = null;
let mapReady = false;
let currentMarker = null;
let accuracyCircle = null;
let spotLayer = null;
let selectedSpotId = null;

const $ = (id) => document.getElementById(id);

function nowMs(){ return Date.now(); }
function fmtTime(ms){
  if(!ms) return '-';
  const d = new Date(Number(ms));
  if(Number.isNaN(d.getTime())) return '-';
  const z = (n) => String(n).padStart(2,'0');
  return `${d.getFullYear()}/${z(d.getMonth()+1)}/${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
}
function genId(prefix){
  const r = Math.floor(Math.random()*0xfffff).toString(16).padStart(5,'0');
  return `${prefix}${Date.now().toString(36)}${r}`;
}
function validLatLng(lat,lng){
  return Number.isFinite(lat) && Number.isFinite(lng) && lat>=-90 && lat<=90 && lng>=-180 && lng<=180;
}
function haversineMeters(lat1,lng1,lat2,lng2){
  const R=6371008.8, toRad=(v)=>v*Math.PI/180;
  const p1=toRad(lat1), p2=toRad(lat2), dp=toRad(lat2-lat1), dl=toRad(lng2-lng1);
  const a=Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function escapeHtml(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function setBadge(id,text,cls){
  const el=$(id);
  if(!el) return;
  el.textContent=text;
  el.className='pill '+(cls||'');
}
function setMapStatus(text, cls){
  $('mapStatus').textContent = text;
  setBadge('mapBadge', cls === 'good' ? '表示中' : cls === 'bad' ? 'エラー' : '準備中', cls || 'warn');
}

function openDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded=()=>{
      const d=req.result;
      if(!d.objectStoreNames.contains(STORE_SPOTS)){
        const st=d.createObjectStore(STORE_SPOTS,{keyPath:'spot_id'});
        st.createIndex('start_ms','start_ms',{unique:false});
      }
      if(!d.objectStoreNames.contains(STORE_META)){
        d.createObjectStore(STORE_META,{keyPath:'key'});
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
function metaSet(key,value){
  return new Promise((resolve)=>{
    const tx=db.transaction(STORE_META,'readwrite');
    tx.objectStore(STORE_META).put({key,value});
    tx.oncomplete=()=>resolve(true); tx.onerror=()=>resolve(false);
  });
}
function metaGet(key){
  return new Promise((resolve)=>{
    const tx=db.transaction(STORE_META,'readonly');
    const r=tx.objectStore(STORE_META).get(key);
    r.onsuccess=()=>resolve(r.result?r.result.value:null);
    r.onerror=()=>resolve(null);
  });
}
function getAll(storeName){
  return new Promise((resolve)=>{
    const tx=db.transaction(storeName,'readonly');
    const r=tx.objectStore(storeName).getAll();
    r.onsuccess=()=>resolve(r.result||[]);
    r.onerror=()=>resolve([]);
  });
}
function getAllSpots(){ return getAll(STORE_SPOTS); }
function putSpot(spot){
  return new Promise((resolve)=>{
    const tx=db.transaction(STORE_SPOTS,'readwrite');
    tx.objectStore(STORE_SPOTS).put(spot);
    tx.oncomplete=()=>resolve(true); tx.onerror=()=>resolve(false);
  });
}
function deleteSpot(spotId){
  return new Promise((resolve)=>{
    const tx=db.transaction(STORE_SPOTS,'readwrite');
    tx.objectStore(STORE_SPOTS).delete(spotId);
    tx.oncomplete=()=>resolve(true); tx.onerror=()=>resolve(false);
  });
}
function clearDb(){
  return new Promise((resolve)=>{
    const tx=db.transaction([STORE_SPOTS,STORE_META],'readwrite');
    tx.objectStore(STORE_SPOTS).clear();
    tx.objectStore(STORE_META).clear();
    tx.oncomplete=()=>resolve(true); tx.onerror=()=>resolve(false);
  });
}
function importSpots(spots){
  return new Promise((resolve)=>{
    const tx=db.transaction(STORE_SPOTS,'readwrite');
    const st=tx.objectStore(STORE_SPOTS);
    let count=0;
    for(const s of spots){
      if(!s || !s.spot_id) continue;
      const lat=Number(s.lat), lng=Number(s.lng);
      if(!validLatLng(lat,lng)) continue;
      st.put({...s, lat, lng, updated_ms: Number(s.updated_ms||s.start_ms||nowMs())});
      count++;
    }
    tx.oncomplete=()=>resolve(count);
    tx.onerror=()=>resolve(-1);
  });
}
function downloadBlob(name,type,text){
  const blob=new Blob([text],{type});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=name;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);
}

function updateSecureBadge(){
  const b=$('secureBadge');
  if(window.isSecureContext){ b.textContent='GPS可'; b.className='badge good'; }
  else{ b.textContent='HTTPS必要'; b.className='badge bad'; }
}
function updateStorageBadge(){
  const b=$('storageBadge');
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if(standalone){ b.textContent='固定起動中'; b.className='pill good'; }
  else{ b.textContent='ブラウザ起動'; b.className='pill warn'; }
}

function ensureMap(){
  if(mapReady) return true;
  if(!window.L){
    setMapStatus('地図ライブラリを読み込めません。通信状態を確認してください。','bad');
    return false;
  }
  map = L.map('map', { zoomControl: true }).setView(DEFAULT_CENTER, 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  spotLayer = L.layerGroup().addTo(map);
  mapReady = true;
  setMapStatus('現在地取得待ち','warn');
  return true;
}
function setCurrentOnMap(pos){
  if(!ensureMap()) return;
  const lat=Number(pos.lat), lng=Number(pos.lng), acc=Number(pos.acc||0);
  if(!validLatLng(lat,lng)) return;
  if(currentMarker) currentMarker.remove();
  if(accuracyCircle) accuracyCircle.remove();
  currentMarker=L.marker([lat,lng]).addTo(map).bindPopup('現在地');
  if(acc > 0){
    accuracyCircle=L.circle([lat,lng], {radius: acc}).addTo(map);
  }
  map.setView([lat,lng],19);
  $('btnCenter').disabled=false;
  setMapStatus('現在地を中心に表示しています。','good');
}
function spotTitle(s){ return s.point_name || s.lake_name || '釣行ポイント'; }
function spotSub(s){
  return `ライン ${escapeHtml(s.line_no||'-')} / シンカー ${escapeHtml(s.sinker_g||'-')}g / 魚探 ${escapeHtml(s.fishfinder_depth_m||'-')}m / 水温 ${escapeHtml(s.water_temp_c||'-')}℃`;
}
function spotPopupHtml(s, distanceText=''){
  return `<div class="popup-title">${escapeHtml(spotTitle(s))}</div>
    <div class="popup-meta">${escapeHtml(fmtTime(s.start_ms))}${distanceText ? '<br>'+escapeHtml(distanceText) : ''}</div>
    <div class="popup-meta">${spotSub(s)}</div>
    <a class="popup-btn" href="#" data-spot-id="${escapeHtml(s.spot_id)}">詳細表示</a>`;
}
async function renderMapSpots(listOverride=null){
  if(!ensureMap()) return;
  if(spotLayer) spotLayer.clearLayers();
  const spots = listOverride || await getAllSpots();
  for(const s of spots){
    const lat=Number(s.lat), lng=Number(s.lng);
    if(!validLatLng(lat,lng)) continue;
    let distanceText='';
    if(currentPos){
      distanceText=`現在地から ${Math.round(haversineMeters(Number(currentPos.lat),Number(currentPos.lng),lat,lng))}m`;
    }
    const marker=L.circleMarker([lat,lng],{
      radius: selectedSpotId===s.spot_id ? 10 : 7,
      weight: selectedSpotId===s.spot_id ? 3 : 2,
      fillOpacity: .75
    }).addTo(spotLayer);
    marker.bindPopup(spotPopupHtml(s,distanceText));
    marker.on('click',()=>selectSpot(s.spot_id));
  }
}

function updatePositionView(pos){
  const lat=Number(pos.lat), lng=Number(pos.lng), acc=Number(pos.acc||0), t=Number(pos.t||nowMs());
  currentPos={lat,lng,acc,t};
  $('latView').textContent=lat.toFixed(7);
  $('lngView').textContent=lng.toFixed(7);
  $('accView').textContent=acc?`±${Math.round(acc)}m`:'-';
  $('timeView').textContent=fmtTime(t);
  $('locStatus').textContent='現在地を確認しました。';
  setBadge('locBadge','取得済み',acc>0&&acc<=20?'good':'warn');
  $('btnStdMap').disabled=false;
  $('btnSavePoint').disabled=false;
  metaSet('last_pos', currentPos);
  setCurrentOnMap(currentPos);
  refreshNearby();
}
function onGeoSuccess(geo){
  const c=geo.coords;
  const lat=Number(c.latitude), lng=Number(c.longitude), acc=Number(c.accuracy||0), t=Number(geo.timestamp||nowMs());
  if(!validLatLng(lat,lng)){
    $('locStatus').textContent='現在地の緯度経度が不正です。';
    setBadge('locBadge','不正','bad');
    return;
  }
  updatePositionView({lat,lng,acc,t});
}
async function onGeoError(err){
  $('locStatus').textContent = err && err.message ? err.message : '現在地を取得できませんでした。';
  setBadge('locBadge','未取得','bad');
  setMapStatus('現在地取得に失敗しました。','bad');
  const last=await metaGet('last_pos');
  if(last && validLatLng(Number(last.lat),Number(last.lng))){
    currentPos=last;
    $('latView').textContent=Number(last.lat).toFixed(7);
    $('lngView').textContent=Number(last.lng).toFixed(7);
    $('accView').textContent=last.acc?`±${Math.round(last.acc)}m`:'-';
    $('timeView').textContent=fmtTime(last.t);
    $('locStatus').textContent='現在地は取得できません。前回取得位置を表示しています。';
    setBadge('locBadge','前回位置','warn');
    $('btnStdMap').disabled=false;
    $('btnSavePoint').disabled=false;
    setCurrentOnMap(currentPos);
    refreshNearby();
  }
}
function locate(){
  if(!('geolocation' in navigator)){
    $('locStatus').textContent='このスマホ/ブラウザは現在地取得に対応していません。';
    setBadge('locBadge','非対応','bad');
    setMapStatus('現在地取得非対応','bad');
    return;
  }
  $('locStatus').textContent='現在地を取得しています...';
  setBadge('locBadge','取得中','warn');
  setMapStatus('現在地を取得しています...','warn');
  navigator.geolocation.getCurrentPosition(onGeoSuccess,onGeoError,{enableHighAccuracy:true,timeout:15000,maximumAge:10000});
}

async function refreshNearby(){
  if(!currentPos){
    await updateDbView();
    await renderMapSpots();
    return;
  }
  const spots=await getAllSpots();
  const list=spots.map(s=>{
    const d=haversineMeters(Number(currentPos.lat),Number(currentPos.lng),Number(s.lat),Number(s.lng));
    return {...s,distance_m:d};
  }).sort((a,b)=>a.distance_m-b.distance_m);

  const within20=list.filter(s=>s.distance_m<=SAME_POINT_M);
  const within100=list.filter(s=>s.distance_m<=SAME_AREA_M);

  $('count20').textContent=String(within20.length);
  $('count100').textContent=String(within100.length);

  if(within20.length>0){
    setBadge('nearBadge','過去あり','good');
    $('nearSummary').textContent=`このポイントでは過去 ${within20.length} 回、100m圏内では ${within100.length} 回の釣行があります。`;
  }else if(within100.length>0){
    setBadge('nearBadge','近くに過去あり','warn');
    $('nearSummary').textContent=`このポイント自体は初回ですが、100m圏内に過去 ${within100.length} 回の釣行があります。`;
  }else{
    setBadge('nearBadge','初回','');
    $('nearSummary').textContent='この周辺では初回の釣行です。ここからこの場所の記憶を作ります。';
  }

  renderNearbyList(within100.slice(0,10));
  await renderMapSpots(list);
  await updateDbView();
}
function renderNearbyList(items){
  const box=$('nearList');
  box.innerHTML='';
  for(const s of items){
    const div=document.createElement('div');
    div.className='item'+(selectedSpotId===s.spot_id?' selected':'');
    const dist=Math.round(s.distance_m);
    div.innerHTML=`<div class="top"><span>${escapeHtml(spotTitle(s))}</span><span>${dist}m</span></div>
      <div class="body">${escapeHtml(fmtTime(s.start_ms))}<br>${spotSub(s)}<br>${escapeHtml(s.memo||'')}</div>
      <button type="button" data-spot-id="${escapeHtml(s.spot_id)}">詳細表示</button>`;
    div.querySelector('button').addEventListener('click',()=>selectSpot(s.spot_id));
    box.appendChild(div);
  }
}
function readInfo(){
  return {
    lake_name:$('lakeName').value.trim(),
    point_name:$('pointName').value.trim(),
    line_no:$('lineNo').value.trim(),
    sinker_g:$('sinkerG').value.trim(),
    fishfinder_depth_m:$('fishfinderM').value.trim(),
    water_temp_c:$('waterTempC').value.trim(),
    memo:$('memo').value.trim()
  };
}
async function saveCurrentPoint(){
  if(!currentPos){ alert('現在地がありません。先に現在地を取得してください。'); return; }
  const now=nowMs(), info=readInfo();
  const spot={
    spot_id:genId('P'), start_ms:now, updated_ms:now,
    lat:Number(currentPos.lat), lng:Number(currentPos.lng),
    accuracy_m:Number(currentPos.acc||0), location_time_ms:Number(currentPos.t||now),
    source:currentPos.acc?'gps':'cached_gps',
    lake_name:info.lake_name, point_name:info.point_name, line_no:info.line_no,
    sinker_g:info.sinker_g, fishfinder_depth_m:info.fishfinder_depth_m,
    water_temp_c:info.water_temp_c, memo:info.memo
  };
  if(!await putSpot(spot)){ alert('ポイント保存に失敗しました。'); return; }
  setBadge('saveBadge','保存済み','good');
  selectedSpotId=spot.spot_id;
  await selectSpot(spot.spot_id);
  await refreshNearby();
}
async function selectSpot(spotId){
  selectedSpotId=spotId;
  const spots=await getAllSpots();
  const s=spots.find(x=>x.spot_id===spotId);
  if(!s) return;
  const lat=Number(s.lat), lng=Number(s.lng);
  let dist='-';
  if(currentPos && validLatLng(lat,lng)){
    dist=`${Math.round(haversineMeters(Number(currentPos.lat),Number(currentPos.lng),lat,lng))}m`;
  }
  $('selectedView').innerHTML=`${escapeHtml(spotTitle(s))}<br><code>${escapeHtml(s.spot_id)}</code>`;
  setBadge('selectedBadge','選択中','good');
  $('selectedDetail').innerHTML=`<div class="kv">
    <b>日付</b><span>${escapeHtml(fmtTime(s.start_ms))}</span>
    <b>距離</b><span>${escapeHtml(dist)}</span>
    <b>座標</b><span>${Number(s.lat).toFixed(7)}, ${Number(s.lng).toFixed(7)}</span>
    <b>ライン</b><span>${escapeHtml(s.line_no||'-')}</span>
    <b>シンカー</b><span>${escapeHtml(s.sinker_g||'-')}g</span>
    <b>魚探水深</b><span>${escapeHtml(s.fishfinder_depth_m||'-')}m</span>
    <b>水温</b><span>${escapeHtml(s.water_temp_c||'-')}℃</span>
    <b>メモ</b><span>${escapeHtml(s.memo||'-')}</span>
  </div>
  <div class="actions">
    <button type="button" id="btnSelectedMap">標準地図で確認</button>
    <button type="button" id="btnDeleteSpot" class="danger">このポイントを削除</button>
  </div>`;
  $('btnSelectedMap').addEventListener('click',()=>openStandardMapFor(lat,lng));
  $('btnDeleteSpot').addEventListener('click',async()=>{
    if(!confirm('このポイントを削除しますか？')) return;
    await deleteSpot(s.spot_id);
    selectedSpotId=null;
    $('selectedView').textContent='地図上のピン、または過去釣行一覧を選択してください。';
    setBadge('selectedBadge','未選択','');
    $('selectedDetail').innerHTML='';
    await refreshNearby();
  });
  if(map && validLatLng(lat,lng)) map.setView([lat,lng],18);
  await renderMapSpots();
  await updateDbView();
}
function openStandardMapFor(lat,lng){
  window.open(`https://www.google.com/maps/search/?api=1&query=${Number(lat).toFixed(7)},${Number(lng).toFixed(7)}`,'_blank','noopener');
}
function openStandardMap(){
  if(!currentPos) return;
  openStandardMapFor(currentPos.lat,currentPos.lng);
}
function centerCurrent(){
  if(!currentPos) return;
  setCurrentOnMap(currentPos);
}
async function exportDb(){
  const spots=await getAllSpots();
  downloadBlob(`wakasa_map_points_${nowMs()}.json`,'application/json',JSON.stringify({exported_ms:nowMs(),version:5,spots},null,2));
}
async function importDbFromFile(file){
  const text = await file.text();
  let payload;
  try{ payload=JSON.parse(text); }catch(e){ alert('JSONを読めません。'); return; }
  const spots = Array.isArray(payload) ? payload : payload.spots;
  if(!Array.isArray(spots)){ alert('spots配列がありません。'); return; }
  const countS = await importSpots(spots);
  if(countS < 0){ alert('読み込みに失敗しました。'); return; }
  alert(`${countS}ポイントを読み込みました。`);
  await refreshNearby();
}
async function updateDbView(){
  const spots=await getAllSpots();
  $('dbView').textContent=`保存済み釣行ポイント：${spots.length} 件`;
  await renderAllSpotList(spots);
}
async function renderAllSpotList(spotsArg=null){
  const spots=(spotsArg || await getAllSpots()).slice().sort((a,b)=>Number(b.start_ms||0)-Number(a.start_ms||0));
  const box=$('allSpotList');
  box.innerHTML='';
  for(const s of spots.slice(0,50)){
    const div=document.createElement('div');
    div.className='item'+(selectedSpotId===s.spot_id?' selected':'');
    let dist='';
    if(currentPos){
      dist=` / ${Math.round(haversineMeters(Number(currentPos.lat),Number(currentPos.lng),Number(s.lat),Number(s.lng)))}m`;
    }
    div.innerHTML=`<div class="top"><span>${escapeHtml(spotTitle(s))}</span><span>${escapeHtml(fmtTime(s.start_ms))}${escapeHtml(dist)}</span></div>
      <div class="body">${spotSub(s)}<br>${escapeHtml(s.memo||'')}</div>
      <button type="button" data-spot-id="${escapeHtml(s.spot_id)}">詳細表示</button>`;
    div.querySelector('button').addEventListener('click',()=>selectSpot(s.spot_id));
    box.appendChild(div);
  }
}
async function initPwa(){
  if('serviceWorker' in navigator){
    try{ await navigator.serviceWorker.register('./service-worker.js'); }catch(e){}
  }
}
async function init(){
  updateSecureBadge();
  updateStorageBadge();
  db=await openDb();
  ensureMap();

  $('btnLocate').addEventListener('click',locate);
  $('btnCenter').addEventListener('click',centerCurrent);
  $('btnStdMap').addEventListener('click',openStandardMap);
  $('btnSavePoint').addEventListener('click',saveCurrentPoint);
  $('btnExport').addEventListener('click',exportDb);
  $('btnImport').addEventListener('click',()=>$('importFile').click());
  $('importFile').addEventListener('change',async(e)=>{
    const file=e.target.files && e.target.files[0];
    if(file) await importDbFromFile(file);
    e.target.value='';
  });
  $('btnClearDb').addEventListener('click',async()=>{
    if(!confirm('テストDBを消去します。よろしいですか？')) return;
    await clearDb();
    location.reload();
  });

  document.addEventListener('click',(ev)=>{
    const link=ev.target.closest('[data-spot-id]');
    if(!link) return;
    ev.preventDefault();
    selectSpot(link.getAttribute('data-spot-id'));
  });

  await initPwa();
  await updateDbView();
  await renderMapSpots();

  const last=await metaGet('last_pos');
  if(last && validLatLng(Number(last.lat),Number(last.lng))){
    updatePositionView(last);
    $('locStatus').textContent='前回取得位置を表示しています。現在地を更新できます。';
    setBadge('locBadge','前回位置','warn');
  }

  locate();
}
window.addEventListener('load',()=>init().catch((e)=>{
  $('locStatus').textContent='初期化に失敗しました: '+(e&&e.message?e.message:e);
  setBadge('locBadge','エラー','bad');
  setMapStatus('初期化失敗','bad');
}));
