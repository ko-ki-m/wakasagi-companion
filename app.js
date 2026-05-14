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

let db=null, map=null, groupLayer=null;
let currentPos=null, currentMarker=null, accCircle=null, cur20=null, cur100=null, sel20=null, sel100=null;
let groups=[], selectedGroupId=null, selectedTripId=null, editingTripId=null;
let allHistoryExpanded=false;
let initialLakeViewDone=false;

const $=(id)=>document.getElementById(id);
function nowMs(){return Date.now();}
function pad(n){return String(n).padStart(2,'0');}
function fmtTime(ms){const n=Number(ms||0); if(!n)return '-'; const d=new Date(n); if(Number.isNaN(d.getTime()))return '-'; return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;}
function toLocal(ms){const d=new Date(Number(ms||nowMs())); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;}
function fromLocal(v){const n=new Date(v||'').getTime(); return Number.isFinite(n)?n:nowMs();}
function genId(p){return `${p}${Date.now().toString(36)}${Math.floor(Math.random()*0xfffff).toString(16).padStart(5,'0')}`;}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function validLatLng(lat,lng){return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180;}
function dist(lat1,lng1,lat2,lng2){const R=6371008.8,r=v=>v*Math.PI/180;const p1=r(lat1),p2=r(lat2),dp=r(lat2-lat1),dl=r(lng2-lng1);const a=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}
function setBadge(id,text,cls=''){const el=$(id); if(!el)return; el.textContent=text; el.className=(id==='secureBadge'?'badge ':'pill ')+cls;}
function title(t){return t.point_name||t.lake_name||'釣行地点';}
function lat(t){return Number(t.lat);} function lng(t){return Number(t.lng);} function tms(t){return Number(t.date_ms||t.start_ms||t.created_ms||0);}
function sub(t){return `ライン ${esc(t.line_no||'-')} / シンカー ${esc(t.sinker_g||'-')}g / 魚探 ${esc(t.fishfinder_depth_m||'-')}m / 水温 ${esc(t.water_temp_c||'-')}℃`;}
function dCurrent(t){if(!currentPos)return null; return dist(Number(currentPos.lat),Number(currentPos.lng),lat(t),lng(t));}
function dBase(t,a,b){if(!validLatLng(Number(a),Number(b))||!validLatLng(lat(t),lng(t)))return null; return dist(Number(a),Number(b),lat(t),lng(t));}

function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VER);req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains(STORE_TRIPS)){const st=d.createObjectStore(STORE_TRIPS,{keyPath:'trip_id'});st.createIndex('date_ms','date_ms',{unique:false});}if(!d.objectStoreNames.contains(STORE_META))d.createObjectStore(STORE_META,{keyPath:'key'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
function st(name,mode='readonly'){return db.transaction(name,mode).objectStore(name);}
function getAllTrips(){return new Promise(res=>{const r=st(STORE_TRIPS).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>res([]);});}
function putTrip(t){return new Promise(res=>{const tx=db.transaction(STORE_TRIPS,'readwrite');tx.objectStore(STORE_TRIPS).put(t);tx.oncomplete=()=>res(true);tx.onerror=()=>res(false);});}
function delTrip(id){return new Promise(res=>{const tx=db.transaction(STORE_TRIPS,'readwrite');tx.objectStore(STORE_TRIPS).delete(id);tx.oncomplete=()=>res(true);tx.onerror=()=>res(false);});}
function metaGet(k){return new Promise(res=>{const r=st(STORE_META).get(k);r.onsuccess=()=>res(r.result?r.result.value:null);r.onerror=()=>res(null);});}
function metaSet(k,v){return new Promise(res=>{const tx=db.transaction(STORE_META,'readwrite');tx.objectStore(STORE_META).put({key:k,value:v});tx.oncomplete=()=>res(true);tx.onerror=()=>res(false);});}
function clearDb(){return new Promise(res=>{const tx=db.transaction([STORE_TRIPS,STORE_META],'readwrite');tx.objectStore(STORE_TRIPS).clear();tx.objectStore(STORE_META).clear();tx.oncomplete=()=>res(true);tx.onerror=()=>res(false);});}

function normalizeOld(s){const a=Number(s.lat),b=Number(s.lng); if(!validLatLng(a,b))return null;return{trip_id:s.trip_id||s.spot_id||genId('T'),migrated_from:s.spot_id||'',date_ms:Number(s.start_ms||s.created_ms||nowMs()),lat:a,lng:b,accuracy_m:Number(s.accuracy_m||0),location_time_ms:Number(s.location_time_ms||s.start_ms||nowMs()),lake_name:s.lake_name||'',point_name:s.point_name||'',line_no:s.line_no||'',sinker_g:s.sinker_g||'',fishfinder_depth_m:s.fishfinder_depth_m||s.fishfinder_m||'',water_temp_c:s.water_temp_c||'',weather:s.weather||'',wind:s.wind||'',memo:s.memo||'',created_ms:Number(s.created_ms||s.start_ms||nowMs()),updated_ms:Number(s.updated_ms||s.start_ms||nowMs())};}
function openOld(){return new Promise(res=>{const r=indexedDB.open(OLD_DB_NAME);r.onsuccess=()=>res(r.result);r.onerror=()=>res(null);r.onblocked=()=>res(null);});}
async function migrateOld(force=false){if(!force && await metaGet('old_migrated'))return 0;let old=await openOld();if(!old||!old.objectStoreNames.contains(OLD_STORE_SPOTS)){await metaSet('old_migrated',true);return 0;}const rows=await new Promise(res=>{const r=old.transaction(OLD_STORE_SPOTS,'readonly').objectStore(OLD_STORE_SPOTS).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>res([]);});let c=0;const cur=await getAllTrips();const exist=new Set(cur.map(x=>String(x.migrated_from||x.trip_id)));for(const row of rows){const t=normalizeOld(row);if(!t)continue;if(!force&&exist.has(String(t.migrated_from||t.trip_id)))continue;await putTrip(t);c++;}await metaSet('old_migrated',true);return c;}

function ensureMap(){if(map)return true;if(!window.L){$('mapStatus').textContent='地図ライブラリ未読込';return false;}map=L.map('map',{zoomControl:true}).setView(DEFAULT_CENTER,5);setTimeout(()=>{try{map.invalidateSize();}catch(e){}},100);setTimeout(()=>{try{map.invalidateSize();}catch(e){}},600);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);groupLayer=L.layerGroup().addTo(map);return true;}
function drawCurrent(zoomNow=false){if(!currentPos||!ensureMap())return;const a=Number(currentPos.lat),b=Number(currentPos.lng),acc=Number(currentPos.acc||0);[currentMarker,accCircle,cur20,cur100].forEach(x=>{if(x)x.remove();});currentMarker=L.marker([a,b]).addTo(map).bindPopup('現在地');if(acc>0)accCircle=L.circle([a,b],{radius:acc}).addTo(map);cur20=L.circle([a,b],{radius:SAME_POINT_M,weight:2,fillOpacity:.04}).addTo(map);cur100=L.circle([a,b],{radius:SAME_AREA_M,weight:2,fillOpacity:.015}).addTo(map);if(zoomNow)map.setView([a,b],19);setTimeout(()=>{try{map.invalidateSize();}catch(e){}},50);$('btnFitNear').disabled=false;$('btnSaveScroll').disabled=false;$('btnSaveTrip').disabled=false;}
function makeGroups(trips){const valid=trips.filter(x=>validLatLng(lat(x),lng(x))).slice().sort((a,b)=>tms(b)-tms(a));const gs=[];for(const t of valid){let best=null,bd=Infinity;for(const g of gs){const dd=dist(lat(t),lng(t),g.lat,g.lng);if(dd<=SAME_POINT_M&&dd<bd){best=g;bd=dd;}}if(best){best.trips.push(t);const n=best.trips.length;best.lat=(best.lat*(n-1)+lat(t))/n;best.lng=(best.lng*(n-1)+lng(t))/n;}else gs.push({group_id:'G'+gs.length+'_'+t.trip_id,lat:lat(t),lng:lng(t),trips:[t]});}for(const g of gs){g.trips.sort((a,b)=>tms(b)-tms(a));g.latest=g.trips[0];g.count=g.trips.length;g.distance_m=currentPos?dist(Number(currentPos.lat),Number(currentPos.lng),g.lat,g.lng):null;g.latest_ms=tms(g.latest);}return gs.sort((a,b)=>currentPos?((a.distance_m??Infinity)-(b.distance_m??Infinity)):(b.latest_ms-a.latest_ms));}
function markerClass(g){if(selectedGroupId===g.group_id)return'cluster selected';if(g.distance_m!==null&&g.distance_m<=SAME_POINT_M)return'cluster near20';if(g.distance_m!==null&&g.distance_m<=SAME_AREA_M)return'cluster near100';return'cluster';}
function popup(g){const trips=(g.trips||[]).slice().sort((a,b)=>tms(b)-tms(a));const dates=trips.map(t=>`<a class="popupBtn" href="#" data-popup-group-id="${esc(g.group_id)}" data-popup-trip-id="${esc(t.trip_id)}">${esc(fmtTime(tms(t)).split(' ')[0])}</a>`).join(' ');return`<div class="popupTitle">この地点の過去 ${g.count}回</div><div class="popupMeta">見たい日付を選択してください。</div>${dates||'<div class="popupMeta">履歴がありません。</div>'}`;}
function ensureFrontDetailBox(){let o=document.getElementById('frontTripDetailOverlay');if(o)return o;o=document.createElement('div');o.id='frontTripDetailOverlay';o.style.cssText='display:none;position:fixed;z-index:99999;left:10px;right:10px;top:10px;max-height:86vh;overflow:auto;background:#fff;color:#0f172a;border:3px solid #0b84ff;border-radius:18px;box-shadow:0 18px 60px rgba(0,0,0,.45);padding:14px;';document.body.appendChild(o);return o;}
function closeFrontTripDetail(){const o=document.getElementById('frontTripDetailOverlay');if(o)o.style.display='none';}
function showFrontTripDetail(t,base=null){const o=ensureFrontDetailBox();o.innerHTML=`<div class="cardHead"><div><h2>${esc(fmtTime(tms(t)).split(' ')[0])}　${esc(title(t))}</h2><p>この釣行回の詳細</p></div><button id="frontDetailClose" type="button">閉じる</button></div><div class="summaryBox" style="margin-top:10px">${detailHtml(t,base)}</div>`;o.style.display='block';const b=document.getElementById('frontDetailClose');if(b)b.onclick=closeFrontTripDetail;}
async function showPopupTripDetail(groupId,tripId,box){const trips=await getAllTrips();const t=trips.find(x=>String(x.trip_id)===String(tripId));if(!t)return;let g=(groups||[]).find(x=>String(x.group_id)===String(groupId));if(!g){g=(groups||[]).find(x=>(x.trips||[]).some(y=>String(y.trip_id)===String(tripId)))||null;}selectedTripId=t.trip_id;selectedGroupId=g?g.group_id:selectedGroupId;showTripDetail(t,g?{lat:g.lat,lng:g.lng}:null);showFrontTripDetail(t,g?{lat:g.lat,lng:g.lng}:null);try{if(map)map.closePopup();}catch(e){}}
function showPopupDateList(groupId,box){const g=(groups||[]).find(x=>String(x.group_id)===String(groupId));if(g&&box)box.innerHTML=popup(g);}

async function renderMap(){ensureMap();if(!groupLayer)return;groupLayer.clearLayers();const trips=await getAllTrips();groups=makeGroups(trips);for(const g of groups){const ic=L.divIcon({className:'',html:`<div class="${markerClass(g)}">${g.count}</div>`,iconSize:[38,38],iconAnchor:[19,19],popupAnchor:[0,-18]});L.marker([g.lat,g.lng],{icon:ic}).addTo(groupLayer).bindPopup(popup(g));}}

function updatePosition(pos,zoomNow=false,doInitialFit=true){currentPos={lat:Number(pos.lat),lng:Number(pos.lng),acc:Number(pos.acc||0),t:Number(pos.t||nowMs())};$('latView').textContent=currentPos.lat.toFixed(7);$('lngView').textContent=currentPos.lng.toFixed(7);$('accView').textContent=currentPos.acc?`±${Math.round(currentPos.acc)}m`:'-';$('timeView').textContent=fmtTime(currentPos.t);$('locStatus').textContent='現在地を確認しました。';setBadge('locBadge','取得済み',currentPos.acc>0&&currentPos.acc<=20?'good':'warn');metaSet('last_pos',currentPos);drawCurrent(zoomNow);refreshAll().then(()=>{if(doInitialFit)fitInitialLakeViewOnce(true);});}
function locate(manual=false){if(!window.isSecureContext){$('locStatus').textContent='HTTPSで開いていません。GitHub Pagesのhttps URLから開いてください。';setBadge('locBadge','HTTPS必要','bad');return;}if(!('geolocation'in navigator)){setBadge('locBadge','非対応','bad');return;}$('locStatus').textContent='現在地を取得しています...';setBadge('locBadge','取得中','warn');navigator.geolocation.getCurrentPosition(g=>{const c=g.coords;updatePosition({lat:Number(c.latitude),lng:Number(c.longitude),acc:Number(c.accuracy||0),t:Number(g.timestamp||nowMs())},manual,!manual);},async e=>{$('locStatus').textContent='現在地エラー: '+(e&&e.message?e.message:'取得できませんでした');setBadge('locBadge','未取得','bad');const last=await metaGet('last_pos');if(last&&validLatLng(Number(last.lat),Number(last.lng))){$('locStatus').textContent='前回位置を表示しています。';setBadge('locBadge','前回位置','warn');updatePosition(last,manual,!manual);}},{enableHighAccuracy:true,timeout:15000,maximumAge:10000});}
function readForm(){return{date_ms:fromLocal($('tripDate').value),lake_name:$('lakeName').value.trim(),point_name:$('pointName').value.trim(),line_no:$('lineNo').value.trim(),sinker_g:$('sinkerG').value.trim(),fishfinder_depth_m:$('fishfinderDepthM').value.trim(),water_temp_c:$('waterTempC').value.trim(),weather:$('weather').value.trim(),wind:$('wind').value.trim(),memo:$('memo').value.trim()};}
function fillForm(t){$('tripDate').value=toLocal(t.date_ms);$('lakeName').value=t.lake_name||'';$('pointName').value=t.point_name||'';$('lineNo').value=t.line_no||'';$('sinkerG').value=t.sinker_g||'';$('fishfinderDepthM').value=t.fishfinder_depth_m||'';$('waterTempC').value=t.water_temp_c||'';$('weather').value=t.weather||'';$('wind').value=t.wind||'';$('memo').value=t.memo||'';}
function clearForm(){editingTripId=null;$('tripDate').value=toLocal(nowMs());['lakeName','pointName','lineNo','sinkerG','fishfinderDepthM','waterTempC','weather','wind','memo'].forEach(id=>$(id).value='');$('btnUpdateTrip').disabled=true;setBadge('saveBadge','待機中','');}
async function saveTrip(){if(!currentPos){alert('現在地がありません。');return;}const f=readForm(),now=nowMs();const trips=await getAllTrips();const near=trips.filter(t=>dBase(t,currentPos.lat,currentPos.lng)!==null&&dBase(t,currentPos.lat,currentPos.lng)<=SAME_POINT_M);if(near.length>0&&!confirm(`20m以内に過去履歴が${near.length}件あります。この場所の新しい釣行回として保存しますか？`))return;const t={trip_id:genId('T'),...f,lat:Number(currentPos.lat),lng:Number(currentPos.lng),accuracy_m:Number(currentPos.acc||0),location_time_ms:Number(currentPos.t||now),created_ms:now,updated_ms:now};await putTrip(t);selectedTripId=t.trip_id;setBadge('saveBadge','保存済み','good');await refreshAll();await selectTrip(t.trip_id);}
async function updateTrip(){if(!editingTripId){alert('上書き対象がありません。');return;}const trips=await getAllTrips();const old=trips.find(x=>x.trip_id===editingTripId);if(!old)return;const t={...old,...readForm(),updated_ms:nowMs()};await putTrip(t);editingTripId=null;$('btnUpdateTrip').disabled=true;setBadge('saveBadge','上書き済み','good');await refreshAll();await selectTrip(t.trip_id);}

function detailHtml(t,base=null){let dd='-';if(base){const d=dBase(t,base.lat,base.lng);if(d!==null)dd=Math.round(d)+'m';}else if(currentPos){const d=dCurrent(t);if(d!==null)dd='現在地から '+Math.round(d)+'m';}return`<div class="kv"><b>日時</b><span>${esc(fmtTime(t.date_ms))}</span><b>距離</b><span>${esc(dd)}</span><b>湖名</b><span>${esc(t.lake_name||'-')}</span><b>ポイント名</b><span>${esc(t.point_name||'-')}</span><b>座標</b><span>${Number(t.lat).toFixed(7)}, ${Number(t.lng).toFixed(7)}</span><b>ライン</b><span>${esc(t.line_no||'-')}</span><b>シンカー</b><span>${esc(t.sinker_g||'-')}g</span><b>魚探水深</b><span>${esc(t.fishfinder_depth_m||'-')}m</span><b>水温</b><span>${esc(t.water_temp_c||'-')}℃</span><b>天気</b><span>${esc(t.weather||'-')}</span><b>風</b><span>${esc(t.wind||'-')}</span><b>メモ</b><span>${esc(t.memo||'-')}</span></div>`;}
function itemHtml(t,label,base,sel=false){const d=base?dBase(t,base.lat,base.lng):dCurrent(t);const cls=d!==null&&d<=SAME_POINT_M?' near20':(d!==null&&d<=SAME_AREA_M?' near100':'');return`<div class="item${sel?' selected':''}${cls}"><div class="top"><span>${esc(title(t))}</span><span>${esc(label)} ${d!==null?Math.round(d)+'m':''}</span></div><div class="body">${esc(fmtTime(tms(t)))}<br>${sub(t)}<br>${esc(t.memo||'')}</div><button data-trip-id="${esc(t.trip_id)}">この釣行回を表示</button></div>`;}
async function selectGroup(id){if(groups.length===0)groups=makeGroups(await getAllTrips());const g=groups.find(x=>x.group_id===id);if(!g)return;selectedGroupId=id;selectedTripId=g.latest.trip_id;await renderMap();renderPointHistory(g,g.latest.trip_id);showTripDetail(g.latest,{lat:g.lat,lng:g.lng});drawSelected(g.lat,g.lng);map.setView([g.lat,g.lng],18);}
async function selectTrip(id){const trips=await getAllTrips();const t=trips.find(x=>x.trip_id===id);if(!t)return;groups=makeGroups(trips);const g=groups.find(gr=>gr.trips.some(x=>x.trip_id===id))||{group_id:'single_'+id,lat:lat(t),lng:lng(t),trips:[t],latest:t,count:1};selectedGroupId=g.group_id;selectedTripId=id;await renderMap();renderPointHistory(g,id);showTripDetail(t,{lat:g.lat,lng:g.lng});drawSelected(g.lat,g.lng);map.setView([lat(t),lng(t)],18);}
function drawSelected(a,b){[sel20,sel100].forEach(x=>{if(x)x.remove();});sel20=L.circle([a,b],{radius:SAME_POINT_M,weight:3,fillOpacity:.045}).addTo(map);sel100=L.circle([a,b],{radius:SAME_AREA_M,weight:2,fillOpacity:.018}).addTo(map);}
function showTripDetail(t,base=null){selectedTripId=t.trip_id;$('selectedMini').textContent=title(t);$('selectedLead').innerHTML=`${esc(title(t))}<br><span class="muted">${esc(fmtTime(tms(t)))}</span>`;setBadge('selectedBadge','詳細表示中','good');$('selectedTripDetail').className='detail';$('selectedTripDetail').innerHTML=`<div class="summaryBox"><h3>選択した釣行回</h3>${detailHtml(t,base)}</div><div class="actions"><button id="btnStdSelected">標準地図</button><button id="btnEditSelected">入力欄へ読込</button><button id="btnDeleteSelected" class="danger">この履歴を削除</button></div>`;$('btnStdSelected').onclick=()=>openStd(lat(t),lng(t));$('btnEditSelected').onclick=()=>loadToForm(t.trip_id);$('btnDeleteSelected').onclick=async()=>{if(!confirm('この釣行履歴を削除しますか？'))return;await delTrip(t.trip_id);selectedTripId=null;selectedGroupId=null;$('selectedTripDetail').className='emptyBox';$('selectedTripDetail').textContent='未選択';$('selectedLead').textContent='地図の数字ピン、または下の全履歴から1回分を選ぶと詳細を表示します。';setBadge('selectedBadge','未選択','');await refreshAll();};}
async function hidePointHistoryCard(){const p=$('pointHistoryPanel');if(!p)return;const c=p.closest('.card');if(c)c.style.display='none';}
function hideSelectedTripDetailCard(){const p=$('selectedTripDetail');if(!p)return;const c=p.closest('.card');if(c)c.style.display='none';}
function renderPointHistory(g,focusId){hidePointHistoryCard();}
async function refreshCounts(){const trips=await getAllTrips();$('totalTrips').textContent=String(trips.length);if(!currentPos){$('count20').textContent='-';$('count100').textContent='-';return;}const arr=trips.map(t=>dCurrent(t)).filter(d=>d!==null);const n20=arr.filter(d=>d<=SAME_POINT_M).length,n100=arr.filter(d=>d<=SAME_AREA_M).length;$('count20').textContent=String(n20);$('count100').textContent=String(n100);}
function filterTrips(trips){const q=($('searchBox').value||'').trim().toLowerCase();let list=trips.slice();if(q){list=list.filter(t=>[fmtTime(tms(t)),t.lake_name,t.point_name,t.line_no,t.sinker_g,t.fishfinder_depth_m,t.water_temp_c,t.weather,t.wind,t.memo].join(' ').toLowerCase().includes(q));}const m=$('sortMode').value;list.sort((a,b)=>{if(m==='date_desc')return tms(b)-tms(a);if(m==='date_asc')return tms(a)-tms(b);if(m==='name')return(`${a.lake_name||''} ${a.point_name||''}`).localeCompare(`${b.lake_name||''} ${b.point_name||''}`,'ja');if(currentPos)return(dCurrent(a)??Infinity)-(dCurrent(b)??Infinity);return tms(b)-tms(a);});return list;}
async function renderAllList(){
  const trips=filterTrips(await getAllTrips());
  $('dbView').textContent=`過去釣行履歴 ${trips.length}件`;
  const box=$('allHistoryList');
  if(!box)return;

  if(!allHistoryExpanded){
    box.innerHTML=`<button id="btnShowAllHistory" class="primary" type="button">全履歴を表示</button><p class="muted">通常時は長い履歴リストを表示しません。必要な時だけ全履歴を開きます。</p>`;
    const b=$('btnShowAllHistory');
    if(b)b.onclick=()=>{allHistoryExpanded=true;renderAllList();};
    return;
  }

  box.innerHTML=`<button id="btnHideAllHistory" type="button">全履歴を閉じる</button><div class="subhead">全履歴の日付一覧 <span class="chip">${trips.length}件</span></div><div id="allHistoryDateList" class="list"></div>`;
  const hide=$('btnHideAllHistory');
  if(hide)hide.onclick=()=>{allHistoryExpanded=false;renderAllList();};

  const list=$('allHistoryDateList');
  for(const t of trips){
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='item'+(t.trip_id===selectedTripId?' selected':'');
    btn.setAttribute('data-all-date-trip-id',String(t.trip_id));
    btn.innerHTML=`<div class="top"><span>${esc(fmtTime(tms(t)))}</span><span>${esc(title(t))}</span></div>`;
    list.appendChild(btn);
  }
}
async function updateDb(){const trips=await getAllTrips();groups=makeGroups(trips);$('dbView').textContent=`過去釣行履歴 ${trips.length}件 / 地図ポイント ${groups.length}件`;setBadge('groupView',`地図${groups.length}`,'good');await renderAllList();}
async function refreshAll(){await renderMap();await refreshCounts();await updateDb();}
function loadToForm(id){getAllTrips().then(trips=>{const t=trips.find(x=>x.trip_id===id);if(!t)return;editingTripId=id;fillForm(t);$('btnUpdateTrip').disabled=false;$('btnLoadSelected').disabled=false;setBadge('saveBadge','編集中','warn');document.getElementById('tripDate').scrollIntoView({behavior:'smooth',block:'center'});});}
function fillForm(t){$('tripDate').value=toLocal(tms(t));$('lakeName').value=t.lake_name||'';$('pointName').value=t.point_name||'';$('lineNo').value=t.line_no||'';$('sinkerG').value=t.sinker_g||'';$('fishfinderDepthM').value=t.fishfinder_depth_m||'';$('waterTempC').value=t.water_temp_c||'';$('weather').value=t.weather||'';$('wind').value=t.wind||'';$('memo').value=t.memo||'';}
function clearForm(){editingTripId=null;$('tripDate').value=toLocal(nowMs());['lakeName','pointName','lineNo','sinkerG','fishfinderDepthM','waterTempC','weather','wind','memo'].forEach(id=>$(id).value='');$('btnUpdateTrip').disabled=true;setBadge('saveBadge','待機中','');}
function toLocal(ms){const d=new Date(Number(ms||nowMs()));return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
function openStd(a,b){window.open(`https://www.google.com/maps/search/?api=1&query=${Number(a).toFixed(7)},${Number(b).toFixed(7)}`,'_blank','noopener');}
function fitAll(){if(!map)return;const pts=[];if(currentPos)pts.push([Number(currentPos.lat),Number(currentPos.lng)]);for(const g of groups)pts.push([g.lat,g.lng]);if(pts.length===0)return;if(pts.length===1)map.setView(pts[0],18);else map.fitBounds(L.latLngBounds(pts),{padding:[35,35],maxZoom:18});}
function fitInitialLakeViewOnce(force=false){if((initialLakeViewDone&&!force)||!map)return;const nearLimitM=1000;const pts=[];if(currentPos&&validLatLng(Number(currentPos.lat),Number(currentPos.lng))){const a=Number(currentPos.lat),b=Number(currentPos.lng);const dLat=nearLimitM/111320;const dLng=nearLimitM/(111320*Math.max(0.25,Math.cos(a*Math.PI/180)));pts.push([a-dLat,b-dLng],[a+dLat,b+dLng]);for(const g of groups){const d=dist(a,b,g.lat,g.lng);if(d<=nearLimitM)pts.push([g.lat,g.lng]);}}else{for(const g of groups)pts.push([g.lat,g.lng]);}if(pts.length===0)return;map.fitBounds(L.latLngBounds(pts),{padding:[35,35]});initialLakeViewDone=true;}
function fitNear(){if(!map||!currentPos)return;const pts=[[Number(currentPos.lat),Number(currentPos.lng)]];for(const g of groups){if(g.distance_m!==null&&g.distance_m<=SAME_AREA_M)pts.push([g.lat,g.lng]);}if(pts.length===1)map.setView(pts[0],18);else map.fitBounds(L.latLngBounds(pts),{padding:[35,35],maxZoom:18});}
function downloadBlob(n,t,x){const b=new Blob([x],{type:t});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=n;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);}
async function exportDb(){const trips=await getAllTrips();downloadBlob(`wakasagi_map_v10_${Date.now()}.json`,'application/json',JSON.stringify({version:'10',exported_ms:Date.now(),trips},null,2));}
async function importPayload(payload){const rows=Array.isArray(payload)?payload:(payload.trips||payload.trip_records||payload.spots||[]);if(!Array.isArray(rows))return-1;let c=0;for(const r of rows){let t=r.trip_id?r:normalizeOld(r);if(!t)continue;t.trip_id=t.trip_id||genId('T');t.date_ms=Number(t.date_ms||t.start_ms||nowMs());t.lat=Number(t.lat);t.lng=Number(t.lng);if(!validLatLng(t.lat,t.lng))continue;t.updated_ms=nowMs();await putTrip(t);c++;}return c;}
async function initPwa(){if('serviceWorker'in navigator){try{await navigator.serviceWorker.register('./service-worker.js?v=10');}catch(e){}}}
async function init(){hidePointHistoryCard();hideSelectedTripDetailCard();if(window.isSecureContext)setBadge('secureBadge','GPS可','good');else setBadge('secureBadge','HTTPS必要','bad');db=await openDb();ensureMap();$('tripDate').value=toLocal(nowMs());const n=await migrateOld(false);if(n>0)$('mapStatus').textContent=`旧データ${n}件を移行しました。`;
$('btnLocate').onclick=()=>locate(true);$('btnFitAll').onclick=fitAll;$('btnFitNear').onclick=fitNear;$('btnSaveScroll').onclick=()=>$('tripDate').scrollIntoView({behavior:'smooth',block:'center'});$('btnSaveTrip').onclick=saveTrip;$('btnLoadSelected').onclick=()=>selectedTripId&&loadToForm(selectedTripId);$('btnUpdateTrip').onclick=updateTrip;$('btnClearForm').onclick=clearForm;$('btnExport').onclick=exportDb;$('btnImport').onclick=()=>$('importFile').click();$('importFile').onchange=async e=>{const f=e.target.files&&e.target.files[0];if(!f)return;let p;try{p=JSON.parse(await f.text());}catch(err){alert('JSONを読めません。');return;}const c=await importPayload(p);alert(`${c}件を読み込みました。`);await refreshAll();};$('btnMigrate').onclick=async()=>{const c=await migrateOld(true);alert(`旧データ移行 ${c}件`);await refreshAll();};$('btnClearDb').onclick=async()=>{if(confirm('テストDBを消去しますか？')){await new Promise(res=>{const tx=db.transaction([STORE_TRIPS,STORE_META],'readwrite');tx.objectStore(STORE_TRIPS).clear();tx.objectStore(STORE_META).clear();tx.oncomplete=()=>res();});location.reload();}};$('searchBox').oninput=renderAllList;$('sortMode').onchange=renderAllList;document.addEventListener('click',ev=>{
  const pd=ev.target.closest('[data-popup-trip-id]');
  if(pd){
    ev.preventDefault();ev.stopPropagation();
    const box=pd.closest('.leaflet-popup-content');
    showPopupTripDetail(pd.getAttribute('data-popup-group-id'),pd.getAttribute('data-popup-trip-id'),box);
    return;
  }

  const ad=ev.target.closest('[data-all-date-trip-id]');
  if(ad){
    ev.preventDefault();ev.stopPropagation();
    const id=ad.getAttribute('data-all-date-trip-id');
    getAllTrips().then(trips=>{
      const t=trips.find(x=>String(x.trip_id)===String(id));
      if(!t)return;
      selectedTripId=t.trip_id;
      selectedGroupId=null;
      showTripDetail(t,null);
      showFrontTripDetail(t,null);
      document.querySelectorAll('[data-all-date-trip-id]').forEach(x=>x.classList.remove('selected'));
      ad.classList.add('selected');
    });
    return;
  }

  const g=ev.target.closest('[data-group-id]');
  if(g){
    ev.preventDefault();
    selectGroup(g.getAttribute('data-group-id'));
    return;
  }

  const t=ev.target.closest('[data-trip-id]');
  if(t){
    ev.preventDefault();
    selectTrip(t.getAttribute('data-trip-id'));
  }
});await initPwa();await refreshAll();const last=await metaGet('last_pos');if(last&&validLatLng(Number(last.lat),Number(last.lng)))updatePosition(last,false,true);locate(false);}
window.addEventListener('load',()=>init().catch(e=>{$('locStatus').textContent='初期化エラー: '+(e&&e.message?e.message:e);setBadge('locBadge','エラー','bad');}));


// ============================================================
// v11: GitHub map -> Pico W /log#maplink bridge
// 役割:
// - GitHub側でsidを作らない
// - GitHub側で釣行開始しない
// - GitHub側でFISHを作らない
// - 選択地点/現在地の情報だけをPico W /logへトップレベル遷移で渡す
// ============================================================
function v11_utf8_to_b64(s){
  return btoa(unescape(encodeURIComponent(s)));
}
function v11_b64_to_utf8(s){
  return decodeURIComponent(escape(atob(s)));
}
function v11_getPicoIp(){
  const el=document.getElementById('picoIp');
  const v=(el && el.value ? el.value.trim() : '') || localStorage.getItem('pico_ip') || '192.168.4.1';
  return v.replace(/^https?:\/\//,'').replace(/\/.*$/,'');
}
function v11_setLinkBadge(text,cls){
  const b=document.getElementById('linkBadge');
  if(!b) return;
  b.textContent=text;
  b.className='pill '+(cls||'');
}
function v11_setLinkStatus(text){
  const el=document.getElementById('linkStatus');
  if(el) el.textContent=text;
}
async function v11_getSelectedTripForLink(){
  try{
    const trips=await getAllTrips();
    if(typeof selectedTripId !== 'undefined' && selectedTripId){
      const t=trips.find(x=>String(x.trip_id)===String(selectedTripId));
      if(t) return t;
    }
    if(typeof selectedGroupId !== 'undefined' && selectedGroupId && typeof groups !== 'undefined'){
      const g=groups.find(x=>String(x.group_id)===String(selectedGroupId));
      if(g && g.latest) return g.latest;
    }
  }catch(e){}
  return null;
}
async function v11_makeMapLinkPayload(){
  const t=await v11_getSelectedTripForLink();
  if(t){
    return {
      v:1,
      source:'wakasagi_map_v11',
      map_spot_id:String(t.trip_id||''),
      lat:Number(t.lat),
      lng:Number(t.lng),
      acc:Number(t.accuracy_m||0),
      lake_name:String(t.lake_name||''),
      point_name:String(t.point_name||''),
      place_name:String(t.point_name||t.lake_name||''),
      line_no:String(t.line_no||''),
      sinker_g:String(t.sinker_g||''),
      // 過去履歴の水深は、現在sidの魚探水深ではないためPico Wへ渡さない。
      fishfinder_m:'',
      fishfinder_depth_m:'',
      water_temp_c:String(t.water_temp_c||''),
      note:String(t.memo||''),
      history_date_ms:Number(t.date_ms||t.start_ms||0),
      linked_ms:Date.now()
    };
  }
  if(typeof currentPos !== 'undefined' && currentPos && Number.isFinite(Number(currentPos.lat)) && Number.isFinite(Number(currentPos.lng))){
    return {
      v:1,
      source:'wakasagi_map_v11',
      map_spot_id:'CURRENT_'+Date.now(),
      lat:Number(currentPos.lat),
      lng:Number(currentPos.lng),
      acc:Number(currentPos.acc||0),
      lake_name:'',
      point_name:'現在地',
      place_name:'現在地',
      line_no:'',
      sinker_g:'',
      fishfinder_m:'',
      fishfinder_depth_m:'',
      water_temp_c:'',
      note:'地図アプリ現在地から連携',
      linked_ms:Date.now()
    };
  }
  return null;
}
async function v11_linkToPicoLog(){
  const ip=v11_getPicoIp();
  localStorage.setItem('pico_ip',ip);
  const payload=await v11_makeMapLinkPayload();
  if(!payload){
    v11_setLinkBadge('地点なし','bad');
    v11_setLinkStatus('現在地または地図上の過去地点を選択してください。');
    return;
  }
  if(!Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)){
    v11_setLinkBadge('座標不正','bad');
    v11_setLinkStatus('連携する緯度経度が不正です。');
    return;
  }
  const encoded=encodeURIComponent(v11_utf8_to_b64(JSON.stringify(payload)));
  v11_setLinkBadge('移動中','warn');
  v11_setLinkStatus('Pico W /logへ移動して、現在sidへ地点情報を保存します。');
  location.href='http://'+ip+'/log#maplink='+encoded;
}
function v11_enableLinkButton(){
  const btn=document.getElementById('btnLinkToPico');
  if(!btn) return;
  let ok=false;
  try{
    ok = !!(typeof selectedTripId !== 'undefined' && selectedTripId);
    ok = ok || !!(typeof currentPos !== 'undefined' && currentPos && Number.isFinite(Number(currentPos.lat)) && Number.isFinite(Number(currentPos.lng)));
  }catch(e){}
  btn.disabled=!ok;
  if(ok) v11_setLinkStatus('選択地点または現在地をPico Wの現在sidへ連携できます。');
}

function v111_applyPicoParam(){
  try{
    const p=new URLSearchParams(location.search);
    if(p.get('autolink')==='1') sessionStorage.setItem('wakasagi_autolink_once','1');
    if(p.get('linked')==='1') sessionStorage.setItem('wakasagi_linked_notice','1');
    const pico=p.get('pico');
    if(!pico) return;
    let host=decodeURIComponent(pico).replace(/^https?:\/\//,'').replace(/\/.*$/,'');
    if(!host) return;
    localStorage.setItem('pico_ip',host);
    const el=document.getElementById('picoIp');
    if(el) el.value=host;
    if(history && history.replaceState){
      history.replaceState(null,document.title,location.pathname);
    }
  }catch(e){}
}

function v11_initLinkUi(){
  v111_applyPicoParam();
  const ipEl=document.getElementById('picoIp');
  if(ipEl){
    ipEl.value=localStorage.getItem('pico_ip')||'192.168.4.1';
    ipEl.addEventListener('change',()=>localStorage.setItem('pico_ip',v11_getPicoIp()));
  }
  const btn=document.getElementById('btnLinkToPico');
  if(btn) btn.addEventListener('click',v11_linkToPicoLog);
  // 既存UIの選択/現在地更新後にボタン状態を追従させる
  setInterval(v11_enableLinkButton,700);
  v11_enableLinkButton();
}
window.addEventListener('load',()=>setTimeout(v11_initLinkUi,900));


// ============================================================
// v11.2: Pico W /log -> GitHub map log summary receiver
// 受け取り形式:
//   https://.../#logsync=<base64url-json>
// 保存先:
//   既存 trip_records の選択地点 / map_spot_id / 20m以内の地点へ統合。
//   見つからない場合は、Pico Wログ要約から新しい履歴を作る。
// ============================================================
function v112_utf8_to_b64(s){
  return btoa(unescape(encodeURIComponent(s)));
}
function v112_b64_to_utf8(s){
  const bin = atob(s);
  try{
    return decodeURIComponent(escape(bin));
  }catch(e){
    if(window.TextDecoder){
      const bytes=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    }
    return bin;
  }
}
function v112_decodeLogSyncPayload(){
  try{
    const h=location.hash||'';
    if(!h.startsWith('#logsync=')) return null;
    const raw=decodeURIComponent(h.substring('#logsync='.length));
    if(!raw) return null;
    return JSON.parse(v112_b64_to_utf8(raw));
  }catch(e){
    return {__error:String(e&&e.message?e.message:e)};
  }
}
function v112_setLogSync(text,cls){
  const st=document.getElementById('logSyncStatus');
  const bg=document.getElementById('logSyncBadge');
  if(st) st.textContent=text;
  if(bg){ bg.textContent=text.length>12 ? (cls==='good'?'同期済み':'エラー') : text; bg.className='pill '+(cls||''); }
}
function v112_logSummaryHtml(t){
  const s=t && (t.pico_summary || (Array.isArray(t.pico_logs)&&t.pico_logs.length?t.pico_logs[t.pico_logs.length-1]:null));
  if(!s) return '';
  const val=(v)=>String(v===undefined||v===null||v===''?'-':v);
  return `<div class="logBox"><h3>Pico Wログ要約</h3><div class="logGrid">
    <b>sid</b><span>${esc(val(s.sid))}</span>
    <b>FISH</b><span>${esc(val(s.fish_count))}</span>
    <b>MARK</b><span>${esc(val(s.mark_count))}</span>
    <b>ログ数</b><span>${esc(val(s.tlog_count))}</span>
    <b>seq</b><span>${esc(val(s.first_seq))} - ${esc(val(s.last_seq))}</span>
    <b>時間</b><span>${esc(fmtTime(s.start_ms||s.first_recv_ms))} / ${esc(fmtTime(s.updated_ms||s.last_recv_ms))}</span>
    <b>深度</b><span>${esc(val(s.min_depth_m))} - ${esc(val(s.max_depth_m))} m</span>
    <b>誘い</b><span>${esc(val(s.used_sasoi))}</span>
    <b>速度</b><span>${esc(val(s.used_speed))}</span>
  </div></div>`;
}
try{
  const v112_originalDetailHtml = detailHtml;
  detailHtml = function(t,base){
    return v112_originalDetailHtml(t,base) + v112_logSummaryHtml(t);
  };
}catch(e){}

function v112_numOrNull(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function v112_depthNum(v){
  const n = Number(v);
  return (Number.isFinite(n) && n > 0) ? n : null;
}

function v112_depthMaxText(){
  let best = null;
  for(const v of arguments){
    const n = v112_depthNum(v);
    if(n === null) continue;
    if(best === null || n > best) best = n;
  }
  return best === null ? '' : best.toFixed(3);
}

function v112_makePicoSummary(p){
  return {
    v:1,
    source:'pico_log',
    sid:String(p.sid || ''),
    map_spot_id:String(p.map_spot_id || p.spot_id || ''),
    start_ms:v112_numOrNull(p.start_ms) || 0,
    updated_ms:v112_numOrNull(p.updated_ms) || Date.now(),
    first_recv_ms:v112_numOrNull(p.first_recv_ms) || 0,
    last_recv_ms:v112_numOrNull(p.last_recv_ms) || 0,
    fish_count:v112_numOrNull(p.fish_count) || 0,
    mark_count:v112_numOrNull(p.mark_count) || 0,
    tlog_count:v112_numOrNull(p.tlog_count) || 0,
    first_seq:p.first_seq === undefined ? '' : p.first_seq,
    last_seq:p.last_seq === undefined ? '' : p.last_seq,
    first_t_ms:p.first_t_ms === undefined ? '' : p.first_t_ms,
    last_t_ms:p.last_t_ms === undefined ? '' : p.last_t_ms,
    min_depth_m:p.min_depth_m === undefined ? '' : String(p.min_depth_m),
    max_depth_m:p.max_depth_m === undefined ? '' : String(p.max_depth_m),
    depth_source:p.depth_source === undefined ? '' : String(p.depth_source),
    used_sasoi:p.used_sasoi === undefined ? '' : String(p.used_sasoi),
    used_speed:p.used_speed === undefined ? '' : String(p.used_speed),
    received_ms:Date.now()
  };
}

async function v112_findTripForLogSync(p){
  const sid = String(p && p.sid ? p.sid : '').trim();
  if(!sid) return null;

  const trips = await getAllTrips();

  // 第0段階:
  // map_spot_id一致や20m以内一致では、別日の過去釣行へ統合しない。
  // 同じsidの履歴だけを更新対象にする。
  for(const t of trips){
    if(String(t.pico_sid || '') === sid) return t;

    if(t.pico_summary && String(t.pico_summary.sid || '') === sid) return t;

    if(Array.isArray(t.pico_logs) && t.pico_logs.some(l => String(l.sid || '') === sid)){
      return t;
    }
  }

  return null;
}

function v112_makeTripFromLogSync(p){
  const gpsLat = Number(p.gps_lat || p.lat);
  const gpsLng = Number(p.gps_lng || p.lng);
  const now = Date.now();
  const sid = String(p.sid || '').trim();
  const incomingDepth = v112_depthMaxText(
    p.fishfinder_depth_m,
    p.max_depth_m,
    p.fishfinder_m
  );

  return {
    // map_spot_idをtrip_idに使わない。
    // 過去地点選択時に、過去trip_idへ現在sidを書き込まないため。
    trip_id:genId('T'),
    pico_sid:sid,
    map_spot_id:String(p.map_spot_id || p.spot_id || ''),
    date_ms:v112_numOrNull(p.start_ms) || v112_numOrNull(p.first_recv_ms) || now,
    lat:Number.isFinite(gpsLat) ? gpsLat : 0,
    lng:Number.isFinite(gpsLng) ? gpsLng : 0,
    accuracy_m:v112_numOrNull(p.gps_acc_m || p.acc) || 0,
    location_time_ms:v112_numOrNull(p.gps_ms) || v112_numOrNull(p.start_ms) || now,
    lake_name:String(p.lake_name || ''),
    point_name:String(p.point_name || p.place_name || 'Pico Wログ地点'),
    line_no:String(p.line_no || ''),
    sinker_g:String(p.sinker_g || ''),
    fishfinder_depth_m:incomingDepth,
    water_temp_c:String(p.water_temp_c || ''),
    weather:String(p.weather_text || p.weather || ''),
    wind:String(p.wind_dir || p.wind || ''),
    memo:String(p.note || ''),
    pico_logs:[],
    created_ms:now,
    updated_ms:now
  };
}

async function v112_applyLogSyncPayload(p){
  if(!p || p.__error){
    v112_setLogSync('logsync decode error','bad');
    return false;
  }

  const sid = String(p.sid || '').trim();
  if(!sid){
    v112_setLogSync('sidなし','bad');
    return false;
  }

  const lat = Number(p.gps_lat || p.lat);
  const lng = Number(p.gps_lng || p.lng);
  if(!Number.isFinite(lat) || !Number.isFinite(lng)){
    v112_setLogSync('logsync 座標なし','bad');
    return false;
  }

  const now = Date.now();
  const summary = v112_makePicoSummary(p);

  let t = await v112_findTripForLogSync(p);
  if(!t) t = v112_makeTripFromLogSync(p);

  t.pico_sid = sid;
  t.map_spot_id = String(t.map_spot_id || p.map_spot_id || p.spot_id || '');

  // Pico側情報で空欄だけ補完する。手入力済みのライン/シンカー等は上書きしない。
  if(!t.lake_name && p.lake_name) t.lake_name = String(p.lake_name);
  if(!t.point_name && (p.point_name || p.place_name)) t.point_name = String(p.point_name || p.place_name);
  if(!t.line_no && p.line_no) t.line_no = String(p.line_no);
  if(!t.sinker_g && p.sinker_g) t.sinker_g = String(p.sinker_g);
  if(!t.water_temp_c && p.water_temp_c) t.water_temp_c = String(p.water_temp_c);
  if(!t.weather && (p.weather_text || p.weather)) t.weather = String(p.weather_text || p.weather);
  if(!t.wind && (p.wind_dir || p.wind)) t.wind = String(p.wind_dir || p.wind);
  if(!t.memo && p.note) t.memo = String(p.note);

  // 第0段階の水深更新:
  // 0mは登録しない。
  // 同じsid内でのみ、既存値とincoming値を比較して深い値へ更新する。
  // 20m以内の別釣行・過去履歴の水深は比較対象にしない。
  const incomingDepth = v112_depthMaxText(
    p.fishfinder_depth_m,
    p.max_depth_m,
    p.fishfinder_m
  );

  const mergedDepth = v112_depthMaxText(
    t.fishfinder_depth_m,
    incomingDepth
  );

  if(mergedDepth){
    t.fishfinder_depth_m = mergedDepth;
  }

  t.pico_logs = Array.isArray(t.pico_logs) ? t.pico_logs : [];
  t.pico_logs = t.pico_logs.filter(x => String(x.sid || '') !== sid);
  t.pico_logs.push(summary);
  t.pico_summary = summary;

  t.updated_ms = now;

  await putTrip(t);
  selectedTripId = t.trip_id;

  if(history && history.replaceState){
    history.replaceState(null, document.title, location.pathname + location.search);
  }

  await refreshAll();

  try{
    showTripDetail(t, {lat:Number(t.lat), lng:Number(t.lng)});
  }catch(e){}

  try{
    fitInitialLakeViewOnce(true);
  }catch(e){}

  v112_setLogSync('同期済み','good');
  return true;
}
async function v112_initLogSyncReceiver(){
  // 既存init()がdbを開くのを待つ
  for(let i=0;i<20;i++){
    if(db) break;
    await new Promise(r=>setTimeout(r,250));
  }
  const p=v112_decodeLogSyncPayload();
  if(p) await v112_applyLogSyncPayload(p);
}
window.addEventListener('load',()=>setTimeout(v112_initLogSyncReceiver,1400));


// ============================================================
// v11.3: Auto link mode
// /log or /remote opens GitHub map with ?pico=...&autolink=1.
// GitHub map gets GPS, builds maplink payload, jumps to Pico /log#maplink=...
// Pico /log saves it to current sid, then returns to return_url.
// User does not press "本体ログへ連携" in the normal flow.
// ============================================================
function v113_autoBadge(text,cls){
  const b=document.getElementById('autoLinkBadge');
  const s=document.getElementById('autoLinkStatus');
  if(b){ b.textContent=text; b.className='pill '+(cls||''); }
  if(s) s.textContent=text;
}
function v113_currentUrlWithoutAuto(){
  try{
    const u=new URL(location.href);
    u.searchParams.delete('autolink');
    u.searchParams.set('linked','1');
    return u.origin + u.pathname + u.search;
  }catch(e){
    return location.origin + location.pathname + '?linked=1';
  }
}
try{
  const v113_originalMakeMapLinkPayload = v11_makeMapLinkPayload;
  v11_makeMapLinkPayload = async function(){
    const p = await v113_originalMakeMapLinkPayload();
    if(p){
      p.auto_link = 1;
      p.return_url = v113_currentUrlWithoutAuto();
    }
    return p;
  };
}catch(e){}
async function v113_waitForCurrentPos(maxMs){
  const start=Date.now();
  while(Date.now()-start < maxMs){
    try{
      if(typeof currentPos !== 'undefined' && currentPos && Number.isFinite(Number(currentPos.lat)) && Number.isFinite(Number(currentPos.lng))){
        return true;
      }
    }catch(e){}
    await new Promise(r=>setTimeout(r,500));
  }
  return false;
}
async function v113_runAutoLinkIfRequested(){
  if(sessionStorage.getItem('wakasagi_linked_notice')==='1'){
    sessionStorage.removeItem('wakasagi_linked_notice');
    v113_autoBadge('連携済み','good');
    v11_setLinkBadge && v11_setLinkBadge('連携済み','good');
    return;
  }
  if(sessionStorage.getItem('wakasagi_autolink_once')!=='1') return;
  sessionStorage.removeItem('wakasagi_autolink_once');
  v113_autoBadge('現在地取得中','warn');
  const ok=await v113_waitForCurrentPos(18000);
  if(!ok){
    v113_autoBadge('現在地取得失敗','bad');
    v11_setLinkStatus && v11_setLinkStatus('自動連携できません。現在地取得を確認してください。');
    return;
  }
  v113_autoBadge('本体へ自動連携中','warn');
  await v11_linkToPicoLog();
}
window.addEventListener('load',()=>setTimeout(v113_runAutoLinkIfRequested,2200));


// ============================================================
// v11.4: Buttons from GitHub map back to Pico W /log and /remote.
// No prompt. Uses ?pico=... saved by v111_applyPicoParam(), or localStorage,
// and falls back to 192.168.4.1 for Pico AP mode.
// ============================================================
function v114_getPicoHost(){
  try{
    let host = localStorage.getItem('pico_ip') || '';
    if(!host) host = '192.168.4.1';
    host = String(host).replace(/^https?:\/\//,'').replace(/\/.*$/,'').trim();
    return host || '192.168.4.1';
  }catch(e){
    return '192.168.4.1';
  }
}
function v114_picoUrl(path){
  return 'http://' + v114_getPicoHost() + path;
}
function v114_openPico(path){
  location.href = v114_picoUrl(path);
}
function v114_updatePicoNav(){
  const host = v114_getPicoHost();
  const st = document.getElementById('picoNavStatus');
  const bg = document.getElementById('picoNavBadge');
  if(st) st.textContent = '接続先: http://' + host;
  if(bg){ bg.textContent = host; bg.className = 'pill good'; }
}
function v114_initPicoNav(){
  const logBtn = document.getElementById('btnOpenPicoLog');
  const remoteBtn = document.getElementById('btnOpenPicoRemote');
  if(logBtn) logBtn.addEventListener('click',()=>v114_openPico('/log'));
  if(remoteBtn) remoteBtn.addEventListener('click',()=>v114_openPico('/remote'));
  setInterval(v114_updatePicoNav, 1000);
  v114_updatePicoNav();
}
window.addEventListener('load',()=>setTimeout(v114_initPicoNav,1000));


// ============================================================
// v11.5: Fixed buttons back to Pico W
// Always visible at top of the map screen.
// ============================================================
function v115_getPicoHost(){
  try{
    let host = localStorage.getItem('pico_ip') || '';
    const p = new URLSearchParams(location.search);
    const pico = p.get('pico');
    if(pico){
      host = decodeURIComponent(pico).replace(/^https?:\/\//,'').replace(/\/.*$/,'').trim();
      if(host) localStorage.setItem('pico_ip',host);
    }
    if(!host) host = '192.168.4.1';
    host = String(host).replace(/^https?:\/\//,'').replace(/\/.*$/,'').trim();
    return host || '192.168.4.1';
  }catch(e){
    return '192.168.4.1';
  }
}
function v115_goPico(path){
  location.href = 'http://' + v115_getPicoHost() + path;
}
function v115_initFixedPicoNav(){
  const hostEl = document.getElementById('fixedPicoHost');
  const logBtn = document.getElementById('fixedPicoLog');
  const remoteBtn = document.getElementById('fixedPicoRemote');
  function refresh(){
    if(hostEl) hostEl.textContent = 'Pico W: ' + v115_getPicoHost();
  }
  if(logBtn) logBtn.addEventListener('click',()=>v115_goPico('/log'));
  if(remoteBtn) remoteBtn.addEventListener('click',()=>v115_goPico('/remote'));
  refresh();
  setInterval(refresh,1000);
}
window.addEventListener('load',()=>setTimeout(v115_initFixedPicoNav,500));
