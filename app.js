'use strict';

const DB_NAME = 'wakasa_companion_v2';
const DB_VER = 1;
const STORE_SPOTS = 'fishing_spots';
const STORE_META = 'meta';
const SAME_POINT_M = 20;
const SAME_AREA_M = 100;

let db = null;
let currentPos = null;
let currentSession = null;

const $ = (id) => document.getElementById(id);

function nowMs(){ return Date.now(); }
function fmtTime(ms){
  if(!ms) return '-';
  const d = new Date(ms);
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
  return String(s).replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function setBadge(id,text,cls){
  const el=$(id); el.textContent=text; el.className='pill '+(cls||'');
}

function openDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded=()=>{
      const d=req.result;
      if(!d.objectStoreNames.contains(STORE_SPOTS)){
        const st=d.createObjectStore(STORE_SPOTS,{keyPath:'spot_id'});
        st.createIndex('sid','sid',{unique:false});
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
function getAllSpots(){
  return new Promise((resolve)=>{
    const tx=db.transaction(STORE_SPOTS,'readonly');
    const r=tx.objectStore(STORE_SPOTS).getAll();
    r.onsuccess=()=>resolve(r.result||[]);
    r.onerror=()=>resolve([]);
  });
}
function putSpot(spot){
  return new Promise((resolve)=>{
    const tx=db.transaction(STORE_SPOTS,'readwrite');
    tx.objectStore(STORE_SPOTS).put(spot);
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
      if(!validLatLng(Number(s.lat), Number(s.lng))) continue;
      st.put(s);
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
  $('btnStart').disabled=false;
  metaSet('last_pos', currentPos);
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
    $('btnStart').disabled=false;
    refreshNearby();
  }
}
function locate(){
  if(!('geolocation' in navigator)){
    $('locStatus').textContent='このスマホ/ブラウザは現在地取得に対応していません。';
    setBadge('locBadge','非対応','bad');
    return;
  }
  $('locStatus').textContent='現在地を取得しています...';
  setBadge('locBadge','取得中','warn');
  navigator.geolocation.getCurrentPosition(onGeoSuccess,onGeoError,{enableHighAccuracy:true,timeout:15000,maximumAge:10000});
}

async function refreshNearby(){
  if(!currentPos) return;
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

  renderNearbyList(within100.slice(0,5));
  updateDbView();
}
function renderNearbyList(items){
  const box=$('nearList');
  box.innerHTML='';
  for(const s of items){
    const div=document.createElement('div');
    div.className='item';
    const title=s.point_name||s.lake_name||'過去ポイント';
    const date=fmtTime(s.start_ms);
    const dist=Math.round(s.distance_m);
    div.innerHTML=`<div class="top"><span>${escapeHtml(title)}</span><span>${dist}m</span></div>
      <div class="body">${date}<br>
      ライン ${escapeHtml(s.line_no||'-')} / シンカー ${escapeHtml(s.sinker_g||'-')}g /
      魚探 ${escapeHtml(s.fishfinder_depth_m||'-')}m / 水温 ${escapeHtml(s.water_temp_c||'-')}℃</div>`;
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
async function startFishingHere(){
  if(!currentPos){ alert('現在地がありません。先に現在地を取得してください。'); return; }
  const now=nowMs(), sid=genId('S'), spot_id=genId('P'), info=readInfo();
  const spot={
    spot_id,sid,start_ms:now,end_ms:0,
    lat:Number(currentPos.lat),lng:Number(currentPos.lng),
    accuracy_m:Number(currentPos.acc||0),location_time_ms:Number(currentPos.t||now),
    source:currentPos.acc?'gps':'cached_gps',
    lake_name:info.lake_name,point_name:info.point_name,line_no:info.line_no,
    sinker_g:info.sinker_g,fishfinder_depth_m:info.fishfinder_depth_m,
    water_temp_c:info.water_temp_c,memo:info.memo,
    hit_count:0,created_ms:now,updated_ms:now
  };
  if(!await putSpot(spot)){ alert('釣行ポイントの保存に失敗しました。'); return; }
  currentSession={sid,spot_id,start_ms:now};
  await metaSet('current_session',currentSession);
  $('sessionView').innerHTML=`開始しました。<br><code>sid=${escapeHtml(sid)}</code><br><code>spot=${escapeHtml(spot_id)}</code>`;
  await refreshNearby();
}
function openStandardMap(){
  if(!currentPos) return;
  const lat=Number(currentPos.lat).toFixed(7), lng=Number(currentPos.lng).toFixed(7);
  window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,'_blank','noopener');
}
async function exportDb(){
  const spots=await getAllSpots();
  downloadBlob(`wakasa_spots_${nowMs()}.json`,'application/json',JSON.stringify({exported_ms:nowMs(),version:2,spots},null,2));
}
async function importDbFromFile(file){
  const text = await file.text();
  let payload;
  try{ payload=JSON.parse(text); }catch(e){ alert('JSONを読めません。'); return; }
  const spots = Array.isArray(payload) ? payload : payload.spots;
  if(!Array.isArray(spots)){ alert('spots配列がありません。'); return; }
  const count = await importSpots(spots);
  if(count < 0){ alert('読み込みに失敗しました。'); return; }
  alert(`${count}件を読み込みました。`);
  await updateDbView();
  await refreshNearby();
}
async function restoreCurrentSession(){
  const s=await metaGet('current_session');
  if(s&&s.sid&&s.spot_id){
    currentSession=s;
    $('sessionView').innerHTML=`開始済みです。<br><code>sid=${escapeHtml(s.sid)}</code><br><code>spot=${escapeHtml(s.spot_id)}</code>`;
  }
}
async function updateDbView(){
  const spots=await getAllSpots();
  $('dbView').textContent=`保存済み釣行ポイント：${spots.length} 件`;
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

  $('btnLocate').addEventListener('click',locate);
  $('btnStdMap').addEventListener('click',openStandardMap);
  $('btnStart').addEventListener('click',startFishingHere);
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

  await initPwa();
  await restoreCurrentSession();
  await updateDbView();

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
}));
