(function(){
  'use strict';

  const INSTALL_FLAG = '__wakasagiStage2VisitReceiver20260526mInstalled';
  if(window[INSTALL_FLAG]) return;
  window[INSTALL_FLAG] = true;

  const VERSION = 'stage2_visit_receiver_20260526m_safety_diagnosis_no_autosave';

  function s(v){ return String(v == null ? '' : v).trim(); }
  function n(v){ const x = Number(v); return Number.isFinite(x) ? x : null; }
  function esc(v){
    return String(v == null ? '' : v).replace(/[&<>"']/g, m => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[m]));
  }
  function pad2(v){ return String(v).padStart(2,'0'); }
  function fmtMs(ms){
    const x = Number(ms || 0);
    if(!Number.isFinite(x) || x <= 0) return '-';
    const d = new Date(x);
    if(Number.isNaN(d.getTime())) return '-';
    return d.getFullYear() + '/' + pad2(d.getMonth()+1) + '/' + pad2(d.getDate()) + ' ' +
           pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  function hasLatLng(p){
    return Number.isFinite(Number(p && (p.gps_lat || p.latest_lat || p.lat))) &&
           Number.isFinite(Number(p && (p.gps_lng || p.latest_lng || p.lng)));
  }
  function depthMaxTextLocal(){
    try{
      if(typeof v112_depthMaxText === 'function') return v112_depthMaxText.apply(null, arguments);
    }catch(e){}
    for(const v of arguments){
      const t = s(v);
      if(t && t !== '-' && t !== '0' && t !== '0.0') return t;
    }
    return '';
  }
  function setLogSync(text, cls){
    try{
      if(typeof v112_setLogSync === 'function') v112_setLogSync(text, cls || '');
    }catch(e){}
    const st = document.getElementById('logSyncStatus');
    if(st) st.textContent = text;
    const b = document.getElementById('logSyncBadge');
    if(b){
      b.textContent = cls === 'good' ? '診断済' : (cls === 'warn' ? '要確認' : '未同期');
      b.className = 'pill ' + (cls || '');
    }
  }
  function clearLogSyncHash(){
    try{
      if(history && history.replaceState){
        history.replaceState(null, document.title, location.pathname + location.search);
      }
    }catch(e){}
  }

  const originalFind = (typeof v112_findTripForLogSync === 'function') ? v112_findTripForLogSync : null;
  const originalMake = (typeof v112_makeTripFromLogSync === 'function') ? v112_makeTripFromLogSync : null;
  const originalSummary = (typeof v112_makePicoSummary === 'function') ? v112_makePicoSummary : null;
  const originalApply = (typeof v112_applyLogSyncPayload === 'function') ? v112_applyLogSyncPayload : null;
  if(!originalApply) return;

  async function stage2FindTripForLogSync(p){
    const visitKey = s(p && (p.gps_visit_id || p.visit_id));
    if(visitKey && typeof getAllTrips === 'function'){
      const trips = await getAllTrips();
      for(const t of trips){
        if(s(t.gps_visit_id) === visitKey) return t;
        if(t.pico_summary && s(t.pico_summary.gps_visit_id) === visitKey) return t;
        if(Array.isArray(t.pico_logs) && t.pico_logs.some(l => s(l.gps_visit_id) === visitKey)) return t;
      }
      return null;
    }
    if(originalFind) return await originalFind.call(this, p);
    return null;
  }

  function stage2MakeTripFromLogSync(p){
    const visitKey = s(p && (p.gps_visit_id || p.visit_id));
    if(!visitKey || !originalMake) return originalMake ? originalMake.call(this, p) : null;
    const t = originalMake.call(this, p);
    if(!t) return t;
    t.gps_visit_id = visitKey;
    t.pico_point_visit_id = s(p.pico_point_visit_id || p.point_visit_id || p.map_point_key);
    t.point_visit_id = '';
    t.map_point_key = '';
    t.date_ms = n(p.start_ms) || n(p.first_recv_ms) || n(p.visit_start_ms) || t.date_ms || Date.now();
    t.location_time_ms = n(p.visit_start_ms) || n(p.gps_ms) || n(p.start_ms) || t.location_time_ms || Date.now();
    if(!s(t.point_name)) t.point_name = 'Pico W実釣地点';
    return t;
  }

  function stage2MakePicoSummary(p){
    const x = originalSummary ? originalSummary.call(this, p) : {};
    if(p && (p.gps_visit_id || p.visit_id)) x.gps_visit_id = s(p.gps_visit_id || p.visit_id);
    if(p && p.pico_point_visit_id) x.pico_point_visit_id = s(p.pico_point_visit_id);
    return x;
  }

  function mergeVisitPayload(parent, visit){
    const p = Object.assign({}, parent || {}, visit || {});
    p.__stage2_single_visit = true;
    p.sid = s((parent && parent.sid) || (visit && visit.sid));

    const fallbackKeys = [
      'lake_name','point_name','place_name','line_no','sinker_g','water_temp_c',
      'weather_text','weather','wind_dir','wind_speed_mps','wind','note','map_source'
    ];
    for(const k of fallbackKeys){
      if(!s(p[k]) && parent && parent[k] !== undefined) p[k] = parent[k];
    }

    p.gps_visit_id = s(visit && (visit.gps_visit_id || visit.visit_id));
    p.pico_point_visit_id = s((visit && visit.pico_point_visit_id) || (parent && (parent.point_visit_id || parent.map_point_key || parent.pico_point_visit_id)));
    p.gps_lat = s((visit && (visit.gps_lat || visit.latest_lat || visit.lat)) || p.gps_lat || p.lat);
    p.gps_lng = s((visit && (visit.gps_lng || visit.latest_lng || visit.lng)) || p.gps_lng || p.lng);
    p.gps_acc_m = s((visit && (visit.gps_acc_m || visit.acc_m || visit.acc)) || p.gps_acc_m || p.acc);
    p.point_visit_id = '';
    p.map_point_key = '';

    const depth = depthMaxTextLocal(p.fishfinder_depth_m, p.max_depth_m, p.fishfinder_m, p.water_depth_m);
    p.fishfinder_depth_m = depth;
    p.water_depth_m = depth;
    p.depth_status = depth ? 'measured' : 'not_measured';
    return p;
  }

  function ensureDiagnosisPanel(){
    let panel = document.getElementById('stage2VisitSafetyDiagnosisPanel');
    if(panel) return panel;

    panel = document.createElement('section');
    panel.className = 'card';
    panel.id = 'stage2VisitSafetyDiagnosisPanel';
    panel.innerHTML = '' +
      '<div class="cardHead">' +
        '<div>' +
          '<h2>GPS候補 × 実釣ログ 保存前診断</h2>' +
          '<p>GPS候補とPico W実釣ログの対応を確認します。この診断中はtrip_recordsへ保存しません。</p>' +
        '</div>' +
        '<span id="stage2VisitSafetyDiagnosisBadge" class="pill warn">未診断</span>' +
      '</div>' +
      '<div id="stage2VisitSafetyDiagnosisBody" class="emptyBox">未診断</div>';

    const ref = document.querySelector('.logSyncCard') || document.getElementById('logSyncStatus') || document.querySelector('main') || document.body;
    if(ref && ref.parentNode){
      ref.parentNode.insertBefore(panel, ref.nextSibling);
    }else{
      document.body.appendChild(panel);
    }
    return panel;
  }

  function visitKeyFromCandidate(c){
    const no = s(c && c.candidate_no);
    if(no) return 'no:' + no;
    const st = s(c && c.start_ms);
    const lat = s(c && (c.latest_lat || c.lat));
    const lng = s(c && (c.latest_lng || c.lng));
    return 'raw:' + st + ':' + lat + ':' + lng;
  }

  function renderDiagnosis(parent, visits){
    ensureDiagnosisPanel();
    const badge = document.getElementById('stage2VisitSafetyDiagnosisBadge');
    const body = document.getElementById('stage2VisitSafetyDiagnosisBody');
    if(!body) return;

    const gpsCandidates = Array.isArray(parent && parent.gps_candidates) ? parent.gps_candidates : [];
    const validVisits = Array.isArray(visits) ? visits : [];
    const visitMap = new Map();
    for(const v of validVisits){
      visitMap.set(visitKeyFromCandidate(v), v);
      if(s(v.candidate_no)) visitMap.set('no:' + s(v.candidate_no), v);
    }

    const rows = gpsCandidates.length ? gpsCandidates : validVisits;
    const rowsHtml = rows.map((c, idx) => {
      const key = visitKeyFromCandidate(c);
      const v = visitMap.get(key) || visitMap.get('no:' + s(c.candidate_no));
      const isVisit = !!v;
      const no = s(c.candidate_no || (v && v.candidate_no) || (idx + 1));
      const lat = s((v && (v.gps_lat || v.latest_lat || v.lat)) || c.latest_lat || c.lat || c.gps_lat);
      const lng = s((v && (v.gps_lng || v.latest_lng || v.lng)) || c.latest_lng || c.lng || c.gps_lng);
      const startMs = n((v && (v.visit_start_ms || v.start_ms)) || c.start_ms);
      const endMs = n((v && (v.visit_end_ms || v.end_ms || v.updated_ms)) || c.end_ms || c.start_ms);
      const startSeq = s((v && (v.first_seq || v.start_seq)) || c.start_seq || '');
      const endSeq = s((v && (v.last_seq || v.end_seq)) || c.end_seq || '');
      const tlog = s(v && v.tlog_count);
      const motor = s(v && v.motor_count);
      const pulse = s(v && v.pulse_count);
      const ev = s(v && v.fishing_event_count);
      const depthRange = s(v && v.depth_range_mm);
      const reason = s(v && v.activity_reason);

      return '' +
        '<div style="border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:10px;margin:10px 0;background:rgba(15,23,42,.35);">' +
          '<div><strong>' + (isVisit ? '保存候補' : '保存しない') + ' / G' + esc(no || '-') + '</strong></div>' +
          '<div>座標: ' + esc(lat || '-') + ', ' + esc(lng || '-') + '</div>' +
          '<div>時刻: ' + esc(fmtMs(startMs)) + ' - ' + esc(fmtMs(endMs)) + '</div>' +
          '<div>seq: ' + esc(startSeq || '-') + ' - ' + esc(endSeq || '-') + '</div>' +
          '<div>tlog: ' + esc(tlog || (isVisit ? '0' : '-')) +
            ' / motor: ' + esc(motor || (isVisit ? '0' : '-')) +
            ' / pulse: ' + esc(pulse || (isVisit ? '0' : '-')) +
            ' / event: ' + esc(ev || (isVisit ? '0' : '-')) + '</div>' +
          '<div>depth_range_mm: ' + esc(depthRange || (isVisit ? '0' : '-')) +
            ' / reason: ' + esc(reason || (isVisit ? '-' : '実釣活動なし')) + '</div>' +
        '</div>';
    }).join('');

    const summary = '' +
      '<p><strong>保存前診断で停止中です。trip_recordsへは保存していません。</strong></p>' +
      '<p>sid: ' + esc(parent && parent.sid || '-') +
      ' / GPS候補: ' + esc(gpsCandidates.length) +
      ' / 実釣visit候補: ' + esc(validVisits.length) +
      ' / tlog_activity_rows: ' + esc(parent && (parent.tlog_activity_row_count || (Array.isArray(parent.tlog_activity_rows) ? parent.tlog_activity_rows.length : 0)) || 0) + '</p>';

    body.innerHTML = summary + (rowsHtml || '<p>GPS候補がありません。</p>');
    if(badge){
      badge.textContent = validVisits.length ? ('保存候補 ' + validVisits.length) : '保存候補なし';
      badge.className = 'pill ' + (validVisits.length ? 'warn' : 'good');
    }

    try{
      window.wakasagiStage2VisitSafetyDiagnosis = {
        version:VERSION,
        parent:parent,
        gps_candidates:gpsCandidates,
        gps_visit_candidates:validVisits,
        note:'diagnosis only; not saved to trip_records'
      };
    }catch(e){}
  }

  async function stage2ApplyLogSyncPayload(p){
    if(!p || p.__error) return await originalApply.call(this, p);

    const hasGpsCandidateSource =
      Number(p.gps_candidate_count || 0) > 0 ||
      (Array.isArray(p.gps_candidates) && p.gps_candidates.length > 0);

    if(
      p.gps_visit_judged &&
      hasGpsCandidateSource &&
      Array.isArray(p.gps_visit_candidates) &&
      !p.__stage2_single_visit
    ){
      const visits = p.gps_visit_candidates.filter(v =>
        v && s(v.gps_visit_id || v.visit_id) && hasLatLng(v)
      );

      renderDiagnosis(p, visits);
      clearLogSyncHash();
      try{ if(typeof refreshAll === 'function') await refreshAll(); }catch(e){}

      if(!visits.length){
        setLogSync('保存前診断: 実釣visit候補なし / 保存なし','good');
        return false;
      }

      setLogSync('保存前診断: 実釣visit候補 ' + visits.length + '件 / trip_records保存停止','warn');
      return false;
    }

    return await originalApply.call(this, p);
  }

  try{ window.v112_findTripForLogSync = stage2FindTripForLogSync; v112_findTripForLogSync = stage2FindTripForLogSync; }catch(e){}
  try{ window.v112_makeTripFromLogSync = stage2MakeTripFromLogSync; v112_makeTripFromLogSync = stage2MakeTripFromLogSync; }catch(e){}
  try{ window.v112_makePicoSummary = stage2MakePicoSummary; v112_makePicoSummary = stage2MakePicoSummary; }catch(e){}
  try{ window.v112_applyLogSyncPayload = stage2ApplyLogSyncPayload; v112_applyLogSyncPayload = stage2ApplyLogSyncPayload; }catch(e){}

  console.info('[wakasagi] stage2 visit receiver safety diagnosis installed', VERSION);
})();
