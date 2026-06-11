(function(){
  'use strict';
  const INSTALL_FLAG = '__wakasagiStage1LogsyncFields20260611cInstalled';
  if(window[INSTALL_FLAG]) return;
  window[INSTALL_FLAG] = true;

  function s(v){ return String(v == null ? '' : v).trim(); }
  function n(v){ const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0; }
  function firstNum(){
    for(let i=0;i<arguments.length;i++){
      const x = n(arguments[i]);
      if(x) return x;
    }
    return 0;
  }
  function setIfText(obj, key, val){
    const t = s(val);
    if(t && !s(obj[key])) obj[key] = t;
  }
  function setText(obj, key, val){
    const t = s(val);
    if(t) obj[key] = t;
  }
  function mergeEnvTimeFields(t, p){
    if(!t || !p) return t;

    const startMs = firstNum(p.visit_start_ms, p.start_ms, p.first_recv_ms, t.visit_start_ms, t.start_ms, t.date_ms);
    const endMs = firstNum(p.visit_end_ms, p.end_ms, p.updated_ms, p.last_recv_ms, t.visit_end_ms, t.end_ms);

    if(startMs){
      if(!n(t.date_ms)) t.date_ms = startMs;
      if(!n(t.visit_start_ms)) t.visit_start_ms = startMs;
      if(!n(t.start_ms)) t.start_ms = startMs;
      if(!n(t.location_time_ms)) t.location_time_ms = firstNum(p.gps_ms, p.location_time_ms, startMs);
    }
    if(endMs){
      if(!n(t.visit_end_ms)) t.visit_end_ms = endMs;
      if(!n(t.end_ms)) t.end_ms = endMs;
    }

    setIfText(t, 'lake_name', p.lake_name);
    setIfText(t, 'point_name', p.point_name || p.place_name);
    setIfText(t, 'water_temp_c', p.water_temp_c);

    setIfText(t, 'weather_text', p.weather_text || p.weather);
    setIfText(t, 'weather', p.weather_text || p.weather);

    setIfText(t, 'wind_dir', p.wind_dir);
    setIfText(t, 'wind_speed_mps', p.wind_speed_mps);
    setIfText(t, 'wind', p.wind || p.wind_dir);

    setIfText(t, 'pressure_hpa', p.pressure_hpa || p.pressure || p.air_pressure_hpa);

    if(!s(t.memo) && p.note) t.memo = s(p.note);
    return t;
  }

  const baseMakeTrip = window.v112_makeTripFromLogSync;
  if(typeof baseMakeTrip === 'function'){
    window.v112_makeTripFromLogSync = function(p){
      const t = baseMakeTrip.call(this, p);
      return mergeEnvTimeFields(t, p);
    };
    try{ v112_makeTripFromLogSync = window.v112_makeTripFromLogSync; }catch(e){}
  }

  const baseMakeSummary = window.v112_makePicoSummary;
  if(typeof baseMakeSummary === 'function'){
    window.v112_makePicoSummary = function(p){
      const x = baseMakeSummary.call(this, p) || {};
      if(p){
        const startMs = firstNum(p.visit_start_ms, p.start_ms, p.first_recv_ms, x.visit_start_ms, x.start_ms);
        const endMs = firstNum(p.visit_end_ms, p.end_ms, p.updated_ms, p.last_recv_ms, x.visit_end_ms, x.updated_ms);
        if(startMs){ x.visit_start_ms = startMs; if(!n(x.start_ms)) x.start_ms = startMs; }
        if(endMs){ x.visit_end_ms = endMs; if(!n(x.end_ms)) x.end_ms = endMs; if(!n(x.updated_ms)) x.updated_ms = endMs; }
        setText(x, 'lake_name', p.lake_name || x.lake_name);
        setText(x, 'point_name', p.point_name || p.place_name || x.point_name);
        setText(x, 'water_temp_c', p.water_temp_c || x.water_temp_c);
        setText(x, 'weather_text', p.weather_text || p.weather || x.weather_text);
        setText(x, 'weather', p.weather_text || p.weather || x.weather);
        setText(x, 'wind_dir', p.wind_dir || x.wind_dir);
        setText(x, 'wind_speed_mps', p.wind_speed_mps || x.wind_speed_mps);
        setText(x, 'wind', p.wind || p.wind_dir || x.wind);
        setText(x, 'pressure_hpa', p.pressure_hpa || p.pressure || p.air_pressure_hpa || x.pressure_hpa);
      }
      return x;
    };
    try{ v112_makePicoSummary = window.v112_makePicoSummary; }catch(e){}
  }

  const baseDetailHtml = window.detailHtml;
  if(typeof baseDetailHtml === 'function'){
    window.detailHtml = function(t, base){
      const html = String(baseDetailHtml.call(this, t, base) || '');
      if(!t) return html;

      const escFn = (typeof window.esc === 'function') ? window.esc : function(v){
        return String(v == null ? '' : v).replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]));
      };
      const fmtFn = (typeof window.fmtTime === 'function') ? window.fmtTime : function(ms){
        const x = Number(ms || 0);
        if(!x) return '-';
        const d = new Date(x);
        if(Number.isNaN(d.getTime())) return '-';
        const pad = v => String(v).padStart(2,'0');
        return d.getFullYear() + '/' + pad(d.getMonth()+1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      };
      function row(label, val, suffix){
        const text = s(val);
        if(!text) return '';
        return '<b>' + escFn(label) + '</b><span>' + escFn(text) + (suffix ? escFn(suffix) : '') + '</span>';
      }

      const startMs = firstNum(t.visit_start_ms, t.start_ms, t.date_ms);
      const endMs = firstNum(t.visit_end_ms, t.end_ms, t.updated_ms);
      let extra = '';
      if(startMs) extra += row('開始', fmtFn(startMs));
      if(endMs) extra += row('終了', fmtFn(endMs));
      extra += row('天気詳細', t.weather_text);
      extra += row('風向', t.wind_dir);
      extra += row('風速', t.wind_speed_mps, 'm/s');
      extra += row('気圧', t.pressure_hpa, 'hPa');
      if(!extra) return html;
      return html.replace(/<\/div>\s*$/, extra + '</div>');
    };
    try{ detailHtml = window.detailHtml; }catch(e){}
  }

  console.info('[wakasagi] stage1 logsync field keeper 20260611c installed - no apply wrapper, no save gate change');
})();
