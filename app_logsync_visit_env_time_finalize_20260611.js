(function(){
  'use strict';
  const INSTALLED = '__wakasagiLogsyncVisitEnvTimeFinalize20260611aInstalled';
  if(window[INSTALLED]) return;
  window[INSTALLED] = true;

  function s(v){ return String(v == null ? '' : v).trim(); }
  function n(v){ const x = Number(v); return Number.isFinite(x) ? x : null; }
  function firstNum(){
    for(const v of arguments){
      const x = n(v);
      if(x !== null && x > 0) return x;
    }
    return null;
  }
  function escLocal(v){
    try{
      if(typeof esc === 'function') return esc(v);
    }catch(e){}
    return String(v == null ? '' : v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }
  function fmtLocal(ms){
    try{
      if(typeof fmtTime === 'function') return fmtTime(ms);
    }catch(e){}
    const x = n(ms);
    if(!x) return '-';
    const d = new Date(x);
    if(Number.isNaN(d.getTime())) return '-';
    const p = v => String(v).padStart(2,'0');
    return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function valueText(v, suffix){
    const t = s(v);
    if(!t) return '-';
    return suffix && !t.endsWith(suffix) ? (t + suffix) : t;
  }
  function startMsFromPayload(p){ return firstNum(p && p.visit_start_ms, p && p.start_ms, p && p.first_recv_ms, p && p.date_ms); }
  function endMsFromPayload(p){ return firstNum(p && p.visit_end_ms, p && p.end_ms, p && p.updated_ms, p && p.last_recv_ms); }
  function applyEnvTimeToTrip(t, p){
    if(!t || !p) return t;
    const startMs = startMsFromPayload(p);
    const endMs = endMsFromPayload(p);
    if(startMs){
      if(!t.date_ms) t.date_ms = startMs;
      if(!t.visit_start_ms) t.visit_start_ms = startMs;
      if(!t.start_ms) t.start_ms = startMs;
    }
    if(endMs){
      if(!t.visit_end_ms) t.visit_end_ms = endMs;
      if(!t.end_ms) t.end_ms = endMs;
    }
    if(!s(t.lake_name) && p.lake_name) t.lake_name = s(p.lake_name);
    if(!s(t.point_name) && (p.point_name || p.place_name)) t.point_name = s(p.point_name || p.place_name);
    if(!s(t.water_temp_c) && p.water_temp_c) t.water_temp_c = s(p.water_temp_c);
    if(!s(t.weather_text) && (p.weather_text || p.weather)) t.weather_text = s(p.weather_text || p.weather);
    if(!s(t.weather) && (p.weather_text || p.weather)) t.weather = s(p.weather_text || p.weather);
    if(!s(t.wind_dir) && p.wind_dir) t.wind_dir = s(p.wind_dir);
    if(!s(t.wind_speed_mps) && p.wind_speed_mps) t.wind_speed_mps = s(p.wind_speed_mps);
    if(!s(t.wind) && (p.wind || p.wind_dir)) t.wind = s(p.wind || p.wind_dir);
    if(!s(t.pressure_hpa) && (p.pressure_hpa || p.pressure || p.air_pressure_hpa)){
      t.pressure_hpa = s(p.pressure_hpa || p.pressure || p.air_pressure_hpa);
    }
    if(p.gps_visit_id && !s(t.gps_visit_id)) t.gps_visit_id = s(p.gps_visit_id);
    if(p.candidate_no !== undefined && t.candidate_no === undefined) t.candidate_no = p.candidate_no;
    if(p.start_seq !== undefined && t.start_seq === undefined) t.start_seq = p.start_seq;
    if(p.end_seq !== undefined && t.end_seq === undefined) t.end_seq = p.end_seq;
    return t;
  }
  function applyEnvTimeToSummary(x, p){
    if(!x || !p) return x;
    const startMs = startMsFromPayload(p);
    const endMs = endMsFromPayload(p);
    if(startMs){
      x.visit_start_ms = startMs;
      if(!x.start_ms) x.start_ms = startMs;
    }
    if(endMs){
      x.visit_end_ms = endMs;
      if(!x.updated_ms) x.updated_ms = endMs;
    }
    x.lake_name = s(p.lake_name || x.lake_name);
    x.point_name = s(p.point_name || p.place_name || x.point_name);
    x.water_temp_c = s(p.water_temp_c || x.water_temp_c);
    x.weather_text = s(p.weather_text || p.weather || x.weather_text);
    x.weather = s(p.weather_text || p.weather || x.weather);
    x.wind_dir = s(p.wind_dir || x.wind_dir);
    x.wind_speed_mps = s(p.wind_speed_mps || x.wind_speed_mps);
    x.wind = s(p.wind || p.wind_dir || x.wind);
    x.pressure_hpa = s(p.pressure_hpa || p.pressure || p.air_pressure_hpa || x.pressure_hpa);
    if(p.gps_visit_id) x.gps_visit_id = s(p.gps_visit_id);
    if(p.candidate_no !== undefined) x.candidate_no = p.candidate_no;
    if(p.start_seq !== undefined) x.start_seq = p.start_seq;
    if(p.end_seq !== undefined) x.end_seq = p.end_seq;
    return x;
  }
  function enrichPayload(p){
    if(!p || typeof p !== 'object') return p;
    const q = Object.assign({}, p);
    const startMs = startMsFromPayload(q);
    const endMs = endMsFromPayload(q);
    if(startMs){
      if(!q.visit_start_ms) q.visit_start_ms = startMs;
      if(!q.start_ms) q.start_ms = startMs;
    }
    if(endMs){
      if(!q.visit_end_ms) q.visit_end_ms = endMs;
      if(!q.end_ms) q.end_ms = endMs;
    }
    if(!q.weather_text && q.weather) q.weather_text = q.weather;
    if(!q.weather && q.weather_text) q.weather = q.weather_text;
    if(!q.wind && q.wind_dir) q.wind = q.wind_dir;
    if(!q.pressure_hpa && (q.pressure || q.air_pressure_hpa)) q.pressure_hpa = q.pressure || q.air_pressure_hpa;
    if(Array.isArray(q.gps_visit_candidates)){
      q.gps_visit_candidates = q.gps_visit_candidates.map(v => enrichPayload(Object.assign({}, q, v || {})));
    }
    return q;
  }

  function install(){
    const baseMake = window.v112_makeTripFromLogSync;
    if(typeof baseMake === 'function' && !baseMake.__envTimeFinalized){
      const wrapped = function(p){
        const q = enrichPayload(p);
        const t = baseMake.call(this, q);
        return applyEnvTimeToTrip(t, q);
      };
      wrapped.__envTimeFinalized = true;
      try{ window.v112_makeTripFromLogSync = wrapped; v112_makeTripFromLogSync = wrapped; }catch(e){ window.v112_makeTripFromLogSync = wrapped; }
    }

    const baseSummary = window.v112_makePicoSummary;
    if(typeof baseSummary === 'function' && !baseSummary.__envTimeFinalized){
      const wrapped = function(p){
        const q = enrichPayload(p);
        const x = baseSummary.call(this, q) || {};
        return applyEnvTimeToSummary(x, q);
      };
      wrapped.__envTimeFinalized = true;
      try{ window.v112_makePicoSummary = wrapped; v112_makePicoSummary = wrapped; }catch(e){ window.v112_makePicoSummary = wrapped; }
    }

    const baseApply = window.v112_applyLogSyncPayload;
    if(typeof baseApply === 'function' && !baseApply.__envTimeFinalized){
      const wrapped = async function(p){
        const q = enrichPayload(p);
        const ok = await baseApply.call(this, q);
        try{
          if(ok && typeof getAllTrips === 'function' && typeof putTrip === 'function'){
            const visitKey = s(q.gps_visit_id || q.visit_id);
            const sid = s(q.sid || q.pico_sid);
            const trips = await getAllTrips();
            let t = null;
            if(visitKey){
              t = trips.find(x => s(x.gps_visit_id) === visitKey ||
                                  (x.pico_summary && s(x.pico_summary.gps_visit_id) === visitKey) ||
                                  (Array.isArray(x.pico_logs) && x.pico_logs.some(l => s(l.gps_visit_id) === visitKey)));
            }
            if(!t && typeof selectedTripId !== 'undefined' && selectedTripId){
              t = trips.find(x => s(x.trip_id) === s(selectedTripId));
            }
            if(!t && sid){
              t = trips.find(x => s(x.pico_sid) === sid ||
                                  (x.pico_summary && s(x.pico_summary.sid) === sid));
            }
            if(t){
              applyEnvTimeToTrip(t, q);
              if(t.pico_summary) applyEnvTimeToSummary(t.pico_summary, q);
              if(Array.isArray(t.pico_logs) && t.pico_logs.length){
                t.pico_logs[t.pico_logs.length - 1] = applyEnvTimeToSummary(t.pico_logs[t.pico_logs.length - 1], q);
              }
              t.updated_ms = Date.now();
              await putTrip(t);
              try{ if(typeof refreshAll === 'function') await refreshAll(); }catch(e){}
            }
          }
        }catch(e){ console.warn('[wakasagi] env/time finalizer post-save skipped', e); }
        return ok;
      };
      wrapped.__envTimeFinalized = true;
      try{ window.v112_applyLogSyncPayload = wrapped; v112_applyLogSyncPayload = wrapped; }catch(e){ window.v112_applyLogSyncPayload = wrapped; }
    }

    const baseDetail = window.detailHtml || (typeof detailHtml === 'function' ? detailHtml : null);
    if(typeof baseDetail === 'function' && !baseDetail.__envTimeFinalized){
      const wrapped = function(t, base){
        const html = baseDetail.call(this, t, base);
        const startMs = firstNum(t && t.visit_start_ms, t && t.start_ms, t && t.date_ms);
        const endMs = firstNum(t && t.visit_end_ms, t && t.end_ms, t && t.updated_ms);
        const extra = [
          '<div class="logBox"><h3>釣行環境・時刻</h3><div class="logGrid">',
          '<b>開始</b><span>' + escLocal(fmtLocal(startMs)) + '</span>',
          '<b>終了</b><span>' + escLocal(fmtLocal(endMs)) + '</span>',
          '<b>天気</b><span>' + escLocal(valueText((t && (t.weather_text || t.weather)))) + '</span>',
          '<b>風向</b><span>' + escLocal(valueText(t && t.wind_dir)) + '</span>',
          '<b>風速</b><span>' + escLocal(valueText(t && t.wind_speed_mps, 'm/s')) + '</span>',
          '<b>気圧</b><span>' + escLocal(valueText(t && t.pressure_hpa, 'hPa')) + '</span>',
          '</div></div>'
        ].join('');
        return html + extra;
      };
      wrapped.__envTimeFinalized = true;
      try{ window.detailHtml = wrapped; detailHtml = wrapped; }catch(e){ window.detailHtml = wrapped; }
    }

    console.info('[wakasagi] logsync visit env/time finalizer 20260611a installed');
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', install, {once:true});
  }else{
    install();
  }
  window.addEventListener('load', () => setTimeout(install, 300), {once:true});
})();
