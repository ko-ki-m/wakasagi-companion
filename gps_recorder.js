// Wakasagi GPS candidate recorder page runner
// Version: gps_recorder_20260527i_5min_candidate_runner
// Scope:
// - Smartphone/GitHub Pages side only.
// - Uses gps_session_candidates_core.js to save GPS candidates only.
// - Does not write trip_records, does not create visits, does not communicate with Pico W.
// - No watchPosition. Timer runs only after explicit start button or autostart=1 URL.
(function(){
  'use strict';

  const VERSION = 'gps_recorder_20260527i_5min_candidate_runner';
  const SAMPLE_INTERVAL_MS = 300000; // 5 minutes, low-frequency candidate only
  let timer = null;
  let running = false;
  let sampleBusy = false;

  function $(id){ return document.getElementById(id); }
  function s(v){ return String(v == null ? '' : v).trim(); }
  function qs(name){ try{ return new URL(location.href).searchParams.get(name) || ''; }catch(e){ return ''; } }
  const sid = s(qs('sid')) || s(qs('session')) || '';

  function core(){ return window.wakasagiGpsCandidatesCore || null; }
  function setState(msg){ const el=$('stateText'); if(el) el.textContent=String(msg||''); }
  function setLast(msg){ const el=$('lastText'); if(el) el.textContent=String(msg||'-'); }
  function debug(){
    const c=core();
    const info = {
      version: VERSION,
      sid,
      running,
      sample_interval_ms: SAMPLE_INTERVAL_MS,
      sampling_policy: 'five_min_one_shot_when_runner_is_alive',
      automatic_start_default: false,
      autostart_url_supported: true,
      watchPosition: false,
      writes_trip_records: false,
      creates_visit: false,
      calls_pico_w: false,
      secure_context: !!window.isSecureContext,
      core: c && c.status ? c.status() : 'not_ready'
    };
    const el=$('debugText'); if(el) el.textContent=JSON.stringify(info,null,2);
  }
  function fmtTime(ms){
    const n=Number(ms||0);
    if(!Number.isFinite(n) || n<=0) return '-';
    try{ return new Date(n).toLocaleString(); }catch(e){ return String(n); }
  }
  async function refreshList(){
    const c=core();
    debug();
    if($('sidText')) $('sidText').textContent = sid || '(sidなし)';
    if(!c || !sid){
      if($('listBox')) $('listBox').textContent = !sid ? 'sidがありません。/log側からsid付きで開いてください。' : 'GPS候補DB core未読込';
      if($('countText')) $('countText').textContent='0';
      return;
    }
    let rows=[];
    try{ rows = await c.list(sid); }catch(e){ rows=[]; }
    if($('countText')) $('countText').textContent = String(rows.length);
    if(!rows.length){
      if($('listBox')) $('listBox').textContent='候補なし';
      return;
    }
    const html = '<table><thead><tr><th>G</th><th>位置</th><th>精度</th><th>samples</th><th>last</th></tr></thead><tbody>' + rows.map(r=>{
      const lat = s(r.latest_lat || r.lat);
      const lng = s(r.latest_lng || r.lng);
      const acc = s(r.latest_acc_m || r.acc_m || '');
      return '<tr><td>G'+String(r.candidate_no||'')+'</td><td>'+lat+'<br>'+lng+'</td><td>'+acc+'m</td><td>'+String(r.sample_count||1)+'</td><td>'+fmtTime(r.last_seen_ms||r.updated_ms||r.gps_ms)+'</td></tr>';
    }).join('') + '</tbody></table>';
    if($('listBox')) $('listBox').innerHTML = html;
  }
  function clearTimer(){ if(timer){ clearTimeout(timer); timer=null; } }
  function scheduleNext(){
    clearTimer();
    if(!running) return;
    timer = setTimeout(()=>{ sampleOnce('timer_low_frequency_candidate_only'); }, SAMPLE_INTERVAL_MS);
  }
  async function sampleOnce(reason){
    const c=core();
    if(!c || !sid){ setState(!sid ? 'sidなし' : 'core未読込'); await refreshList(); return; }
    if(sampleBusy){ setState('GPS取得中'); return; }
    sampleBusy=true;
    setState('GPS取得中...');
    try{
      const res = await c.sampleOnce(sid, reason || 'manual_once', {enableHighAccuracy:false, timeout:8000, maximumAge:120000});
      if(res && res.ok){
        const cand = res.candidate || {};
        setLast('G' + String(cand.candidate_no || '') + ' ' + String(res.action || '') + ' ' + fmtTime(Date.now()));
        setState('候補保存: ' + String(res.action || 'ok'));
      }else{
        setState('GPS候補保存なし: ' + String((res && res.reason) || 'failed'));
      }
    }catch(e){
      setState('GPS取得失敗: ' + (e && e.message ? e.message : e));
    }finally{
      sampleBusy=false;
      await refreshList();
      scheduleNext();
    }
  }
  async function start(reason){
    if(!sid){ setState('sidなし'); return; }
    running=true;
    setState('候補記録中');
    await sampleOnce(reason || 'start_candidate_only');
  }
  function stop(){
    running=false;
    clearTimer();
    setState('停止中');
    debug();
  }
  async function clearSid(){
    const c=core(); if(!c || !sid) return;
    if(!confirm('このsidのGPS候補を削除しますか？')) return;
    await c.clearSid(sid);
    setState('このsidの候補を削除しました');
    await refreshList();
  }
  async function clearAll(){
    const c=core(); if(!c) return;
    if(!confirm('全GPS候補を削除しますか？')) return;
    await c.clearAll();
    setState('全GPS候補を削除しました');
    await refreshList();
  }
  function bind(){
    if($('sidText')) $('sidText').textContent = sid || '(sidなし)';
    const startBtn=$('startBtn'), onceBtn=$('onceBtn'), stopBtn=$('stopBtn'), clearSidBtn=$('clearSidBtn'), clearAllBtn=$('clearAllBtn');
    if(startBtn) startBtn.onclick=()=>start('button_start_candidate_only');
    if(onceBtn) onceBtn.onclick=()=>sampleOnce('button_once_candidate_only');
    if(stopBtn) stopBtn.onclick=()=>stop();
    if(clearSidBtn) clearSidBtn.onclick=()=>clearSid();
    if(clearAllBtn) clearAllBtn.onclick=()=>clearAll();
    document.addEventListener('visibilitychange',()=>{
      // Keep the low-frequency runner state. Browsers may throttle background timers;
      // this page never uses watchPosition and only attempts one-shot samples every 5 minutes.
      if(running && !timer) scheduleNext();
      debug();
    });
  }
  async function init(){
    bind();
    setState(sid ? '待機中' : 'sidなし');
    await refreshList();
    const auto = ['1','true','yes','on'].includes(String(qs('autostart')||qs('auto')||'').toLowerCase());
    if(auto && sid){ await start('url_autostart_candidate_only'); }
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();

  window.wakasagiGpsRecorderRunner = {version:VERSION, start, stop, sampleOnce, refreshList};
})();
