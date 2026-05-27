// Wakasagi smartphone GPS candidate to Pico log matcher
// Version: app_visit_matcher_from_candidates_20260527i
//
// Scope:
// - Smartphone/GitHub Pages side only.
// - Reads wakasagiGpsCandidatesCore candidate DB and /logsync payload tlog_activity_rows. Records session time bridges when available.
// - Does not get GPS, does not write trip_records directly, does not communicate with Pico W.
// - Only augments the payload and passes it to the already-installed Stage2 receiver.
(function(){
  'use strict';

  const VERSION = 'app_visit_matcher_from_candidates_20260527i';
  const INSTALL_FLAG = '__wakasagiVisitMatcherFromCandidates20260527iInstalled';
  if(window[INSTALL_FLAG]) return;
  window[INSTALL_FLAG] = true;

  function s(v){ return String(v == null ? '' : v).trim(); }
  function n(v){ const x = Number(v); return Number.isFinite(x) ? x : null; }
  function hasLatLng(x){ return n(x && (x.latest_lat ?? x.lat)) !== null && n(x && (x.latest_lng ?? x.lng)) !== null; }
  function mapEventIsFishing(ev){ const e = Number(ev) | 0; return e >= 1 && e <= 5; }
  function uniqueId(sid, cand){
    const no = Math.max(1, Number((cand && cand.candidate_no) || 1) | 0);
    const t = Number((cand && (cand.first_seen_ms || cand.gps_ms || cand.captured_at_ms)) || 0);
    const suffix = Number.isFinite(t) && t > 0 ? t.toString(36) : Date.now().toString(36);
    return 'SGV_' + s(sid || 'nosid').replace(/[^A-Za-z0-9_.-]/g,'_') + '_G' + String(no).padStart(4,'0') + '_' + suffix;
  }
  function rowTime(row){ return n(row && (row.r ?? row.recv_ms ?? row.first_recv_ms)); }
  function rowSeq(row){ return n(row && (row.q ?? row.seq)); }
  function rowDepth(row){ return n(row && (row.d ?? row.depth_mm)); }
  function activityStats(rows){
    const out = {
      tlog_count:0,
      activity:false,
      motor_count:0,
      pulse_count:0,
      fishing_event_count:0,
      fish_count:0,
      depth_range_mm:0,
      first_seq:null,
      last_seq:null,
      first_recv_ms:null,
      last_recv_ms:null,
      min_depth_m:null,
      max_depth_m:null,
      used_sasoi:{},
      used_speed:{},
      activity_reason:''
    };
    let minD=null, maxD=null;
    for(const row of (Array.isArray(rows) ? rows : [])){
      const t = rowTime(row);
      const q = rowSeq(row);
      const d = rowDepth(row);
      const m = Number(row && (row.m ?? row.motorRun ?? 0)) || 0;
      const p = Number(row && (row.p ?? row.pulse ?? 0));
      const e = Number(row && (row.e ?? row.event ?? 0)) | 0;
      out.tlog_count++;
      if(Number.isFinite(q)){
        if(out.first_seq === null || q < out.first_seq) out.first_seq = q;
        if(out.last_seq === null || q > out.last_seq) out.last_seq = q;
      }
      if(Number.isFinite(t) && t > 0){
        if(out.first_recv_ms === null || t < out.first_recv_ms) out.first_recv_ms = t;
        if(out.last_recv_ms === null || t > out.last_recv_ms) out.last_recv_ms = t;
      }
      if(Number.isFinite(d)){
        if(minD === null || d < minD) minD = d;
        if(maxD === null || d > maxD) maxD = d;
      }
      if(m > 0) out.motor_count++;
      if(Number.isFinite(p) && p !== 0) out.pulse_count++;
      if(mapEventIsFishing(e)){
        out.fishing_event_count++;
        if(e === 1) out.fish_count++;
      }
      const sp = row && (row.sp ?? row.speedLevel);
      const sa = row && (row.sa ?? row.sasoiType);
      if(sp !== undefined && sp !== null && String(sp) !== '') out.used_speed[String(sp)] = true;
      if(sa !== undefined && sa !== null && String(sa) !== '') out.used_sasoi[String(sa)] = true;
    }
    if(minD !== null && maxD !== null){
      out.depth_range_mm = Math.abs(maxD - minD);
      out.min_depth_m = minD / 1000.0;
      out.max_depth_m = maxD / 1000.0;
    }
    const reasons=[];
    if(out.motor_count > 0) reasons.push('motorRun');
    if(out.pulse_count > 0) reasons.push('pulse');
    if(out.fishing_event_count > 0) reasons.push('event');
    if(out.depth_range_mm >= 1) reasons.push('depth');
    out.activity = reasons.length > 0;
    out.activity_reason = reasons.join(',');
    return out;
  }
  function rowsInWindow(rows, startMs, endMs){
    const st = Number(startMs || 0);
    const en = Number(endMs || 0);
    if(!Number.isFinite(st) || !Number.isFinite(en) || st <= 0 || en < st) return [];
    return (Array.isArray(rows) ? rows : []).filter(row => {
      const t = rowTime(row);
      return Number.isFinite(t) && t >= st && t <= en;
    });
  }
  function visitFromCandidate(parent, cand, rows, idx, endMs){
    const sid = s(parent && parent.sid);
    const st = activityStats(rows);
    if(!st.activity) return null;
    const lat = n(cand.latest_lat ?? cand.lat);
    const lng = n(cand.latest_lng ?? cand.lng);
    if(lat === null || lng === null) return null;
    const visitStart = st.first_recv_ms || n(cand.first_seen_ms) || n(cand.gps_ms) || n(cand.captured_at_ms) || 0;
    const visitEnd = st.last_recv_ms || n(cand.last_seen_ms) || n(cand.first_seen_ms) || visitStart;
    const maxDepthText = st.max_depth_m !== null ? st.max_depth_m.toFixed(3) : '';
    return {
      sid,
      gps_visit_id:uniqueId(sid, cand),
      visit_id:uniqueId(sid, cand),
      candidate_id:s(cand.candidate_id || ''),
      candidate_no:Number(cand.candidate_no || idx + 1),
      gps_lat:String(lat),
      gps_lng:String(lng),
      gps_acc_m:String(cand.latest_acc_m ?? cand.acc_m ?? ''),
      visit_start_ms:Number(visitStart || 0),
      visit_end_ms:Number(visitEnd || endMs || visitStart || 0),
      start_ms:Number(visitStart || 0),
      updated_ms:Number(visitEnd || endMs || visitStart || Date.now()),
      first_seq:st.first_seq !== null ? st.first_seq : '',
      last_seq:st.last_seq !== null ? st.last_seq : '',
      first_recv_ms:st.first_recv_ms !== null ? st.first_recv_ms : '',
      last_recv_ms:st.last_recv_ms !== null ? st.last_recv_ms : '',
      fish_count:Number(st.fish_count || 0),
      mark_count:0,
      tlog_count:Number(st.tlog_count || 0),
      motor_count:Number(st.motor_count || 0),
      pulse_count:Number(st.pulse_count || 0),
      fishing_event_count:Number(st.fishing_event_count || 0),
      depth_range_mm:Number(st.depth_range_mm || 0),
      activity_reason:String(st.activity_reason || ''),
      min_depth_m:st.min_depth_m !== null ? st.min_depth_m.toFixed(3) : '',
      max_depth_m:maxDepthText,
      fishfinder_depth_m:maxDepthText,
      water_depth_m:maxDepthText,
      depth_status:maxDepthText ? 'measured' : 'not_measured',
      used_sasoi:Object.keys(st.used_sasoi || {}).join(','),
      used_speed:Object.keys(st.used_speed || {}).join(','),
      source:'smartphone_gps_candidate_matcher',
      matcher_version:VERSION
    };
  }
  async function buildVisitsFromSmartphoneCandidates(payload){
    const sid = s(payload && payload.sid);
    if(!sid) return null;
    const core = window.wakasagiGpsCandidatesCore;
    if(!core || typeof core.list !== 'function') return null;
    const rows = Array.isArray(payload.tlog_activity_rows) ? payload.tlog_activity_rows : [];
    const candidates = (await core.list(sid)).filter(hasLatLng).sort((a,b)=>Number(a.first_seen_ms||0)-Number(b.first_seen_ms||0));
    if(!candidates.length) return null;

    const fallbackEndMs = Math.max(
      Number(payload.last_recv_ms || 0),
      Number(payload.updated_ms || 0),
      rows.reduce((m,r)=>Math.max(m, Number(rowTime(r) || 0)), 0),
      Date.now()
    );

    const visits=[];
    for(let i=0;i<candidates.length;i++){
      const c = candidates[i];
      const next = candidates[i+1] || null;
      const start = Number(c.first_seen_ms || c.gps_ms || c.captured_at_ms || 0);
      const end = next ? Number(next.first_seen_ms || fallbackEndMs) - 1 : fallbackEndMs;
      const hitRows = rowsInWindow(rows, start, end);
      const v = visitFromCandidate(payload, c, hitRows, i, end);
      if(v) visits.push(v);
    }
    return {candidates, visits};
  }

  const originalApply = (typeof window.v112_applyLogSyncPayload === 'function') ? window.v112_applyLogSyncPayload : null;
  if(!originalApply){
    try{ console.warn('[wakasagi] visit matcher not installed: v112_applyLogSyncPayload missing'); }catch(e){}
    return;
  }

  async function wrappedApplyLogSyncPayload(payload){
    try{
      try{
        if(payload && !payload.__stage2_single_visit && window.wakasagiSessionTimeBridge && typeof window.wakasagiSessionTimeBridge.recordPayload === 'function'){
          await window.wakasagiSessionTimeBridge.recordPayload(payload);
        }
      }catch(_bridgeErr){}

      if(!payload || payload.__error || payload.__stage2_single_visit){
        return await originalApply.call(this, payload);
      }
      const built = await buildVisitsFromSmartphoneCandidates(payload);
      if(!built || !Array.isArray(built.candidates) || !built.candidates.length){
        return await originalApply.call(this, payload);
      }

      /*
        Fallback-safe rule:
        - Smartphone GPS candidates may improve point separation only when they produce
          at least one activity-backed visit.
        - If candidates exist but none match tlog activity, do NOT replace the original
          payload. This preserves the existing Pico W / Stage2 save path and prevents
          the map history from disappearing because of a candidate/log timing mismatch.
        - GPS-only candidates are still never saved: built.visits contains only candidates
          that have matching motor / pulse / event / depth activity rows.
      */
      if(!Array.isArray(built.visits) || built.visits.length <= 0){
        try{ console.info('[wakasagi] smartphone GPS candidates found but no activity-backed visits; preserving original payload'); }catch(_e){}
        return await originalApply.call(this, payload);
      }

      const originalVisitCount = Array.isArray(payload.gps_visit_candidates)
        ? payload.gps_visit_candidates.length
        : Number(payload.gps_visit_candidate_count || 0);

      /*
        Additional non-regression rule:
        - If the Pico W /log payload already contains more activity-backed visits than
          the smartphone matcher can safely produce, keep the original payload.
        - This prevents a sparse or stale smartphone GPS candidate set from reducing
          valid Pico W visits and hiding history that used to be saved.
      */
      if(Number.isFinite(originalVisitCount) && originalVisitCount > built.visits.length){
        try{ console.info('[wakasagi] smartphone GPS matched fewer visits than original payload; preserving original payload'); }catch(_e){}
        return await originalApply.call(this, payload);
      }

      const next = Object.assign({}, payload, {
        gps_candidate_count:Number(built.candidates.length || 0),
        gps_candidates:built.candidates,
        gps_visit_judged:1,
        gps_visit_candidate_count:Number(built.visits.length || 0),
        gps_visit_candidates:built.visits,
        smartphone_gps_matcher_version:VERSION,
        smartphone_gps_matcher_mode:'replace_only_when_matched'
      });
      return await originalApply.call(this, next);
    }catch(e){
      try{ console.error('[wakasagi] visit matcher failed; fallback to original', e); }catch(_e){}
      return await originalApply.call(this, payload);
    }
  }

  try{ window.v112_applyLogSyncPayload = wrappedApplyLogSyncPayload; }catch(e){}
  try{ v112_applyLogSyncPayload = wrappedApplyLogSyncPayload; }catch(e){}
  window.wakasagiVisitMatcherFromCandidates = {
    version:VERSION,
    buildVisitsFromSmartphoneCandidates
  };
  try{ console.info('[wakasagi] visit matcher from smartphone candidates installed', VERSION); }catch(e){}
})();
