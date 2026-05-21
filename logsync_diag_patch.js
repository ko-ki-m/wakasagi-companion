/*
  Wakasagi logsync diagnostic patch v20260521d1
  Purpose: observe #logsync payload -> save decision -> saved trip result.
  This file does not create/change IndexedDB stores and does not change map/group/save logic.
*/
(function(){
  'use strict';

  const DIAG_VERSION = '20260521d1';
  const W = window;
  const state = W.__wakasagiLogSyncDiag = W.__wakasagiLogSyncDiag || {
    version: DIAG_VERSION,
    installedAt: new Date().toISOString(),
    events: [],
    putEvents: [],
    findEvents: [],
    last: null
  };
  state.version = DIAG_VERSION;

  function safeString(v){
    if(v === undefined || v === null || v === '') return '-';
    return String(v);
  }

  function esc(v){
    return safeString(v).replace(/[&<>"']/g, function(ch){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];
    });
  }

  function clonePlain(obj){
    try{ return JSON.parse(JSON.stringify(obj || {})); }
    catch(e){ return {__clone_error:String(e && e.message ? e.message : e)}; }
  }

  function pickPayload(p){
    p = p || {};
    return {
      sid: safeString(p.sid),
      point_visit_id: safeString(p.point_visit_id),
      map_point_key: safeString(p.map_point_key),
      map_spot_id: safeString(p.map_spot_id || p.spot_id),
      point_start_seq: safeString(p.point_start_seq),
      point_last_seq: safeString(p.point_last_seq),
      first_seq: safeString(p.first_seq),
      last_seq: safeString(p.last_seq),
      first_t_ms: safeString(p.first_t_ms),
      last_t_ms: safeString(p.last_t_ms),
      gps_lat: safeString(p.gps_lat || p.lat),
      gps_lng: safeString(p.gps_lng || p.lng),
      gps_acc_m: safeString(p.gps_acc_m || p.acc),
      start_ms: safeString(p.start_ms),
      updated_ms: safeString(p.updated_ms),
      first_recv_ms: safeString(p.first_recv_ms),
      last_recv_ms: safeString(p.last_recv_ms),
      tlog_count: safeString(p.tlog_count),
      max_depth_m: safeString(p.max_depth_m),
      depth_status: safeString(p.depth_status),
      line_no: safeString(p.line_no),
      sinker_g: safeString(p.sinker_g),
      weather: safeString(p.weather_text || p.weather),
      wind: safeString(p.wind_dir || p.wind)
    };
  }

  function pickTrip(t){
    if(!t) return null;
    const s = t.pico_summary || null;
    return {
      trip_id: safeString(t.trip_id),
      pico_sid: safeString(t.pico_sid),
      point_visit_id: safeString(t.point_visit_id),
      map_point_key: safeString(t.map_point_key),
      lat: safeString(t.lat),
      lng: safeString(t.lng),
      date_ms: safeString(t.date_ms),
      updated_ms: safeString(t.updated_ms),
      line_no: safeString(t.line_no),
      sinker_g: safeString(t.sinker_g),
      fishfinder_depth_m: safeString(t.fishfinder_depth_m),
      depth_status: safeString(t.depth_status),
      summary_point_visit_id: s ? safeString(s.point_visit_id) : '-',
      summary_map_point_key: s ? safeString(s.map_point_key) : '-',
      summary_first_seq: s ? safeString(s.first_seq) : '-',
      summary_last_seq: s ? safeString(s.last_seq) : '-',
      summary_tlog_count: s ? safeString(s.tlog_count) : '-',
      summary_max_depth_m: s ? safeString(s.max_depth_m) : '-'
    };
  }

  function logEvent(type, data){
    const ev = {type, at: new Date().toISOString(), data: clonePlain(data)};
    state.events.push(ev);
    if(state.events.length > 40) state.events.shift();
    state.last = ev;
    render();
    return ev;
  }

  function kvTable(obj){
    const rows = Object.keys(obj || {}).map(function(k){
      return '<tr><th>'+esc(k)+'</th><td>'+esc(obj[k])+'</td></tr>';
    }).join('');
    return '<table class="wldTable">'+rows+'</table>';
  }

  function makeBox(){
    let box = document.getElementById('logsyncDiagBox');
    if(box) return box;

    const style = document.createElement('style');
    style.textContent = [
      '#logsyncDiagBox{margin-top:12px;padding:12px;border:2px solid #f59e0b;border-radius:14px;background:#fff7ed;color:#111827;font-size:13px;line-height:1.45;}',
      '#logsyncDiagBox h3{margin:0 0 8px;font-size:16px;color:#7c2d12;}',
      '#logsyncDiagBox h4{margin:12px 0 6px;font-size:14px;color:#7c2d12;}',
      '#logsyncDiagBox .wldSmall{color:#6b7280;font-size:12px;}',
      '#logsyncDiagBox .wldWarn{font-weight:700;color:#b45309;}',
      '#logsyncDiagBox .wldGood{font-weight:700;color:#166534;}',
      '#logsyncDiagBox .wldBad{font-weight:700;color:#991b1b;}',
      '#logsyncDiagBox .wldGrid{display:grid;gap:8px;}',
      '#logsyncDiagBox .wldTable{width:100%;border-collapse:collapse;background:#fff;}',
      '#logsyncDiagBox .wldTable th{width:35%;text-align:left;vertical-align:top;background:#ffedd5;padding:4px 6px;border:1px solid #fed7aa;}',
      '#logsyncDiagBox .wldTable td{word-break:break-all;padding:4px 6px;border:1px solid #fed7aa;}',
      '#logsyncDiagBox pre{white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto;background:#111827;color:#f9fafb;border-radius:10px;padding:8px;font-size:12px;}'
    ].join('\n');
    document.head.appendChild(style);

    box = document.createElement('div');
    box.id = 'logsyncDiagBox';
    box.innerHTML = '<h3>logsync診断表示</h3><div class="wldSmall">診断パッチ読込済み。#logsync受信時に保存判定を表示します。</div>';
    const status = document.getElementById('logSyncStatus');
    const card = status ? status.closest('.card') : null;
    if(status && status.parentNode){ status.parentNode.insertBefore(box, status.nextSibling); }
    else if(card){ card.appendChild(box); }
    else{ document.body.appendChild(box); }
    return box;
  }

  function render(){
    const box = makeBox();
    const last = state.last || null;
    const put = state.putEvents.length ? state.putEvents[state.putEvents.length - 1] : null;
    const find = state.findEvents.length ? state.findEvents[state.findEvents.length - 1] : null;
    const body = [];
    body.push('<h3>logsync診断表示 <span class="wldSmall">'+esc(DIAG_VERSION)+'</span></h3>');
    if(!last){
      body.push('<div class="wldWarn">待機中：まだ #logsync 保存処理は呼ばれていません。</div>');
      body.push('<div class="wldSmall">この表示は診断のみです。保存処理、DB名、place/visit設計、service-workerには触れていません。</div>');
    }else{
      body.push('<div>最終イベント：<b>'+esc(last.type)+'</b> / '+esc(last.at)+'</div>');
      if(last.data && last.data.result === true) body.push('<div class="wldGood">保存処理は true を返しました。</div>');
      if(last.data && last.data.result === false) body.push('<div class="wldBad">保存処理は false を返しました。</div>');
      if(last.data && last.data.error) body.push('<div class="wldBad">ERROR: '+esc(last.data.error)+'</div>');
      if(last.data && last.data.rawPayload){
        body.push('<h4>受信payload要点</h4>');
        body.push(kvTable(last.data.rawPayload));
      }
      if(last.data && last.data.precheck){
        body.push('<h4>保存前の既存検索予測</h4>');
        body.push(kvTable(last.data.precheck));
      }
      if(find){
        body.push('<h4>v112_findTripForLogSync 結果</h4>');
        body.push(kvTable(find));
      }
      if(put){
        body.push('<h4>putTrip 書き込み候補</h4>');
        body.push(kvTable(put));
      }
      if(last.data && last.data.savedTrip){
        body.push('<h4>保存後に見つかったtrip</h4>');
        body.push(kvTable(last.data.savedTrip));
      }
      body.push('<h4>全診断JSON</h4>');
      body.push('<pre>'+esc(JSON.stringify(state, null, 2))+'</pre>');
    }
    box.innerHTML = body.join('');
  }

  function matchReasonForTrip(t, p){
    const sid = String(p && p.sid ? p.sid : '').trim();
    const pointKey = String((p && (p.point_visit_id || p.map_point_key)) || '').trim();
    if(pointKey){
      if(String(t.point_visit_id || '') === pointKey) return 'trip.point_visit_id';
      if(String(t.map_point_key || '') === pointKey) return 'trip.map_point_key';
      if(t.pico_summary && String(t.pico_summary.point_visit_id || t.pico_summary.map_point_key || '') === pointKey) return 'pico_summary.point_key';
      if(Array.isArray(t.pico_logs) && t.pico_logs.some(function(l){ return String(l.point_visit_id || l.map_point_key || '') === pointKey; })) return 'pico_logs.point_key';
    }
    if(!pointKey && sid){
      if(String(t.pico_sid || '') === sid) return 'trip.pico_sid legacy';
      if(t.pico_summary && String(t.pico_summary.sid || '') === sid) return 'pico_summary.sid legacy';
      if(Array.isArray(t.pico_logs) && t.pico_logs.some(function(l){ return String(l.sid || '') === sid; })) return 'pico_logs.sid legacy';
    }
    return '';
  }

  async function precheckPayload(p){
    const out = {
      point_key_used: safeString((p && (p.point_visit_id || p.map_point_key)) || ''),
      sid_used: safeString(p && p.sid),
      total_trips_before: '-',
      predicted_match: '未確認',
      predicted_trip_id: '-',
      predicted_reason: '-'
    };
    try{
      if(typeof W.getAllTrips !== 'function'){
        out.predicted_match = 'getAllTrips未定義';
        return out;
      }
      const trips = await W.getAllTrips();
      out.total_trips_before = trips.length;
      for(const t of trips){
        const reason = matchReasonForTrip(t, p);
        if(reason){
          out.predicted_match = '既存更新候補あり';
          out.predicted_trip_id = safeString(t.trip_id);
          out.predicted_reason = reason;
          return out;
        }
      }
      out.predicted_match = '既存候補なし＝新規作成予定';
      return out;
    }catch(e){
      out.predicted_match = 'precheck error';
      out.predicted_reason = String(e && e.message ? e.message : e);
      return out;
    }
  }

  async function findSavedTripAfter(p){
    try{
      if(typeof W.getAllTrips !== 'function') return null;
      const trips = await W.getAllTrips();
      const pointKey = String((p && (p.point_visit_id || p.map_point_key)) || '').trim();
      const sid = String(p && p.sid ? p.sid : '').trim();
      let fallback = null;
      for(const t of trips){
        if(pointKey && matchReasonForTrip(t, p)) return t;
        if(!fallback && sid && String(t.pico_sid || '') === sid) fallback = t;
      }
      return fallback;
    }catch(e){ return null; }
  }

  function install(){
    makeBox();

    if(typeof W.putTrip === 'function' && !W.putTrip.__wldWrapped){
      const originalPutTrip = W.putTrip;
      const wrappedPutTrip = async function(t){
        state.putEvents.push(pickTrip(t) || {trip_id:'-'});
        if(state.putEvents.length > 20) state.putEvents.shift();
        render();
        return originalPutTrip.apply(this, arguments);
      };
      wrappedPutTrip.__wldWrapped = true;
      W.putTrip = wrappedPutTrip;
      try{ putTrip = wrappedPutTrip; }catch(e){}
    }

    if(typeof W.v112_findTripForLogSync === 'function' && !W.v112_findTripForLogSync.__wldWrapped){
      const originalFind = W.v112_findTripForLogSync;
      const wrappedFind = async function(p){
        const result = await originalFind.apply(this, arguments);
        const ev = {
          point_key: safeString((p && (p.point_visit_id || p.map_point_key)) || ''),
          sid: safeString(p && p.sid),
          result: result ? '既存tripあり' : '該当なし',
          result_trip_id: result ? safeString(result.trip_id) : '-',
          result_point_visit_id: result ? safeString(result.point_visit_id) : '-',
          result_map_point_key: result ? safeString(result.map_point_key) : '-'
        };
        state.findEvents.push(ev);
        if(state.findEvents.length > 20) state.findEvents.shift();
        render();
        return result;
      };
      wrappedFind.__wldWrapped = true;
      W.v112_findTripForLogSync = wrappedFind;
      try{ v112_findTripForLogSync = wrappedFind; }catch(e){}
    }

    if(typeof W.v112_applyLogSyncPayload === 'function' && !W.v112_applyLogSyncPayload.__wldWrapped){
      const originalApply = W.v112_applyLogSyncPayload;
      const wrappedApply = async function(p){
        const rawPayload = pickPayload(p);
        const precheck = await precheckPayload(p);
        logEvent('apply:start', {rawPayload, precheck});
        let result = false;
        try{
          result = await originalApply.apply(this, arguments);
        }catch(e){
          logEvent('apply:exception', {rawPayload, precheck, error:String(e && e.message ? e.message : e)});
          throw e;
        }
        const saved = await findSavedTripAfter(p);
        logEvent('apply:finish', {rawPayload, precheck, result:!!result, savedTrip:pickTrip(saved)});
        return result;
      };
      wrappedApply.__wldWrapped = true;
      W.v112_applyLogSyncPayload = wrappedApply;
      try{ v112_applyLogSyncPayload = wrappedApply; }catch(e){}
      logEvent('patch:installed', {message:'v112_applyLogSyncPayload / v112_findTripForLogSync / putTrip wrapped'});
      return true;
    }

    logEvent('patch:waiting', {
      apply_exists: typeof W.v112_applyLogSyncPayload,
      find_exists: typeof W.v112_findTripForLogSync,
      putTrip_exists: typeof W.putTrip
    });
    return false;
  }

  W.wakasagiShowLogSyncDiag = render;
  W.wakasagiLogSyncDiagInstall = install;

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ install(); setTimeout(install, 500); });
  }else{
    install();
    setTimeout(install, 500);
  }
  W.addEventListener('load', function(){ setTimeout(install, 200); setTimeout(render, 1700); });
})();
