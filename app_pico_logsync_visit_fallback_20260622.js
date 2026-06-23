/*
 * app_pico_logsync_visit_fallback_20260622.js
 * Pico W #logsync fallback for Map-side save.
 * - does not call Pico W
 * - does not touch gps-bridge / gps-recorder
 * - does not write without body activity proof
 * - only fills gps_visit_candidates when Pico payload has gps_candidates + tlog_activity_rows but no valid visits
 */
(function(){
  'use strict';
  const FLAG='__wakasagiPicoLogsyncVisitFallback20260622Installed';
  if(window[FLAG]) return;
  window[FLAG]=true;

  function s(v){ return String(v == null ? '' : v).trim(); }
  function n(v){ const x=Number(v); return Number.isFinite(x) ? x : null; }
  function firstNum(){ for(const v of arguments){ const x=n(v); if(x !== null && x > 0) return x; } return null; }
  function validLatLng(lat,lng){ const a=Number(lat), b=Number(lng); return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a)<=90&&Math.abs(b)<=180&&!(a===0&&b===0); }
  function isPicoPayload(p){ return !!(p && (s(p.source)==='pico_log_summary' || Array.isArray(p.gps_candidates) || Array.isArray(p.gps_visit_candidates) || Array.isArray(p.tlog_activity_rows))); }
  function rowSeq(r){ return n(r && (r.q ?? r.seq ?? (Array.isArray(r.a)?r.a[0]:undefined))); }
  function rowRecv(r){ return n(r && (r.r ?? r.recv_ms)); }
  function rowTms(r){ return n(r && (r.t ?? r.t_ms ?? (Array.isArray(r.a)?r.a[1]:undefined))); }
  function rowDepthMm(r){ return n(r && (r.d ?? r.depth_mm ?? (Array.isArray(r.a)?r.a[2]:undefined))); }
  function rowMotor(r){ return Number(r && (r.m ?? r.motorRun ?? (Array.isArray(r.a)?r.a[7]:0)) || 0); }
  function rowPulse(r){ return Number(r && (r.p ?? r.pulse ?? (Array.isArray(r.a)?r.a[8]:0)) || 0); }
  function rowEvent(r){ return Number(r && (r.e ?? r.event ?? (Array.isArray(r.a)?r.a[10]:0)) || 0) | 0; }
  function isBodyRow(r){ const ev=rowEvent(r); return rowMotor(r)>0 || rowPulse(r)!==0 || (ev>=1&&ev<=5); }
  function hasVisitProof(v){ return Number(v&&v.motor_count||0)>0 || Number(v&&v.pulse_count||0)>0 || Number(v&&v.fishing_event_count||0)>0 || /(^|,)(motorRun|pulse|event|depth)(,|$)/.test(s(v&&v.activity_reason)); }
  function hasValidVisit(v){ return !!(v && s(v.gps_visit_id||v.visit_id) && validLatLng(v.gps_lat||v.lat,v.gps_lng||v.lng) && hasVisitProof(v)); }
  function visitId(sid,c,no){ const st=Number(c&&c.start_ms||0); return 'GV_'+s(sid||'nosid')+'_G'+String(no).padStart(4,'0')+'_'+(st>0?st.toString(36):Date.now().toString(36)); }
  function depthText(mm){ const x=n(mm); return x===null ? '' : (x/1000).toFixed(3); }
  function statRows(rows){
    const st={activity:false,tlog_count:0,motor_count:0,pulse_count:0,fishing_event_count:0,fish_count:0,depth_range_mm:0,first_seq:null,last_seq:null,first_t_ms:null,last_t_ms:null,first_recv_ms:null,last_recv_ms:null,min_depth_m:null,max_depth_m:null,activity_reason:''};
    let minD=null,maxD=null;
    for(const r of rows){
      const q=rowSeq(r), recv=rowRecv(r), t=rowTms(r), d=rowDepthMm(r), ev=rowEvent(r), m=rowMotor(r), p=rowPulse(r);
      st.tlog_count++;
      if(q!==null){ if(st.first_seq===null||q<st.first_seq)st.first_seq=q; if(st.last_seq===null||q>st.last_seq)st.last_seq=q; }
      if(t!==null){ if(st.first_t_ms===null||t<st.first_t_ms)st.first_t_ms=t; if(st.last_t_ms===null||t>st.last_t_ms)st.last_t_ms=t; }
      if(recv!==null){ if(st.first_recv_ms===null||recv<st.first_recv_ms)st.first_recv_ms=recv; if(st.last_recv_ms===null||recv>st.last_recv_ms)st.last_recv_ms=recv; }
      if(d!==null){ if(minD===null||d<minD)minD=d; if(maxD===null||d>maxD)maxD=d; }
      if(m>0) st.motor_count++;
      if(p!==0) st.pulse_count++;
      if(ev>=1&&ev<=5) st.fishing_event_count++;
      if(ev===1) st.fish_count++;
    }
    if(minD!==null&&maxD!==null){ st.depth_range_mm=Math.abs(maxD-minD); st.min_depth_m=minD/1000; st.max_depth_m=maxD/1000; }
    const rs=[]; if(st.motor_count>0)rs.push('motorRun'); if(st.pulse_count>0)rs.push('pulse'); if(st.fishing_event_count>0)rs.push('event'); if(st.depth_range_mm>=1)rs.push('depth');
    st.activity=rs.length>0; st.activity_reason=rs.join(',');
    return st;
  }
  function synthVisits(p){
    const existing=Array.isArray(p&&p.gps_visit_candidates)?p.gps_visit_candidates.filter(hasValidVisit):[];
    if(existing.length) return existing;
    const cand=(Array.isArray(p&&p.gps_candidates)?p.gps_candidates:[]).filter(c=>validLatLng(c.latest_lat||c.lat,c.latest_lng||c.lng)).sort((a,b)=>Number(a.start_seq||0)-Number(b.start_seq||0)||Number(a.start_ms||0)-Number(b.start_ms||0));
    const body=(Array.isArray(p&&p.tlog_activity_rows)?p.tlog_activity_rows:[]).filter(isBodyRow).sort((a,b)=>(rowSeq(a)||0)-(rowSeq(b)||0));
    if(!body.length) return [];
    const out=[];
    if(cand.length){
      for(let i=0;i<cand.length;i++){
        const c=cand[i]; const next=cand[i+1]||null; const no=Math.max(1,Number(c.candidate_no||c.no||i+1)|0);
        const stSeq=Number(c.start_seq||0); const nextSeq=next?Number(next.start_seq||0):Infinity;
        let rows=body.filter(r=>{ const q=rowSeq(r); return q!==null && q>=stSeq && q<nextSeq; });
        if(!rows.length && cand.length===1) rows=body.slice();
        const st=statRows(rows); if(!st.activity) continue;
        const maxDepth=st.max_depth_m!==null?String(st.max_depth_m.toFixed(3)):'';
        out.push({
          v:1, source:'github_pico_logsync_visit_fallback_20260622', sid:s(p.sid), gps_visit_id:visitId(p.sid,c,no), candidate_no:no,
          visit_start_ms:Number(c.start_ms||st.first_recv_ms||p.start_ms||Date.now()), visit_end_ms:Number(c.end_ms||st.last_recv_ms||p.updated_ms||Date.now()),
          start_seq:stSeq, end_seq:next&&Number.isFinite(nextSeq)?nextSeq-1:(st.last_seq||Number(c.end_seq||stSeq)),
          start_ms:st.first_recv_ms||Number(c.start_ms||p.start_ms||Date.now()), updated_ms:st.last_recv_ms||Number(c.end_ms||p.updated_ms||Date.now()),
          gps_lat:s(c.latest_lat||c.best_lat||c.lat), gps_lng:s(c.latest_lng||c.best_lng||c.lng), gps_acc_m:s(c.latest_acc_m||c.best_acc_m||c.acc_m||''),
          gps_quality:s(c.gps_quality||''), gps_quality_label:s(c.gps_quality_label||''),
          place_name:s(p.place_name||p.lake_name||''), line_no:s(p.line_no||''), sinker_g:s(p.sinker_g||''),
          fishfinder_depth_m:maxDepth, water_depth_m:maxDepth, depth_source:maxDepth?'reel_log_max':'', depth_measured:maxDepth?'1':'0', depth_status:maxDepth?'measured':'not_measured',
          water_temp_c:s(p.water_temp_c||''), weather_text:s(p.weather_text||p.weather||''), weather:s(p.weather||p.weather_text||''), wind_dir:s(p.wind_dir||''), wind_speed_mps:s(p.wind_speed_mps||''), wind:s(p.wind||''), pressure_hpa:s(p.pressure_hpa||p.pressure||p.air_pressure_hpa||''), note:s(p.note||''),
          fish_count:Number(st.fish_count||0), mark_count:0, tlog_count:Number(st.tlog_count||0), first_seq:st.first_seq||'', last_seq:st.last_seq||'', first_t_ms:st.first_t_ms||'', last_t_ms:st.last_t_ms||'', first_recv_ms:st.first_recv_ms||'', last_recv_ms:st.last_recv_ms||'',
          min_depth_m:st.min_depth_m!==null?st.min_depth_m.toFixed(3):'', max_depth_m:st.max_depth_m!==null?st.max_depth_m.toFixed(3):'', motor_count:st.motor_count, pulse_count:st.pulse_count, fishing_event_count:st.fishing_event_count, depth_range_mm:st.depth_range_mm, activity_reason:st.activity_reason,
          pico_point_visit_id:s(p.point_visit_id||p.map_point_key||p.pico_point_visit_id||''), map_spot_id:s(p.map_spot_id||''), map_source:s(p.map_source||'')
        });
      }
    }
    if(!out.length && validLatLng(p&&p.gps_lat,p&&p.gps_lng)){
      const st=statRows(body); if(st.activity){ const maxDepth=st.max_depth_m!==null?String(st.max_depth_m.toFixed(3)):''; out.push({v:1,source:'github_pico_logsync_single_fallback_20260622',sid:s(p.sid),gps_visit_id:visitId(p.sid,{start_ms:p.start_ms},1),candidate_no:1,visit_start_ms:Number(p.start_ms||st.first_recv_ms||Date.now()),visit_end_ms:Number(p.updated_ms||st.last_recv_ms||Date.now()),start_seq:st.first_seq||0,end_seq:st.last_seq||0,start_ms:st.first_recv_ms||Number(p.start_ms||Date.now()),updated_ms:st.last_recv_ms||Number(p.updated_ms||Date.now()),gps_lat:s(p.gps_lat),gps_lng:s(p.gps_lng),gps_acc_m:s(p.gps_acc_m||''),place_name:s(p.place_name||p.lake_name||''),line_no:s(p.line_no||''),sinker_g:s(p.sinker_g||''),fishfinder_depth_m:maxDepth,water_depth_m:maxDepth,depth_source:maxDepth?'reel_log_max':'',depth_measured:maxDepth?'1':'0',depth_status:maxDepth?'measured':'not_measured',water_temp_c:s(p.water_temp_c||''),weather_text:s(p.weather_text||p.weather||''),weather:s(p.weather||p.weather_text||''),wind:s(p.wind||''),pressure_hpa:s(p.pressure_hpa||p.pressure||p.air_pressure_hpa||''),fish_count:Number(st.fish_count||0),mark_count:0,tlog_count:Number(st.tlog_count||0),first_seq:st.first_seq||'',last_seq:st.last_seq||'',first_t_ms:st.first_t_ms||'',last_t_ms:st.last_t_ms||'',first_recv_ms:st.first_recv_ms||'',last_recv_ms:st.last_recv_ms||'',min_depth_m:st.min_depth_m!==null?st.min_depth_m.toFixed(3):'',max_depth_m:st.max_depth_m!==null?st.max_depth_m.toFixed(3):'',motor_count:st.motor_count,pulse_count:st.pulse_count,fishing_event_count:st.fishing_event_count,depth_range_mm:st.depth_range_mm,activity_reason:st.activity_reason}); }
    }
    return out;
  }
  function install(){
    const base=window.v112_applyLogSyncPayload;
    if(typeof base!=='function'){ setTimeout(install,120); return; }
    if(base.__picoFallback20260622) return;
    async function wrapped(p){
      if(isPicoPayload(p)){
        const visits=synthVisits(p);
        if(visits.length && !(Array.isArray(p.gps_visit_candidates)&&p.gps_visit_candidates.some(hasValidVisit))){
          const p2=Object.assign({},p,{gps_visit_judged:1,gps_visit_candidate_count:visits.length,gps_visit_candidates:visits});
          return await base.call(this,p2);
        }
      }
      return await base.call(this,p);
    }
    wrapped.__picoFallback20260622=true;
    window.v112_applyLogSyncPayload=wrapped;
    try{ v112_applyLogSyncPayload=wrapped; }catch(e){}
    console.info('[wakasagi] pico logsync visit fallback 20260622 installed');
  }
  install();
})();
