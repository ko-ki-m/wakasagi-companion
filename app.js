'use strict';
// wakasagi-companion root app.js v117 standalone
// 追加 mapsync_topfields_fix_*.js は使用しない。
// root本体ログ連携ページ用の単独app。trip_records保存、地図表示、#logsync保存をこのファイル内で処理する。

var DB_NAME = 'wakasagi_trip_map_v10';
var DB_VER = 1;
var STORE_TRIPS = 'trip_records';
var STORE_META = 'meta';
var OLD_DB_NAME = 'wakasa_companion_v2';
var OLD_STORE_SPOTS = 'fishing_spots';
var SAME_POINT_M = 20;
var SAME_AREA_M = 100;
var DEFAULT_CENTER = [36.2048, 138.2529];

var db = null;
var map = null;
var groupLayer = null;
var currentPos = null;
var currentMarker = null;
var accCircle = null;
var cur20 = null;
var cur100 = null;
var sel20 = null;
var sel100 = null;
var groups = [];
var selectedGroupId = null;
var selectedTripId = null;
var editingTripId = null;
var allHistoryExpanded = false;
var initialLakeViewDone = false;

function $(id){ return document.getElementById(id); }
function nowMs(){ return Date.now(); }
function pad(n){ return String(n).padStart(2,'0'); }
function text(v){ return String(v === undefined || v === null ? '' : v).trim(); }
function first(){ for(var i=0;i<arguments.length;i++){ var s=text(arguments[i]); if(s) return s; } return ''; }
function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];}); }
function fmtTime(ms){ var n=Number(ms||0); if(!n) return '-'; var d=new Date(n); if(Number.isNaN(d.getTime())) return '-'; return d.getFullYear()+'/'+pad(d.getMonth()+1)+'/'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes()); }
function toLocal(ms){ var d=new Date(Number(ms||nowMs())); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes()); }
function fromLocal(v){ var n=new Date(v||'').getTime(); return Number.isFinite(n) ? n : nowMs(); }
function genId(p){ return String(p||'T') + Date.now().toString(36) + Math.floor(Math.random()*0xfffff).toString(16).padStart(5,'0'); }
function validLatLng(lat,lng){ return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180; }
function dist(lat1,lng1,lat2,lng2){ var R=6371008.8, r=function(v){return v*Math.PI/180;}; var p1=r(lat1), p2=r(lat2), dp=r(lat2-lat1), dl=r(lng2-lng1); var a=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2; return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)); }
function lat(t){ return Number(t && t.lat); }
function lng(t){ return Number(t && t.lng); }
function tms(t){ return Number((t && (t.date_ms||t.start_ms||t.created_ms)) || 0); }
function title(t){ return first(t && t.point_name, t && t.lake_name, '釣行地点'); }
function dBase(t,a,b){ if(!validLatLng(Number(a),Number(b)) || !validLatLng(lat(t),lng(t))) return null; return dist(Number(a),Number(b),lat(t),lng(t)); }
function dCurrent(t){ if(!currentPos) return null; return dBase(t,currentPos.lat,currentPos.lng); }
function setBadge(id,msg,cls){ var el=$(id); if(!el) return; el.textContent=msg; el.className=(id==='secureBadge'?'badge ':'pill ')+(cls||''); }
function sub(t){ return 'ライン '+esc((t&&t.line_no)||'-')+' / シンカー '+esc((t&&t.sinker_g)||'-')+'g / 魚探 '+esc((t&&t.fishfinder_depth_m)||'-')+'m / 水温 '+esc((t&&t.water_temp_c)||'-')+'℃'; }
function normNumberString(v){ var s=text(v); if(!s) return ''; var n=Number(s); if(Number.isFinite(n)) return String(n).replace(/\.0+$/,''); return s; }
function windTextFromPayload(p){ var w=first(p.wind); if(w) return w; var dir=first(p.wind_dir,p.wind_direction); var sp=first(p.wind_speed_mps,p.wind_mps); return [dir, sp ? (sp+'m/s') : ''].filter(Boolean).join(' '); }
function fieldFromPayload(p){
  var depth = first(p.fishfinder_depth_m, p.fishfinder_m);
  // 魚探入力が無い場合、Pico W側が max_depth_m を送ってきたらroot側の水深欄にも反映する。
  if(!depth && first(p.max_depth_m)) depth = first(p.max_depth_m);
  return {
    line_no:first(p.line_no,p.line,p.lineStr),
    sinker_g:first(p.sinker_g,p.sinker),
    fishfinder_depth_m:depth,
    water_temp_c:first(p.water_temp_c,p.water_temp),
    weather:first(p.weather_text,p.weather),
    wind:windTextFromPayload(p),
    depth_source:first(p.depth_source)
  };
}
function applyTopFields(t,fields,overwrite){
  var changed=false;
  function put(k,v){ var s=text(v); if(!s) return; if(overwrite || !text(t[k])){ if(text(t[k])!==s){ t[k]=s; changed=true; } } }
  put('line_no',fields.line_no);
  put('sinker_g',normNumberString(fields.sinker_g));
  put('fishfinder_depth_m',fields.fishfinder_depth_m);
  put('water_temp_c',fields.water_temp_c);
  put('weather',fields.weather);
  put('wind',fields.wind);
  put('depth_source',fields.depth_source);
  return changed;
}
function makePicoSummary(p,fields){
  return {
    sid:text(p.sid),
    source:text(p.source || 'pico_log_summary'),
    start_ms:Number(p.start_ms||0),
    updated_ms:Number(p.updated_ms||Date.now()),
    fish_count:Number(p.fish_count||0),
    mark_count:Number(p.mark_count||0),
    tlog_count:Number(p.tlog_count||0),
    first_seq:p.first_seq,
    last_seq:p.last_seq,
    first_t_ms:p.first_t_ms,
    last_t_ms:p.last_t_ms,
    first_recv_ms:p.first_recv_ms,
    last_recv_ms:p.last_recv_ms,
    min_depth_m:first(p.min_depth_m),
    max_depth_m:first(p.max_depth_m),
    used_sasoi:first(p.used_sasoi),
    used_speed:first(p.used_speed),
    line_no:fields.line_no,
    sinker_g:fields.sinker_g,
    fishfinder_depth_m:fields.fishfinder_depth_m,
    water_temp_c:fields.water_temp_c,
    weather:fields.weather,
    wind:fields.wind,
    depth_source:fields.depth_source
  };
}
function summaryHtml(s){
  if(!s) return '';
  return '<div class="picoSummary"><h4>Pico Wログ要約</h4>'+
    '<table class="kv">'+
    '<tr><th>sid</th><td>'+esc(s.sid||'-')+'</td></tr>'+
    '<tr><th>FISH</th><td>'+esc(s.fish_count||0)+'</td></tr>'+
    '<tr><th>MARK</th><td>'+esc(s.mark_count||0)+'</td></tr>'+
    '<tr><th>ログ数</th><td>'+esc(s.tlog_count||0)+'</td></tr>'+
    '<tr><th>seq</th><td>'+esc(first(s.first_seq,'-'))+' - '+esc(first(s.last_seq,'-'))+'</td></tr>'+
    '<tr><th>深度範囲</th><td>'+esc(first(s.min_depth_m,'-'))+' - '+esc(first(s.max_depth_m,'-'))+' m</td></tr>'+
    '<tr><th>誘い</th><td>'+esc(s.used_sasoi||'-')+'</td></tr>'+
    '<tr><th>速度</th><td>'+esc(s.used_speed||'-')+'</td></tr>'+
    '</table></div>';
}

function openDb(){ return new Promise(function(resolve,reject){ var req=indexedDB.open(DB_NAME,DB_VER); req.onupgradeneeded=function(){ var d=req.result; if(!d.objectStoreNames.contains(STORE_TRIPS)){ var st=d.createObjectStore(STORE_TRIPS,{keyPath:'trip_id'}); st.createIndex('date_ms','date_ms',{unique:false}); } if(!d.objectStoreNames.contains(STORE_META)) d.createObjectStore(STORE_META,{keyPath:'key'}); }; req.onsuccess=function(){ resolve(req.result); }; req.onerror=function(){ reject(req.error); }; }); }
function st(name,mode){ return db.transaction(name,mode||'readonly').objectStore(name); }
function getAllTrips(){ return new Promise(function(res){ var r=st(STORE_TRIPS).getAll(); r.onsuccess=function(){ res(r.result||[]); }; r.onerror=function(){ res([]); }; }); }
function putTrip(t){ return new Promise(function(res){ var tx=db.transaction(STORE_TRIPS,'readwrite'); tx.objectStore(STORE_TRIPS).put(t); tx.oncomplete=function(){res(true);}; tx.onerror=function(){res(false);}; }); }
function delTrip(id){ return new Promise(function(res){ var tx=db.transaction(STORE_TRIPS,'readwrite'); tx.objectStore(STORE_TRIPS).delete(id); tx.oncomplete=function(){res(true);}; tx.onerror=function(){res(false);}; }); }
function metaGet(k){ return new Promise(function(res){ var r=st(STORE_META).get(k); r.onsuccess=function(){ res(r.result ? r.result.value : null); }; r.onerror=function(){ res(null); }; }); }
function metaSet(k,v){ return new Promise(function(res){ var tx=db.transaction(STORE_META,'readwrite'); tx.objectStore(STORE_META).put({key:k,value:v}); tx.oncomplete=function(){res(true);}; tx.onerror=function(){res(false);}; }); }
function clearDb(){ return new Promise(function(res){ var tx=db.transaction([STORE_TRIPS,STORE_META],'readwrite'); tx.objectStore(STORE_TRIPS).clear(); tx.objectStore(STORE_META).clear(); tx.oncomplete=function(){res(true);}; tx.onerror=function(){res(false);}; }); }

function normalizeOld(s){ var a=Number(s.lat), b=Number(s.lng); if(!validLatLng(a,b)) return null; return { trip_id:s.trip_id||s.spot_id||genId('T'), migrated_from:s.spot_id||'', date_ms:Number(s.start_ms||s.created_ms||nowMs()), lat:a, lng:b, accuracy_m:Number(s.accuracy_m||0), location_time_ms:Number(s.location_time_ms||s.start_ms||nowMs()), lake_name:s.lake_name||'', point_name:s.point_name||'', line_no:s.line_no||'', sinker_g:s.sinker_g||'', fishfinder_depth_m:s.fishfinder_depth_m||s.fishfinder_m||'', water_temp_c:s.water_temp_c||'', weather:s.weather||'', wind:s.wind||'', memo:s.memo||'', created_ms:Number(s.created_ms||s.start_ms||nowMs()), updated_ms:Number(s.updated_ms||s.start_ms||nowMs()) }; }
function openOld(){ return new Promise(function(res){ var r=indexedDB.open(OLD_DB_NAME); r.onsuccess=function(){res(r.result);}; r.onerror=function(){res(null);}; r.onblocked=function(){res(null);}; }); }
async function migrateOld(force){ if(!force && await metaGet('old_migrated')) return 0; var old=await openOld(); if(!old || !old.objectStoreNames.contains(OLD_STORE_SPOTS)){ await metaSet('old_migrated',true); return 0; } var rows=await new Promise(function(res){ var r=old.transaction(OLD_STORE_SPOTS,'readonly').objectStore(OLD_STORE_SPOTS).getAll(); r.onsuccess=function(){res(r.result||[]);}; r.onerror=function(){res([]);}; }); var cur=await getAllTrips(); var exist=new Set(cur.map(function(x){return String(x.migrated_from||x.trip_id);})); var c=0; for(var i=0;i<rows.length;i++){ var t=normalizeOld(rows[i]); if(!t) continue; if(!force && exist.has(String(t.migrated_from||t.trip_id))) continue; await putTrip(t); c++; } await metaSet('old_migrated',true); return c; }

function ensureMap(){ if(map) return true; if(!window.L){ var ms=$('mapStatus'); if(ms) ms.textContent='地図ライブラリ未読込'; return false; } map=L.map('map',{zoomControl:true}).setView(DEFAULT_CENTER,5); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map); groupLayer=L.layerGroup().addTo(map); setTimeout(function(){try{map.invalidateSize();}catch(e){}},100); setTimeout(function(){try{map.invalidateSize();}catch(e){}},600); return true; }
function drawCurrent(zoomNow){ if(!currentPos || !ensureMap()) return; [currentMarker,accCircle,cur20,cur100].forEach(function(x){ if(x) x.remove(); }); var a=Number(currentPos.lat), b=Number(currentPos.lng), acc=Number(currentPos.acc||0); currentMarker=L.marker([a,b]).addTo(map).bindPopup('現在地'); if(acc>0) accCircle=L.circle([a,b],{radius:acc}).addTo(map); cur20=L.circle([a,b],{radius:SAME_POINT_M,weight:2,fillOpacity:.04}).addTo(map); cur100=L.circle([a,b],{radius:SAME_AREA_M,weight:2,fillOpacity:.015}).addTo(map); if(zoomNow) map.setView([a,b],19); var btn=$('btnFitNear'); if(btn) btn.disabled=false; var bs=$('btnSaveScroll'); if(bs) bs.disabled=false; var bt=$('btnSaveTrip'); if(bt) bt.disabled=false; }
function markerClass(g){ if(String(selectedGroupId)===String(g.group_id)) return 'cluster selected'; if(g.distance_m!==null && g.distance_m<=SAME_POINT_M) return 'cluster near20'; if(g.distance_m!==null && g.distance_m<=SAME_AREA_M) return 'cluster near100'; return 'cluster'; }
function makeGroups(trips){ var valid=trips.filter(function(x){return validLatLng(lat(x),lng(x));}).slice().sort(function(a,b){return tms(b)-tms(a);}); var gs=[]; valid.forEach(function(t){ var best=null,bd=Infinity; gs.forEach(function(g){ var dd=dist(lat(t),lng(t),g.lat,g.lng); if(dd<=SAME_POINT_M && dd<bd){best=g;bd=dd;} }); if(!best){ best={group_id:genId('G'),lat:lat(t),lng:lng(t),trips:[]}; gs.push(best); } best.trips.push(t); }); gs.forEach(function(g){ g.trips.sort(function(a,b){return tms(b)-tms(a);}); g.latest=g.trips[0]; g.count=g.trips.length; g.latest_ms=tms(g.latest); g.distance_m=currentPos?dist(Number(currentPos.lat),Number(currentPos.lng),g.lat,g.lng):null; }); return gs.sort(function(a,b){ return currentPos ? ((a.distance_m==null?Infinity:a.distance_m)-(b.distance_m==null?Infinity:b.distance_m)) : (b.latest_ms-a.latest_ms); }); }
function popup(g){ var rows=(g.trips||[]).slice().sort(function(a,b){return tms(b)-tms(a);}).map(function(t){ return '<button type="button" class="popupDate" onclick="showPopupTripDetail(\''+esc(g.group_id)+'\',\''+esc(t.trip_id)+'\')">'+esc(fmtTime(tms(t)).split(' ')[0])+'</button>'; }).join(' '); return '<b>この地点の過去 '+g.count+'回</b><br>見たい日付を選択してください。<div>'+rows+'</div>'; }
async function renderMap(){ ensureMap(); if(!groupLayer) return; groupLayer.clearLayers(); var trips=await getAllTrips(); groups=makeGroups(trips); groups.forEach(function(g){ var ic=L.divIcon({className:'',html:'<div class="'+markerClass(g)+'">'+g.count+'</div>',iconSize:[38,38],iconAnchor:[19,19],popupAnchor:[0,-18]}); L.marker([g.lat,g.lng],{icon:ic}).addTo(groupLayer).bindPopup(popup(g)); }); var bf=$('btnFitAll'); if(bf) bf.disabled=groups.length===0; var mv=$('mapStatus'); if(mv) mv.textContent=groups.length ? '地図に過去地点を表示中' : '保存済み履歴はまだありません'; }
function drawSelected(a,b){ if(!ensureMap()) return; [sel20,sel100].forEach(function(x){ if(x) x.remove(); }); sel20=L.circle([a,b],{radius:SAME_POINT_M,weight:3,fillOpacity:.045}).addTo(map); sel100=L.circle([a,b],{radius:SAME_AREA_M,weight:2,fillOpacity:.018}).addTo(map); }
function detailHtml(t,base){ var dd='-'; if(base){ var d=dBase(t,base.lat,base.lng); if(d!==null) dd=Math.round(d)+'m'; } else if(currentPos){ var dc=dCurrent(t); if(dc!==null) dd='現在地から '+Math.round(dc)+'m'; } return '<table class="kv">'+
  '<tr><th>日時</th><td>'+esc(fmtTime(tms(t)))+'</td></tr>'+
  '<tr><th>距離</th><td>'+esc(dd)+'</td></tr>'+
  '<tr><th>湖名</th><td>'+esc(t.lake_name||'-')+'</td></tr>'+
  '<tr><th>ポイント名</th><td>'+esc(t.point_name||'-')+'</td></tr>'+
  '<tr><th>座標</th><td>'+Number(t.lat).toFixed(7)+', '+Number(t.lng).toFixed(7)+'</td></tr>'+
  '<tr><th>ライン</th><td>'+esc(t.line_no||'-')+'</td></tr>'+
  '<tr><th>シンカー</th><td>'+esc(t.sinker_g||'-')+'g</td></tr>'+
  '<tr><th>魚探水深</th><td>'+esc(t.fishfinder_depth_m||'-')+'m'+(t.depth_source==='reel_log_max'?'（ログ最大深度）':'')+'</td></tr>'+
  '<tr><th>水温</th><td>'+esc(t.water_temp_c||'-')+'℃</td></tr>'+
  '<tr><th>天気</th><td>'+esc(t.weather||'-')+'</td></tr>'+
  '<tr><th>風</th><td>'+esc(t.wind||'-')+'</td></tr>'+
  '<tr><th>メモ</th><td>'+esc(t.memo||'-')+'</td></tr>'+
  '</table>'+summaryHtml(t.pico_summary); }
function showTripDetail(t,base){ selectedTripId=t.trip_id; var m=$('selectedMini'); if(m) m.textContent=title(t); var lead=$('selectedLead'); if(lead) lead.innerHTML='<b>'+esc(title(t))+'</b><br>'+esc(fmtTime(tms(t))); setBadge('selectedBadge','詳細表示中','good'); var box=$('selectedTripDetail'); if(box){ box.className='detail'; box.innerHTML='<h3>選択した釣行回</h3>'+detailHtml(t,base)+'<div class="row"><button id="btnStdSelected" type="button">標準地図入力欄へ読込</button><button id="btnEditSelected" type="button">入力欄へ読込</button><button id="btnDeleteSelected" type="button">この履歴を削除</button></div>'; var b1=$('btnStdSelected'); if(b1) b1.onclick=function(){openStd(lat(t),lng(t));}; var b2=$('btnEditSelected'); if(b2) b2.onclick=function(){loadToForm(t.trip_id);}; var b3=$('btnDeleteSelected'); if(b3) b3.onclick=async function(){ if(!confirm('この釣行履歴を削除しますか？')) return; await delTrip(t.trip_id); selectedTripId=null; selectedGroupId=null; await refreshAll(); }; }
}
async function selectTrip(id){ var trips=await getAllTrips(); var t=trips.find(function(x){return String(x.trip_id)===String(id);}); if(!t) return; groups=makeGroups(trips); var g=groups.find(function(gr){return (gr.trips||[]).some(function(y){return String(y.trip_id)===String(id);});}); selectedTripId=t.trip_id; selectedGroupId=g?g.group_id:null; await renderMap(); renderPointHistory(g||{lat:lat(t),lng:lng(t),trips:[t]}, id); showTripDetail(t,g?{lat:g.lat,lng:g.lng}:null); drawSelected(g?g.lat:lat(t),g?g.lng:lng(t)); if(map) map.setView([lat(t),lng(t)],18); }
async function showPopupTripDetail(groupId,tripId){ await selectTrip(tripId); try{ if(map) map.closePopup(); }catch(e){} }
function itemHtml(t,label,base){ var d=base?dBase(t,base.lat,base.lng):dCurrent(t); var cls=d!==null&&d<=SAME_POINT_M?' near20':(d!==null&&d<=SAME_AREA_M?' near100':''); return '<div class="item'+cls+(t.trip_id===selectedTripId?' selected':'')+'"><button type="button" data-trip-id="'+esc(t.trip_id)+'"><b>'+esc(title(t))+'</b> '+esc(label||'')+' '+(d!==null?Math.round(d)+'m':'')+'</button><div>'+esc(fmtTime(tms(t)))+'</div><div>'+sub(t)+'</div><div>'+esc(t.memo||'')+'</div></div>'; }
async function renderPointHistory(g,focusId){ var box=$('pointHistoryPanel'); if(!box) return; if(!g){ box.innerHTML='未選択'; setBadge('pointBadge','未選択',''); return; } var trips=(g.trips||[]).slice().sort(function(a,b){return tms(b)-tms(a);}); box.innerHTML='<h3>この地点の過去履歴 '+trips.length+'件</h3>'+trips.map(function(t){return itemHtml(t, fmtTime(tms(t)).split(' ')[0], {lat:g.lat,lng:g.lng});}).join(''); setBadge('pointBadge',trips.length+'件','good'); box.querySelectorAll('button[data-trip-id]').forEach(function(b){ b.onclick=function(){selectTrip(b.getAttribute('data-trip-id'));}; }); }
function filterTrips(trips){ var q=text($('searchBox')&&$('searchBox').value).toLowerCase(); var list=trips.slice(); if(q){ list=list.filter(function(t){return [fmtTime(tms(t)),t.lake_name,t.point_name,t.line_no,t.sinker_g,t.fishfinder_depth_m,t.water_temp_c,t.weather,t.wind,t.memo].join(' ').toLowerCase().indexOf(q)>=0;}); } var m=($('sortMode')&&$('sortMode').value)||'date_desc'; list.sort(function(a,b){ if(m==='date_desc') return tms(b)-tms(a); if(m==='date_asc') return tms(a)-tms(b); if(m==='name') return (String(a.lake_name||'')+' '+String(a.point_name||'')).localeCompare(String(b.lake_name||'')+' '+String(b.point_name||''),'ja'); if(currentPos) return (dCurrent(a)==null?Infinity:dCurrent(a))-(dCurrent(b)==null?Infinity:dCurrent(b)); return tms(b)-tms(a); }); return list; }
async function renderAllList(){ var trips=filterTrips(await getAllTrips()); var dbv=$('dbView'); if(dbv) dbv.textContent='過去釣行履歴 '+trips.length+'件'; var box=$('allHistoryList'); if(!box) return; if(!allHistoryExpanded){ box.innerHTML='<button id="btnShowAllHistory" type="button">全履歴を表示</button><p>通常時は長い履歴リストを表示しません。必要な時だけ全履歴を開きます。</p>'; var b=$('btnShowAllHistory'); if(b) b.onclick=function(){allHistoryExpanded=true; renderAllList();}; return; } box.innerHTML='<button id="btnHideAllHistory" type="button">全履歴を閉じる</button><h3>全履歴の日付一覧 '+trips.length+'件</h3><div id="allHistoryDateList"></div>'; var h=$('btnHideAllHistory'); if(h) h.onclick=function(){allHistoryExpanded=false;renderAllList();}; var list=$('allHistoryDateList'); trips.forEach(function(t){ var div=document.createElement('div'); div.className='item'+(t.trip_id===selectedTripId?' selected':''); div.innerHTML='<button type="button" data-all-trip-id="'+esc(t.trip_id)+'"><b>'+esc(fmtTime(tms(t)))+'</b> '+esc(title(t))+'</button><div>'+sub(t)+'</div>'; list.appendChild(div); }); list.querySelectorAll('button[data-all-trip-id]').forEach(function(b){ b.onclick=function(){selectTrip(b.getAttribute('data-all-trip-id'));}; }); }
async function refreshCounts(){ var trips=await getAllTrips(); var total=$('totalTrips'); if(total) total.textContent=String(trips.length); if(!currentPos){ if($('count20')) $('count20').textContent='-'; if($('count100')) $('count100').textContent='-'; return; } var arr=trips.map(function(t){return dCurrent(t);}).filter(function(d){return d!==null;}); if($('count20')) $('count20').textContent=String(arr.filter(function(d){return d<=SAME_POINT_M;}).length); if($('count100')) $('count100').textContent=String(arr.filter(function(d){return d<=SAME_AREA_M;}).length); }
async function refreshAll(){ await renderMap(); await refreshCounts(); await renderAllList(); var gv=$('groupView'); if(gv) gv.textContent=groups.length ? groups.length+'地点' : '-'; }
function fitInitialLakeViewOnce(force){ if(!map || !groups || groups.length===0) return; if(initialLakeViewDone && !force) return; initialLakeViewDone=true; var pts=groups.map(function(g){return [g.lat,g.lng];}); if(currentPos) pts.push([Number(currentPos.lat),Number(currentPos.lng)]); try{ map.fitBounds(L.latLngBounds(pts),{padding:[30,30],maxZoom:13}); }catch(e){} }
function fitAll(){ if(!map || !groups || groups.length===0) return; try{ map.fitBounds(L.latLngBounds(groups.map(function(g){return [g.lat,g.lng];})),{padding:[30,30],maxZoom:13}); }catch(e){} }
function fitNear(){ if(!map || !currentPos) return; map.setView([Number(currentPos.lat),Number(currentPos.lng)],16); }
function updatePosition(pos,zoomNow,doInitialFit){ currentPos={lat:Number(pos.lat),lng:Number(pos.lng),acc:Number(pos.acc||0),t:Number(pos.t||nowMs())}; if($('latView')) $('latView').textContent=currentPos.lat.toFixed(7); if($('lngView')) $('lngView').textContent=currentPos.lng.toFixed(7); if($('accView')) $('accView').textContent=currentPos.acc ? '±'+Math.round(currentPos.acc)+'m' : '-'; if($('timeView')) $('timeView').textContent=fmtTime(currentPos.t); if($('locStatus')) $('locStatus').textContent='現在地を確認しました。'; setBadge('locBadge','取得済み',(currentPos.acc>0&&currentPos.acc<=20)?'good':'warn'); metaSet('last_pos',currentPos); drawCurrent(zoomNow); refreshAll().then(function(){ if(doInitialFit) fitInitialLakeViewOnce(true); }); }
function locate(manual){ if(!window.isSecureContext){ if($('locStatus')) $('locStatus').textContent='HTTPSで開いていません。GitHub Pagesのhttps URLから開いてください。'; setBadge('locBadge','HTTPS必要','bad'); return; } if(!('geolocation' in navigator)){ setBadge('locBadge','非対応','bad'); return; } if($('locStatus')) $('locStatus').textContent='現在地を取得しています...'; setBadge('locBadge','取得中','warn'); navigator.geolocation.getCurrentPosition(function(g){ var c=g.coords; updatePosition({lat:Number(c.latitude),lng:Number(c.longitude),acc:Number(c.accuracy||0),t:Number(g.timestamp||nowMs())},!!manual,!manual); },async function(e){ if($('locStatus')) $('locStatus').textContent='現在地エラー: '+(e&&e.message?e.message:'取得できませんでした'); setBadge('locBadge','未取得','bad'); var last=await metaGet('last_pos'); if(last&&validLatLng(Number(last.lat),Number(last.lng))){ updatePosition(last,!!manual,!manual); setBadge('locBadge','前回位置','warn'); } },{enableHighAccuracy:true,timeout:15000,maximumAge:10000}); }
function readForm(){ return { date_ms:fromLocal($('tripDate')&&$('tripDate').value), lake_name:text($('lakeName')&&$('lakeName').value), point_name:text($('pointName')&&$('pointName').value), line_no:text($('lineNo')&&$('lineNo').value), sinker_g:text($('sinkerG')&&$('sinkerG').value), fishfinder_depth_m:text($('fishfinderDepthM')&&$('fishfinderDepthM').value), water_temp_c:text($('waterTempC')&&$('waterTempC').value), weather:text($('weather')&&$('weather').value), wind:text($('wind')&&$('wind').value), memo:text($('memo')&&$('memo').value) }; }
function fillForm(t){ if($('tripDate')) $('tripDate').value=toLocal(t.date_ms); if($('lakeName')) $('lakeName').value=t.lake_name||''; if($('pointName')) $('pointName').value=t.point_name||''; if($('lineNo')) $('lineNo').value=t.line_no||''; if($('sinkerG')) $('sinkerG').value=t.sinker_g||''; if($('fishfinderDepthM')) $('fishfinderDepthM').value=t.fishfinder_depth_m||''; if($('waterTempC')) $('waterTempC').value=t.water_temp_c||''; if($('weather')) $('weather').value=t.weather||''; if($('wind')) $('wind').value=t.wind||''; if($('memo')) $('memo').value=t.memo||''; }
function clearForm(){ editingTripId=null; if($('tripDate')) $('tripDate').value=toLocal(nowMs()); ['lakeName','pointName','lineNo','sinkerG','fishfinderDepthM','waterTempC','weather','wind','memo'].forEach(function(id){ if($(id)) $(id).value=''; }); if($('btnUpdateTrip')) $('btnUpdateTrip').disabled=true; setBadge('saveBadge','待機中',''); }
async function saveTripFromForm(){ if(!currentPos){ alert('現在地がありません。'); return; } var f=readForm(), now=nowMs(); var t=Object.assign({trip_id:genId('T')},f,{lat:Number(currentPos.lat),lng:Number(currentPos.lng),accuracy_m:Number(currentPos.acc||0),location_time_ms:Number(currentPos.t||now),created_ms:now,updated_ms:now}); await putTrip(t); selectedTripId=t.trip_id; setBadge('saveBadge','保存済み','good'); await refreshAll(); await selectTrip(t.trip_id); }
async function updateTripFromForm(){ if(!editingTripId){ alert('上書き対象がありません。'); return; } var trips=await getAllTrips(); var old=trips.find(function(x){return x.trip_id===editingTripId;}); if(!old) return; var t=Object.assign({},old,readForm(),{updated_ms:nowMs()}); await putTrip(t); editingTripId=null; if($('btnUpdateTrip')) $('btnUpdateTrip').disabled=true; setBadge('saveBadge','上書き済み','good'); await refreshAll(); await selectTrip(t.trip_id); }
async function loadToForm(id){ var trips=await getAllTrips(); var t=trips.find(function(x){return String(x.trip_id)===String(id||selectedTripId);}); if(!t){ alert('選択履歴がありません。'); return; } fillForm(t); editingTripId=t.trip_id; if($('btnUpdateTrip')) $('btnUpdateTrip').disabled=false; setBadge('saveBadge','入力欄へ読込','warn'); }
function openStd(a,b){ window.open('https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(a+','+b),'_blank'); }

function encodeB64(obj){ return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); }
function decodeB64(s){ var bin=atob(decodeURIComponent(s)); try{ return JSON.parse(decodeURIComponent(escape(bin))); }catch(e){ if(window.TextDecoder){ var bytes=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i); return JSON.parse(new TextDecoder('utf-8').decode(bytes)); } return JSON.parse(bin); } }
function getPicoHost(){ var ip=text($('picoIp')&&$('picoIp').value); if(ip) return ip.replace(/^https?:\/\//,'').replace(/\/$/,''); try{ var saved=localStorage.getItem('wakasagi_pico_host')||''; return text(saved); }catch(e){ return ''; } }
function setPicoHost(h){ h=text(h).replace(/^https?:\/\//,'').replace(/\/$/,''); if($('picoIp')) $('picoIp').value=h; if($('fixedPicoHost')) $('fixedPicoHost').textContent=h ? ('Pico W: '+h) : 'Pico W: 未設定'; try{ if(h) localStorage.setItem('wakasagi_pico_host',h); }catch(e){} }
function v11_makeMapLinkPayload(){ var t=null; if(selectedTripId){ var flat=[]; groups.forEach(function(g){flat=flat.concat(g.trips||[]);}); t=flat.find(function(x){return String(x.trip_id)===String(selectedTripId);}); }
  var lat0=t?lat(t):(currentPos?Number(currentPos.lat):null); var lng0=t?lng(t):(currentPos?Number(currentPos.lng):null); if(!validLatLng(Number(lat0),Number(lng0))) return null;
  return { v:1, source:'github_pages_root', return_url:location.origin+location.pathname+location.search, map_spot_id:t?String(t.trip_id):'', map_source:t?'trip_records':'current_pos', lat:String(lat0), lng:String(lng0), acc_m:String(t?first(t.accuracy_m):first(currentPos&&currentPos.acc)), lake_name:t?first(t.lake_name):'', point_name:t?first(t.point_name):'', line_no:t?first(t.line_no):'', sinker_g:t?first(t.sinker_g):'', fishfinder_m:t?first(t.fishfinder_depth_m,t.fishfinder_m):'', water_temp_c:t?first(t.water_temp_c):'', weather:t?first(t.weather):'', wind:t?first(t.wind):'', note:t?first(t.memo):'' };
}
function linkToPico(){ var host=getPicoHost(); if(!host){ alert('Pico W IPを入力してください。'); return; } setPicoHost(host); var p=v11_makeMapLinkPayload(); if(!p){ alert('地図ピンまたは現在地がありません。'); return; } var url='http://'+host+'/log#maplink='+encodeURIComponent(encodeB64(p)); if($('linkStatus')) $('linkStatus').textContent='Pico W /logへ移動します。'; setBadge('linkBadge','連携中','warn'); location.href=url; }
function setLogSync(msg,cls){ if($('logSyncStatus')) $('logSyncStatus').textContent=msg; setBadge('logSyncBadge',msg,cls||''); }
function decodeLogSyncPayload(){ if(!location.hash || !location.hash.startsWith('#logsync=')) return null; try{ return decodeB64(location.hash.substring('#logsync='.length)); }catch(e){ return null; } }
async function findTripForLogSync(p){ var trips=await getAllTrips(); var spot=first(p.map_spot_id,p.spot_id,p.trip_id); if(spot){ var h=trips.find(function(t){return String(t.trip_id)===spot || String(t.migrated_from||'')===spot || String(t.map_spot_id||'')===spot;}); if(h) return h; }
  var sid=first(p.sid); if(sid){ var hs=trips.find(function(t){ return String(t.sid||'')===sid || (t.pico_summary && String(t.pico_summary.sid||'')===sid) || (Array.isArray(t.pico_logs)&&t.pico_logs.some(function(x){return String((x&&x.sid)||'')===sid;})); }); if(hs) return hs; }
  var la=Number(first(p.gps_lat,p.lat)), ln=Number(first(p.gps_lng,p.lng)); if(validLatLng(la,ln)){ var best=null, bd=Infinity; trips.forEach(function(t){ var d=dBase(t,la,ln); if(d!==null && d<=SAME_POINT_M && d<bd){best=t;bd=d;} }); if(best) return best; }
  return null;
}
function makeTripFromLogSync(p,fields,summary){ var now=Date.now(); var la=Number(first(p.gps_lat,p.lat)), ln=Number(first(p.gps_lng,p.lng)); if(!validLatLng(la,ln)) return null; var t={ trip_id:first(p.map_spot_id,p.spot_id)||genId('T'), migrated_from:first(p.map_spot_id,p.spot_id)||'', sid:first(p.sid), map_spot_id:first(p.map_spot_id), map_source:first(p.map_source), date_ms:Number(p.start_ms||p.updated_ms||now), start_ms:Number(p.start_ms||0), lat:la, lng:ln, accuracy_m:Number(first(p.gps_acc_m,p.acc_m)||0), location_time_ms:Number(p.gps_ms||p.updated_ms||now), lake_name:first(p.lake_name), point_name:first(p.point_name,p.place_name), line_no:'', sinker_g:'', fishfinder_depth_m:'', water_temp_c:'', weather:'', wind:'', memo:first(p.note,p.memo), pico_summary:summary, pico_logs:summary?[summary]:[], created_ms:now, updated_ms:now };
  applyTopFields(t,fields,true); return t; }
async function applyLogSyncPayload(p){ if(!p || typeof p!=='object'){ setLogSync('同期データなし','bad'); return false; } var fields=fieldFromPayload(p); var summary=makePicoSummary(p,fields); var t=await findTripForLogSync(p); if(!t){ t=makeTripFromLogSync(p,fields,summary); if(!t){ setLogSync('同期失敗: 位置なし','bad'); return false; } } else { t.sid=t.sid||first(p.sid); t.map_spot_id=t.map_spot_id||first(p.map_spot_id); t.map_source=t.map_source||first(p.map_source); if(!t.lake_name && p.lake_name) t.lake_name=first(p.lake_name); if(!t.point_name && (p.point_name||p.place_name)) t.point_name=first(p.point_name,p.place_name); if(!t.memo && p.note) t.memo=first(p.note); if(!Array.isArray(t.pico_logs)) t.pico_logs=[]; t.pico_logs=t.pico_logs.filter(function(x){return String((x&&x.sid)||'')!==String(summary.sid||'');}); t.pico_logs.push(summary); t.pico_summary=summary; applyTopFields(t,fields,false); t.updated_ms=Date.now(); }
  await putTrip(t); selectedTripId=t.trip_id; if(history && history.replaceState) history.replaceState(null,document.title,location.pathname+location.search); await refreshAll(); await selectTrip(t.trip_id); setLogSync('同期済み','good'); return true; }
async function handleLogSyncHash(){ var p=decodeLogSyncPayload(); if(!p) return false; setLogSync('同期処理中','warn'); return await applyLogSyncPayload(p); }

async function exportBackup(){ var trips=await getAllTrips(); var blob=new Blob([JSON.stringify({v:1,exported_ms:Date.now(),trips:trips},null,2)],{type:'application/json'}); var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='wakasagi_trip_records_'+Date.now()+'.json'; a.click(); setTimeout(function(){URL.revokeObjectURL(a.href);},1000); }
async function importBackupFile(file){ if(!file) return; var txt=await file.text(); var j=JSON.parse(txt); var rows=Array.isArray(j)?j:(j.trips||[]); var c=0; for(var i=0;i<rows.length;i++){ if(rows[i]&&rows[i].trip_id){ await putTrip(rows[i]); c++; } } alert(c+'件読み込みました。'); await refreshAll(); }

async function init(){ if($('secureBadge')) setBadge('secureBadge',window.isSecureContext?'HTTPS':'確認中',window.isSecureContext?'good':'warn'); db=await openDb(); await migrateOld(false); ensureMap(); clearForm(); setPicoHost(getPicoHost()); var last=await metaGet('last_pos'); if(last && validLatLng(Number(last.lat),Number(last.lng))) updatePosition(last,false,false); await refreshAll(); await handleLogSyncHash(); locate(false); }
function bind(){ var b; if(b=$('btnLocate')) b.onclick=function(){locate(true);}; if(b=$('btnFitAll')) b.onclick=fitAll; if(b=$('btnFitNear')) b.onclick=fitNear; if(b=$('btnSaveScroll')) b.onclick=function(){ var el=$('lakeName')||$('tripDate'); if(el) el.scrollIntoView({behavior:'smooth',block:'center'});}; if(b=$('btnSaveTrip')) b.onclick=saveTripFromForm; if(b=$('btnUpdateTrip')) b.onclick=updateTripFromForm; if(b=$('btnClearForm')) b.onclick=clearForm; if(b=$('btnLoadSelected')) b.onclick=function(){loadToForm(selectedTripId);}; if(b=$('btnLinkToPico')) b.onclick=linkToPico; if(b=$('picoIp')) b.onchange=function(){setPicoHost(b.value);}; if(b=$('fixedPicoLog')) b.onclick=function(){ var h=getPicoHost(); if(h) location.href='http://'+h+'/log';}; if(b=$('fixedPicoRemote')) b.onclick=function(){ var h=getPicoHost(); if(h) location.href='http://'+h+'/remote';}; if(b=$('btnExport')) b.onclick=exportBackup; if(b=$('btnImport')) b.onclick=function(){ if($('importFile')) $('importFile').click();}; if(b=$('importFile')) b.onchange=function(){importBackupFile(b.files&&b.files[0]);}; if(b=$('btnMigrate')) b.onclick=async function(){ var c=await migrateOld(true); alert(c+'件移行しました。'); await refreshAll();}; if(b=$('btnClearDb')) b.onclick=async function(){ if(confirm('テストDBを消去しますか？')){ await clearDb(); await refreshAll(); } }; if(b=$('searchBox')) b.oninput=renderAllList; if(b=$('sortMode')) b.onchange=renderAllList; }

window.getAllTrips=getAllTrips;
window.putTrip=putTrip;
window.refreshAll=refreshAll;
window.dBase=dBase;
window.selectedTripId=selectedTripId;
window.showPopupTripDetail=showPopupTripDetail;
window.selectTrip=selectTrip;
window.applyLogSyncPayload=applyLogSyncPayload;
window.v112_applyLogSyncPayload=applyLogSyncPayload;
window.v112_makeMapLinkPayload=v11_makeMapLinkPayload;

window.addEventListener('load',function(){ bind(); init().catch(function(e){ console.error(e); var ms=$('mapStatus'); if(ms) ms.textContent='初期化エラー: '+(e&&e.message?e.message:e); }); });
