// Wakasagi smartphone GPS candidate to Pico log matcher
// Version: app_visit_matcher_from_candidates_20260527b
//
// Scope:
// - Smartphone/GitHub Pages side only.
// - Reads wakasagiGpsCandidatesCore candidate DB and /logsync payload tlog_activity_rows.
// - Does not get GPS, does not write trip_records directly, does not communicate with Pico W.
// - Only augments the payload and passes it to the already-installed Stage2 receiver.
(function(){
  'use strict';

  const VERSION = 'app_visit_matcher_from_candidates_20260527b';
  const INSTALL_FLAG = '__wakasagiVisitMatcherFromCandidates20260527bInstalled';
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



  function fmtTime(ms){
    const t = Number(ms || 0);
    if(!Number.isFinite(t) || t <= 0) return '-';
    try{
      const d = new Date(t);
      const hh = String(d.getHours()).padStart(2,'0');
      const mm = String(d.getMinutes()).padStart(2,'0');
      const ss = String(d.getSeconds()).padStart(2,'0');
      return hh + ':' + mm + ':' + ss;
    }catch(e){ return '-'; }
  }
  function shortLatLng(v){
    const x = Number(v);
    return Number.isFinite(x) ? x.toFixed(6) : '-';
  }
  function ensureMatcherPanel(){
    let box = document.getElementById('gpsVisitMatchPanel');
    if(box) return box;
    box = document.createElement('div');
    box.id = 'gpsVisitMatchPanel';
    box.className = 'card';
    box.style.marginTop = '12px';
    box.innerHTML = '<div class="cardHead"><div><h2>GPS候補 × 実釣ログ照合</h2><p>スマホ側GPS候補とPico W実釣ログの対応を表示します。GPSだけの候補は保存対象にしません。</p></div><span id="gpsVisitMatchBadge" class="pill">未確認</span></div><div id="gpsVisitMatchBody" class="emptyBox">/logsync後に表示します。</div>';
    const anchor = document.querySelector('.logSyncCard') || document.getElementById('logSyncStatus') || document.querySelector('main') || document.body;
    if(anchor && anchor.parentNode && anchor !== document.body){
      anchor.parentNode.insertBefore(box, anchor.nextSibling);
    }else{
      document.body.appendChild(box);
    }
    return box;
  }
  function renderMatcherDiagnostics(payload, built, mode){
    try{
      const box = ensureMatcherPanel();
      const badge = document.getElementById('gpsVisitMatchBadge');
      const body = document.getElementById('gpsVisitMatchBody');
      if(!body) return;
      const sid = s(payload && payload.sid) || '-';
      const rows = Array.isArray(payload && payload.tlog_activity_rows) ? payload.tlog_activity_rows : [];
      const candidates = built && Array.isArray(built.candidates) ? built.candidates : [];
      const visits = built && Array.isArray(built.visits) ? built.visits : [];
      if(badge){
        badge.textContent = candidates.length ? ('候補' + candidates.length + ' / 実釣' + visits.length) : '候補なし';
      }
      let html = '';
      html += '<div style="font-size:16px;line-height:1.6">';
      html += '<b>sid:</b> ' + sid + '<br>';
      html += '<b>スマホGPS候補:</b> ' + candidates.length + '件 / <b>実釣visit候補:</b> ' + visits.length + '件 / <b>tlog活動行:</b> ' + rows.length + '行<br>';
      html += '<b>判定:</b> ' + (mode || '-') + '<br>';
      html += '</div>';
      if(candidates.length){
        html += '<div style="overflow:auto;margin-top:8px"><table style="width:100%;border-collapse:collapse;font-size:14px;min-width:760px">';
        html += '<thead><tr><th style="text-align:left;border-bottom:1px solid #ccc">候補</th><th style="text-align:left;border-bottom:1px solid #ccc">座標</th><th style="text-align:left;border-bottom:1px solid #ccc">時刻</th><th style="text-align:left;border-bottom:1px solid #ccc">実釣判定</th><th style="text-align:left;border-bottom:1px solid #ccc">根拠</th></tr></thead><tbody>';
        for(const c of candidates){
          const v = visits.find(x => String(x.candidate_id || '') === String(c.candidate_id || '')) || null;
          const lat = c.latest_lat ?? c.lat;
          const lng = c.latest_lng ?? c.lng;
          html += '<tr>';
          html += '<td style="padding:6px;border-bottom:1px solid #eee">G' + String(c.candidate_no || '-') + '</td>';
          html += '<td style="padding:6px;border-bottom:1px solid #eee">' + shortLatLng(lat) + ', ' + shortLatLng(lng) + '<br>±' + String(c.latest_acc_m ?? c.acc_m ?? '-') + 'm</td>';
          html += '<td style="padding:6px;border-bottom:1px solid #eee">' + fmtTime(c.first_seen_ms || c.gps_ms || c.captured_at_ms) + '〜' + fmtTime(c.last_seen_ms || c.first_seen_ms) + '</td>';
          html += '<td style="padding:6px;border-bottom:1px solid #eee">' + (v ? '保存対象' : '保存しない') + '</td>';
          html += '<td style="padding:6px;border-bottom:1px solid #eee">' + (v ? ('motor=' + v.motor_count + ', pulse=' + v.pulse_count + ', event=' + v.fishing_event_count + ', depth=' + v.depth_range_mm + 'mm') : '実釣ログ一致なし') + '</td>';
          html += '</tr>';
        }
        html += '</tbody></table></div>';
      }else{
        html += '<div class="emptyBox" style="margin-top:8px">スマホ側GPS候補DBに、このsidの候補がありません。GPS候補だけではMap履歴へ保存しません。</div>';
      }
      body.innerHTML = html;
    }catch(e){ try{ console.warn('[wakasagi] matcher diagnostics render failed', e); }catch(_e){} }
  }

  const originalApply = (typeof window.v112_applyLogSyncPayload === 'function') ? window.v112_applyLogSyncPayload : null;
  if(!originalApply){
    try{ console.warn('[wakasagi] visit matcher not installed: v112_applyLogSyncPayload missing'); }catch(e){}
    return;
  }

  async function wrappedApplyLogSyncPayload(payload){
    try{
      if(!payload || payload.__error || payload.__stage2_single_visit){
        return await originalApply.call(this, payload);
      }
      const built = await buildVisitsFromSmartphoneCandidates(payload);
      if(!built || !Array.isArray(built.candidates) || !built.candidates.length){
        renderMatcherDiagnostics(payload, built, 'スマホGPS候補なし: 既存Stage2へそのまま渡す');
        return await originalApply.call(this, payload);
      }

      /*
        If smartphone-side candidates exist, use their judged visits as the authoritative
        split for this payload. This avoids a single old /log GPS candidate covering
        an entire fishing session and preventing later smartphone candidates from
        separating actual points.

        This still does not save GPS-only points: built.visits contains only candidates
        that have matching tlog activity rows. If it is empty, Stage2 receives an empty
        gps_visit_candidates array and will not create map visits from GPS alone.
      */
      const next = Object.assign({}, payload, {
        gps_candidate_count:Number(built.candidates.length || 0),
        gps_candidates:built.candidates,
        gps_visit_judged:1,
        gps_visit_candidate_count:Number(built.visits.length || 0),
        gps_visit_candidates:built.visits,
        smartphone_gps_matcher_version:VERSION
      });
      renderMatcherDiagnostics(next, built, built.visits.length ? '実釣ログ一致候補だけStage2へ渡す' : 'GPS候補あり / 実釣一致0件: 保存しない');
      return await originalApply.call(this, next);
    }catch(e){
      try{ console.error('[wakasagi] visit matcher failed; fallback to original', e); }catch(_e){}
      renderMatcherDiagnostics(payload, null, 'matcher失敗: 既存Stage2へフォールバック');
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
