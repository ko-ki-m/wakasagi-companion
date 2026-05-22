// WAKASAGI STAGE1 POINT/DATE/TIME PATCH
// 2026-05-22
// Purpose:
// - Keep the current app_clean_autolink_idb.js baseline.
// - Add Stage 1 map behavior without touching lake_autofill.js or service-worker.js.
// - Map pin = physical place group within 10m.
// - Pin number = number of fishing dates at that place.
// - Pin popup flow = date list -> if same date has multiple records, time list -> detail.
(function(){
  'use strict';

  const STAGE1_POINT_M = 10;
  const STAGE1_VERSION = '20260522a';

  function stage1Log(msg){
    try{ console.log('[wakasagi-stage1 '+STAGE1_VERSION+'] '+msg); }catch(e){}
  }

  function stage1DateKeyFromMs(ms){
    const n = Number(ms || 0);
    if(!n) return '----/--/--';
    const d = new Date(n);
    if(Number.isNaN(d.getTime())) return '----/--/--';
    const p = (v)=>String(v).padStart(2,'0');
    return d.getFullYear() + '/' + p(d.getMonth()+1) + '/' + p(d.getDate());
  }

  function stage1DateKey(t){
    return stage1DateKeyFromMs(typeof tms === 'function' ? tms(t) : (t && (t.date_ms || t.start_ms || t.created_ms)));
  }

  function stage1TimeText(t){
    const s = (typeof fmtTime === 'function') ? fmtTime(typeof tms === 'function' ? tms(t) : (t && t.date_ms)) : '';
    const parts = String(s || '').split(' ');
    return parts.length >= 2 ? parts[1] : (s || '-');
  }

  function stage1UniqueDateCount(trips){
    return new Set((trips || []).map(stage1DateKey)).size;
  }

  function stage1SortTrips(a,b){
    return (typeof tms === 'function' ? tms(b) : Number(b.date_ms||0)) - (typeof tms === 'function' ? tms(a) : Number(a.date_ms||0));
  }

  function stage1TripsByDate(trips){
    const m = new Map();
    for(const t of (trips || [])){
      const k = stage1DateKey(t);
      if(!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    }
    const rows = Array.from(m.entries()).map(([date, list])=>{
      list.sort(stage1SortTrips);
      return {date, list, latest_ms:(typeof tms === 'function' ? tms(list[0]) : Number(list[0].date_ms||0))};
    });
    rows.sort((a,b)=>b.latest_ms-a.latest_ms);
    return rows;
  }

  // 10m physical place grouping. Keep trip count and date count separately.
  makeGroups = function(trips){
    const valid = (trips || [])
      .filter(x=>validLatLng(lat(x), lng(x)))
      .slice()
      .sort(stage1SortTrips);

    const gs = [];
    for(const t of valid){
      let best = null;
      let bestD = Infinity;
      for(const g of gs){
        const dd = dist(lat(t), lng(t), g.lat, g.lng);
        if(dd <= STAGE1_POINT_M && dd < bestD){
          best = g;
          bestD = dd;
        }
      }
      if(!best){
        best = {
          group_id: 'P' + gs.length + '_' + String(t.trip_id || ''),
          lat: lat(t),
          lng: lng(t),
          trips: []
        };
        gs.push(best);
      }
      const n = best.trips.length;
      best.trips.push(t);
      // Keep marker at the average of records belonging to this physical place.
      best.lat = ((best.lat * n) + lat(t)) / (n + 1);
      best.lng = ((best.lng * n) + lng(t)) / (n + 1);
    }

    for(const g of gs){
      g.trips.sort(stage1SortTrips);
      g.latest = g.trips[0];
      g.count = g.trips.length;
      g.date_count = stage1UniqueDateCount(g.trips);
      g.distance_m = currentPos ? dist(Number(currentPos.lat), Number(currentPos.lng), g.lat, g.lng) : null;
      g.latest_ms = (typeof tms === 'function') ? tms(g.latest) : Number(g.latest && g.latest.date_ms || 0);
    }

    return gs.sort((a,b)=>{
      if(currentPos) return (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity);
      return b.latest_ms - a.latest_ms;
    });
  };

  markerClass = function(g){
    if(selectedGroupId === g.group_id) return 'cluster selected';
    if(g.distance_m !== null && g.distance_m <= STAGE1_POINT_M) return 'cluster near20';
    if(g.distance_m !== null && g.distance_m <= SAME_AREA_M) return 'cluster near100';
    return 'cluster';
  };

  popup = function(g){
    const rows = stage1TripsByDate(g.trips);
    const dateButtons = rows.map(row=>{
      const label = row.date + (row.list.length > 1 ? ' (' + row.list.length + ')' : '');
      return '<button type="button" class="item" data-stage1-group-id="' + esc(g.group_id) + '" data-stage1-date="' + esc(row.date) + '">' +
             '<b>' + esc(label) + '</b><br><small>' + esc(title(row.list[0])) + '</small></button>';
    }).join('');

    return '<div class="popupStage1">' +
      '<h3>この場所の過去釣行日 ' + esc(g.date_count || rows.length || 0) + '日</h3>' +
      '<p>見たい日付を選択してください。</p>' +
      '<div class="list">' + (dateButtons || '<p class="muted">履歴がありません。</p>') + '</div>' +
      '</div>';
  };

  function stage1ShowTimeList(groupId, dateKey, box){
    const g = (groups || []).find(x=>String(x.group_id) === String(groupId));
    if(!g || !box) return;
    const sameDate = (g.trips || []).filter(t=>stage1DateKey(t) === dateKey).sort(stage1SortTrips);
    if(sameDate.length <= 0) return;

    selectedGroupId = g.group_id;
    selectedTripId = sameDate[0].trip_id;

    if(sameDate.length === 1){
      showPopupTripDetail(groupId, sameDate[0].trip_id, box);
      return;
    }

    const buttons = sameDate.map(t=>{
      return '<button type="button" class="item" data-stage1-group-id="' + esc(groupId) + '" data-stage1-trip-id="' + esc(t.trip_id) + '">' +
             '<b>' + esc(stage1TimeText(t)) + '</b> ' + esc(title(t)) + '<br>' +
             '<small>' + esc(sub(t)) + '</small></button>';
    }).join('');

    box.innerHTML = '<div class="popupStage1">' +
      '<h3>' + esc(dateKey) + ' の釣行 ' + sameDate.length + '件</h3>' +
      '<p>見たい時刻を選択してください。</p>' +
      '<div class="list">' + buttons + '</div>' +
      '<button type="button" class="item" data-stage1-back-group-id="' + esc(groupId) + '">日付一覧へ戻る</button>' +
      '</div>';
  }

  renderMap = async function(){
    ensureMap();
    if(!groupLayer) return;
    groupLayer.clearLayers();
    const trips = await getAllTrips();
    groups = makeGroups(trips);

    for(const g of groups){
      const num = g.date_count || stage1UniqueDateCount(g.trips) || 0;
      const ic = L.divIcon({
        className:'',
        html:'<div class="' + markerClass(g) + '" title="過去釣行日 ' + esc(num) + '日">' + esc(num) + '</div>',
        iconSize:[38,38],
        iconAnchor:[19,19],
        popupAnchor:[0,-18]
      });
      L.marker([g.lat,g.lng],{icon:ic}).addTo(groupLayer).bindPopup(popup(g));
    }
  };

  refreshCounts = async function(){
    const trips = await getAllTrips();
    $('totalTrips').textContent = String(trips.length);
    if(!currentPos){
      $('count20').textContent = '-';
      $('count100').textContent = '-';
      return;
    }
    const arr = trips.map(t=>dCurrent(t)).filter(d=>d !== null);
    $('count20').textContent = String(arr.filter(d=>d <= STAGE1_POINT_M).length);
    $('count100').textContent = String(arr.filter(d=>d <= SAME_AREA_M).length);
  };

  drawCurrent = function(zoomNow=false){
    if(!currentPos || !ensureMap()) return;
    const a = Number(currentPos.lat), b = Number(currentPos.lng), acc = Number(currentPos.acc || 0);
    [currentMarker, accCircle, cur20, cur100].forEach(x=>{ if(x) x.remove(); });
    currentMarker = L.marker([a,b]).addTo(map).bindPopup('現在地');
    if(acc > 0) accCircle = L.circle([a,b],{radius:acc}).addTo(map);
    cur20 = L.circle([a,b],{radius:STAGE1_POINT_M,weight:2,fillOpacity:.04}).addTo(map);
    cur100 = L.circle([a,b],{radius:SAME_AREA_M,weight:2,fillOpacity:.015}).addTo(map);
    if(zoomNow) map.setView([a,b],19);
    setTimeout(()=>{try{map.invalidateSize();}catch(e){}},50);
    $('btnFitNear').disabled=false;
    $('btnSaveScroll').disabled=false;
    $('btnSaveTrip').disabled=false;
  };

  drawSelected = function(a,b){
    [sel20, sel100].forEach(x=>{ if(x) x.remove(); });
    sel20 = L.circle([a,b],{radius:STAGE1_POINT_M,weight:3,fillOpacity:.045}).addTo(map);
    sel100 = L.circle([a,b],{radius:SAME_AREA_M,weight:2,fillOpacity:.018}).addTo(map);
  };

  saveTrip = async function(){
    if(!currentPos){ alert('現在地がありません。'); return; }
    const f = readForm(), now = nowMs();
    const trips = await getAllTrips();
    const near = trips.filter(t=>dBase(t,currentPos.lat,currentPos.lng)!==null && dBase(t,currentPos.lat,currentPos.lng)<=STAGE1_POINT_M);
    if(near.length>0 && !confirm('10m以内に過去履歴が' + near.length + '件あります。この場所の新しい釣行回として保存しますか？')) return;
    const t = {
      trip_id:genId('T'),
      ...f,
      lat:Number(currentPos.lat),
      lng:Number(currentPos.lng),
      accuracy_m:Number(currentPos.acc||0),
      location_time_ms:Number(currentPos.t||now),
      created_ms:now,
      updated_ms:now
    };
    await putTrip(t);
    selectedTripId=t.trip_id;
    setBadge('saveBadge','保存済み','good');
    await refreshAll();
    await selectTrip(t.trip_id);
  };

  document.addEventListener('click', function(ev){
    const dateBtn = ev.target.closest('[data-stage1-date]');
    if(dateBtn){
      ev.preventDefault();
      ev.stopPropagation();
      const box = dateBtn.closest('.leaflet-popup-content');
      stage1ShowTimeList(dateBtn.getAttribute('data-stage1-group-id'), dateBtn.getAttribute('data-stage1-date'), box);
      return;
    }

    const tripBtn = ev.target.closest('[data-stage1-trip-id]');
    if(tripBtn){
      ev.preventDefault();
      ev.stopPropagation();
      const box = tripBtn.closest('.leaflet-popup-content');
      showPopupTripDetail(tripBtn.getAttribute('data-stage1-group-id'), tripBtn.getAttribute('data-stage1-trip-id'), box);
      return;
    }

    const backBtn = ev.target.closest('[data-stage1-back-group-id]');
    if(backBtn){
      ev.preventDefault();
      ev.stopPropagation();
      const g = (groups || []).find(x=>String(x.group_id) === String(backBtn.getAttribute('data-stage1-back-group-id')));
      const box = backBtn.closest('.leaflet-popup-content');
      if(g && box) box.innerHTML = popup(g);
    }
  }, true);

  window.WAKASAGI_STAGE1_POINT_DATES = {
    version: STAGE1_VERSION,
    point_m: STAGE1_POINT_M
  };

  stage1Log('installed: physical place 10m / pin=date_count / date->time->detail popup');
})();
