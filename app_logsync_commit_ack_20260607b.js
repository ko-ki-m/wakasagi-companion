'use strict';
(function(){
  const PATCH = 'logsync_commit_ack_20260607b';
  const ACK_HASH = '#mapsaved=';
  const VERIFY_TRIES = 8;
  const VERIFY_WAIT_MS = 180;

  function text(v){ return String(v === undefined || v === null ? '' : v).trim(); }
  function num(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }
  function validLatLng(lat,lng){ return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180; }
  function distM(a,b,c,d){
    const R=6371008.8, r=x=>x*Math.PI/180;
    const p1=r(a), p2=r(c), dp=r(c-a), dl=r(d-b);
    const x=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return 2*R*Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
  }
  function wait(ms){ return new Promise(r=>setTimeout(r, ms)); }
  function setStatus(msg, cls){
    try{ if(typeof v112_setLogSync === 'function') v112_setLogSync(msg, cls || ''); }catch(e){}
    try{
      const b=document.getElementById('logSyncBadge');
      const s=document.getElementById('logSyncStatus');
      if(b){ b.textContent=msg; b.className='pill '+(cls||''); }
      if(s) s.textContent=msg;
    }catch(e){}
  }
  function b64(obj){
    const json = JSON.stringify(obj);
    return btoa(unescape(encodeURIComponent(json)));
  }
  function getPicoOrigin(){
    try{
      const p = new URLSearchParams(location.search);
      let v = text(p.get('pico'));
      if(!v && typeof v115_getPicoHost === 'function') v = text(v115_getPicoHost());
      if(!v) v = text(localStorage.getItem('pico_ip'));
      if(!v) v = '192.168.4.1';
      v = decodeURIComponent(v).replace(/\/.*$/,'');
      if(/^https?:\/\//i.test(v)) return v.replace(/\/$/,'');
      return 'http://' + v.replace(/^\/+/, '').replace(/\/$/, '');
    }catch(e){
      return 'http://192.168.4.1';
    }
  }
  function flatValues(obj, out, depth){
    if(!obj || depth > 4) return;
    if(Array.isArray(obj)){
      for(const v of obj) flatValues(v, out, depth+1);
      return;
    }
    if(typeof obj !== 'object') return;
    for(const k of Object.keys(obj)){
      const v = obj[k];
      if(v === undefined || v === null) continue;
      if(typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'){
        out.push(text(v));
      }else if(typeof v === 'object'){
        flatValues(v, out, depth+1);
      }
    }
  }
  function tripHasText(t, needle){
    const n = text(needle);
    if(!n) return false;
    const vals=[];
    flatValues(t, vals, 0);
    return vals.some(v=>v===n);
  }
  function tripHasSid(t, sid){
    const s=text(sid);
    if(!s) return false;
    if(text(t && t.pico_sid) === s) return true;
    if(text(t && t.sid) === s) return true;
    if(t && t.pico_summary && text(t.pico_summary.sid) === s) return true;
    if(Array.isArray(t && t.pico_logs) && t.pico_logs.some(x=>text(x && x.sid)===s)) return true;
    return tripHasText(t, s);
  }
  function candidateKey(c){
    return text(c && (c.gps_visit_id || c.visit_id || c.point_visit_id || c.map_point_key || c.trip_id));
  }
  function candidateLatLng(c){
    const lat = num(c && (c.gps_lat || c.lat));
    const lng = num(c && (c.gps_lng || c.lng));
    return validLatLng(lat,lng) ? {lat,lng} : null;
  }
  function tripLatLng(t){
    const lat = num(t && t.lat);
    const lng = num(t && t.lng);
    return validLatLng(lat,lng) ? {lat,lng} : null;
  }
  function candidateSaved(c, trips, sid){
    const key = candidateKey(c);
    if(key){
      const byKey = trips.find(t => tripHasText(t, key));
      if(byKey) return byKey;
    }
    const cll = candidateLatLng(c);
    if(!cll) return null;
    let best=null, bestD=Infinity;
    for(const t of trips){
      if(sid && !tripHasSid(t, sid) && key && !tripHasText(t, key)) continue;
      const tll = tripLatLng(t);
      if(!tll) continue;
      const d = distM(cll.lat, cll.lng, tll.lat, tll.lng);
      if(d <= 15 && d < bestD){ best=t; bestD=d; }
    }
    return best;
  }
  function mainPayloadSaved(p, trips){
    const sid = text(p && p.sid);
    const key = text(p && (p.point_visit_id || p.map_point_key || p.trip_id || p.map_spot_id || p.spot_id));
    if(key){
      const byKey = trips.find(t => tripHasText(t, key));
      if(byKey) return byKey;
    }
    if(sid){
      const bySid = trips.find(t => tripHasSid(t, sid));
      if(bySid) return bySid;
    }
    const lat = num(p && (p.gps_lat || p.lat));
    const lng = num(p && (p.gps_lng || p.lng));
    if(validLatLng(lat,lng)){
      let best=null, bestD=Infinity;
      for(const t of trips){
        const tll = tripLatLng(t);
        if(!tll) continue;
        const d = distM(lat,lng,tll.lat,tll.lng);
        if(d <= 15 && d < bestD){ best=t; bestD=d; }
      }
      if(best) return best;
    }
    return null;
  }
  async function readTrips(){
    if(typeof getAllTrips !== 'function') return [];
    return await getAllTrips();
  }
  async function verifySaved(p){
    const sid = text(p && p.sid);
    const cands = Array.isArray(p && p.gps_visit_candidates) ? p.gps_visit_candidates.slice() : [];
    const expectedCount = Number((p && p.gps_visit_candidate_count) || cands.length || 0);

    for(let i=0;i<VERIFY_TRIES;i++){
      const trips = await readTrips();

      if(expectedCount > 0){
        if(cands.length < expectedCount){
          return {ok:false, reason:'gps_visit_candidates missing', trip_count:trips.length, expected_visit_count:expectedCount, saved_visit_count:0, saved_trip_ids:[]};
        }
        const saved=[];
        for(const c of cands){
          const hit = candidateSaved(c, trips, sid);
          if(hit) saved.push(hit);
        }
        if(saved.length >= expectedCount){
          return {ok:true, reason:'all gps visits saved', trip_count:trips.length, expected_visit_count:expectedCount, saved_visit_count:saved.length, saved_trip_ids:saved.map(t=>text(t.trip_id)).filter(Boolean)};
        }
      }else{
        const hit = mainPayloadSaved(p, trips);
        if(hit){
          return {ok:true, reason:'main payload saved', trip_count:trips.length, expected_visit_count:0, saved_visit_count:1, saved_trip_ids:[text(hit.trip_id)].filter(Boolean)};
        }
      }
      await wait(VERIFY_WAIT_MS);
    }

    const trips = await readTrips();
    return {ok:false, reason:'save verify failed', trip_count:trips.length, expected_visit_count:expectedCount, saved_visit_count:0, saved_trip_ids:[]};
  }
  function buildAck(p, verify){
    return {
      v:1,
      ok: verify && verify.ok ? 1 : 0,
      source: PATCH,
      sid: text(p && p.sid),
      map_sync_id: text(p && p.map_sync_id),
      saved_ms: Date.now(),
      reason: text(verify && verify.reason),
      trip_count: Number((verify && verify.trip_count) || 0),
      expected_visit_count: Number((verify && verify.expected_visit_count) || 0),
      saved_visit_count: Number((verify && verify.saved_visit_count) || 0),
      saved_trip_ids: Array.isArray(verify && verify.saved_trip_ids) ? verify.saved_trip_ids : []
    };
  }
  async function returnAckToPico(p, verify){
    const ack = buildAck(p, verify || {ok:false, reason:'unknown'});
    const url = getPicoOrigin() + '/log' + ACK_HASH + encodeURIComponent(b64(ack));
    location.href = url;
  }
  async function afterOriginalApply(p, ret){
    const needsAck = !!(p && (p.map_ack_required || p.map_sync_id));
    if(!needsAck) return ret;

    let verify = null;

    if(ret !== true){
      verify = {ok:false, reason:'logsync apply failed', trip_count:0, expected_visit_count:0, saved_visit_count:0, saved_trip_ids:[]};
      setStatus('Map保存失敗: logsync処理失敗','bad');
      await wait(200);
      await returnAckToPico(p, verify);
      return false;
    }

    setStatus('Map保存確認中','warn');
    try{ if(typeof refreshAll === 'function') await refreshAll(); }catch(e){}

    try{
      verify = await verifySaved(p);
    }catch(e){
      verify = {ok:false, reason:'verify exception', trip_count:0, expected_visit_count:0, saved_visit_count:0, saved_trip_ids:[]};
    }

    if(verify && verify.ok){
      setStatus('Map保存確認済み','good');
      try{ if(typeof refreshAll === 'function') await refreshAll(); }catch(e){}
      await wait(250);
      await returnAckToPico(p, verify);
      return true;
    }

    /*
      保存確認NGでも必ずPico W /logへ戻す。
      Pico W側は ok=0 を受けても要求を消さず、
      本体停止後の安全周期で同じ要求を再試行する。
    */
    setStatus('Map保存未確認: /logへ戻して再試行待機','bad');
    console.warn('[wakasagi] '+PATCH+' verify failed', verify, p);
    await wait(250);
    await returnAckToPico(p, verify || {ok:false, reason:'save verify failed'});
    return false;
  }
  function install(){
    let original = null;
    try{ original = (typeof window.v112_applyLogSyncPayload === 'function') ? window.v112_applyLogSyncPayload : null; }catch(e){}
    if(!original){
      try{ original = (typeof v112_applyLogSyncPayload === 'function') ? v112_applyLogSyncPayload : null; }catch(e){}
    }
    if(!original) return false;
    if(original.__wakasagiCommitAck20260607b) return true;

    const wrapped = async function(p){
      const ret = await original.call(this, p);
      return await afterOriginalApply(p, ret);
    };
    wrapped.__wakasagiCommitAck20260607b = true;
    wrapped.__original = original;

    try{ window.v112_applyLogSyncPayload = wrapped; }catch(e){}
    try{ v112_applyLogSyncPayload = wrapped; }catch(e){}
    console.info('[wakasagi] '+PATCH+' installed');
    return true;
  }
  let tries=0;
  function boot(){
    tries++;
    if(install()) return;
    if(tries < 120) setTimeout(boot, 100);
    else console.warn('[wakasagi] '+PATCH+' could not install');
  }
  boot();
})();
