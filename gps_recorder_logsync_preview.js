(function(){
  'use strict';

  const VERSION = 'gps_recorder_logsync_preview_20260526d';
  const DB_NAME = 'wakasagi_gps_recorder_v1';
  const DB_VER = 1;
  const STORE_CAND = 'gps_candidates';

  function s(v){ return String(v == null ? '' : v).trim(); }
  function n(v){ const x = Number(v); return Number.isFinite(x) ? x : null; }
  function esc(v){
    return String(v == null ? '' : v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }
  function pad(x){ return String(x).padStart(2,'0'); }
  function fmt(ms){
    const d = new Date(Number(ms || 0));
    if(Number.isNaN(d.getTime())) return '-';
    return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function b64ToUtf8(str){
    const bin = atob(str);
    try{
      return decodeURIComponent(escape(bin));
    }catch(e){
      if(window.TextDecoder){
        const bytes = new Uint8Array(bin.length);
        for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder('utf-8').decode(bytes);
      }
      return bin;
    }
  }

  function decodeLogSyncPayloadFromHash(){
    try{
      const h = location.hash || '';
      if(!h.startsWith('#logsync=')) return null;
      const raw = decodeURIComponent(h.substring('#logsync='.length));
      if(!raw) return null;
      return JSON.parse(b64ToUtf8(raw));
    }catch(e){
      return {__error:String(e && e.message ? e.message : e)};
    }
  }

  function openRecorderDb(){
    return new Promise((resolve)=>{
      if(!('indexedDB' in window)){ resolve(null); return; }
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = ev => {
        const db = ev.target.result;
        if(!db.objectStoreNames.contains(STORE_CAND)){
          const st = db.createObjectStore(STORE_CAND, {keyPath:'id'});
          st.createIndex('sid_start', ['sid','start_ms'], {unique:false});
          st.createIndex('sid_no', ['sid','candidate_no'], {unique:true});
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }

  async function readRecorderCandidates(sidFilter){
    const db = await openRecorderDb();
    if(!db) return [];
    return new Promise(resolve=>{
      const out = [];
      try{
        const tx = db.transaction(STORE_CAND, 'readonly');
        const st = tx.objectStore(STORE_CAND);
        const req = st.getAll();
        req.onsuccess = () => {
          const rows = Array.isArray(req.result) ? req.result : [];
          const sid = s(sidFilter);
          for(const r of rows){
            if(sid && s(r.sid) !== sid) continue;
            out.push(r);
          }
          out.sort((a,b)=>(n(a.start_ms)||0)-(n(b.start_ms)||0));
          resolve(out);
        };
        req.onerror = () => resolve(out);
      }catch(e){ resolve(out); }
    });
  }

  function payloadStartMs(p){
    return n(p && (p.start_ms || p.first_recv_ms || p.visit_start_ms || p.gps_ms)) || 0;
  }
  function payloadEndMs(p){
    return n(p && (p.updated_ms || p.last_recv_ms || p.visit_end_ms || p.gps_ms)) || 0;
  }

  function candStartMs(c){ return n(c && c.start_ms) || 0; }
  function candEndMs(c){ return n(c && (c.end_ms || c.start_ms)) || candStartMs(c); }

  function overlaps(c, start, end){
    const cs = candStartMs(c);
    const ce = candEndMs(c);
    if(!start || !end || end < start) return false;
    return ce >= start && cs <= end;
  }

  function ensurePanel(){
    let panel = document.getElementById('gpsRecorderLogsyncPreviewPanel');
    if(panel) return panel;

    panel = document.createElement('section');
    panel.className = 'card';
    panel.id = 'gpsRecorderLogsyncPreviewPanel';
    panel.innerHTML = `
      <div class="cardHead">
        <div>
          <h2>GPS候補 × logsync 照合プレビュー</h2>
          <p>GPS Recorder候補とPico W logsync payloadのsid・時刻範囲を照合します。ここでは釣行履歴へ保存しません。</p>
        </div>
        <span id="gpsRecorderLogsyncPreviewBadge" class="pill">未照合</span>
      </div>
      <div class="actions">
        <button id="gpsRecorderLogsyncPreviewRun" type="button">logsync照合プレビュー</button>
      </div>
      <p id="gpsRecorderLogsyncPreviewStatus" class="muted">Map連携後の #logsync がある時に照合できます。</p>
      <div id="gpsRecorderLogsyncPreviewList" class="list"></div>
    `;

    const ref = document.getElementById('gpsRecorderBridgePanel') || document.querySelector('.logSyncCard');
    if(ref && ref.parentNode){
      ref.parentNode.insertBefore(panel, ref.nextSibling);
    }else{
      document.body.appendChild(panel);
    }
    return panel;
  }

  function setBadge(text, cls){
    const b = document.getElementById('gpsRecorderLogsyncPreviewBadge');
    if(!b) return;
    b.textContent = text;
    b.className = 'pill ' + (cls || '');
  }

  function setStatus(text){
    const st = document.getElementById('gpsRecorderLogsyncPreviewStatus');
    if(st) st.textContent = text;
  }

  function render(p, rows, matched){
    const box = document.getElementById('gpsRecorderLogsyncPreviewList');
    if(!box) return;

    if(!p){
      box.innerHTML = '<div class="emptyBox">#logsync payload がありません。Pico W /log からMap連携した後に確認してください。</div>';
      return;
    }
    if(p.__error){
      box.innerHTML = '<div class="emptyBox">logsync decode error: ' + esc(p.__error) + '</div>';
      return;
    }

    const sid = s(p.sid);
    const start = payloadStartMs(p);
    const end = payloadEndMs(p);

    const rowsHtml = rows.map(c => {
      const isHit = matched.includes(c);
      const lat = s(c.latest_lat || c.lat);
      const lng = s(c.latest_lng || c.lng);
      const moved = s(c.moved_from_prev_m || c.moved_m || '');
      const acc = s(c.best_acc_m || c.acc_m || '');
      return `<div class="item">
        <div class="top"><span>${isHit ? '候補範囲内' : '範囲外'} / G${esc(c.candidate_no || '-')}</span><span>${esc(fmt(c.start_ms))}</span></div>
        <div class="body">
          sid ${esc(c.sid || '-')}<br>
          座標 ${esc(lat)}, ${esc(lng)}<br>
          精度 ${esc(acc || '-')}m / 前候補から ${esc(moved || '-')}m / samples ${esc(c.sample_count || '-')}
        </div>
      </div>`;
    }).join('');

    box.innerHTML = `
      <div class="logBox">
        <h3>logsync payload</h3>
        <div class="logGrid">
          <b>sid</b><span>${esc(sid || '-')}</span>
          <b>時刻範囲</b><span>${esc(fmt(start))} - ${esc(fmt(end))}</span>
          <b>seq</b><span>${esc(p.first_seq || '-')} - ${esc(p.last_seq || '-')}</span>
          <b>既存gps候補</b><span>${esc(p.gps_candidate_count || 0)} / visit ${esc(p.gps_visit_candidate_count || 0)}</span>
        </div>
      </div>
      ${rowsHtml || '<div class="emptyBox">このsidのGPS Recorder候補はありません。</div>'}
    `;
  }

  async function runPreview(){
    ensurePanel();
    setBadge('照合中','warn');
    setStatus('logsync payload とGPS Recorder候補を照合中...');

    const p = decodeLogSyncPayloadFromHash();
    if(!p || p.__error){
      render(p, [], []);
      setBadge('未取得','warn');
      setStatus(p && p.__error ? 'logsync decode error' : '#logsync payload がありません。Pico W /log からMap連携した後に確認してください。');
      return;
    }

    const sid = s(p.sid);
    const rows = await readRecorderCandidates(sid);
    const start = payloadStartMs(p);
    const end = payloadEndMs(p);
    const matched = rows.filter(c => overlaps(c, start, end));

    try{
      window.wakasagiGpsRecorderLogsyncPreview = {version:VERSION, payload:p, candidates:rows, matched:matched};
    }catch(e){}

    render(p, rows, matched);
    setBadge(`候補${matched.length}/${rows.length}`, matched.length ? 'good' : 'warn');
    setStatus(`sid=${sid || '-'} / logsync時刻範囲内のGPS候補 ${matched.length}件 / 同sid候補 ${rows.length}件。まだ釣行履歴へ保存していません。`);
  }

  function init(){
    ensurePanel();
    const btn = document.getElementById('gpsRecorderLogsyncPreviewRun');
    if(btn) btn.onclick = runPreview;
    console.info('[wakasagi] gps recorder logsync preview installed', VERSION);

    // Stage1のlogsync処理がhashを消す前に、まずプレビュー用に拾う。
    setTimeout(()=>{
      if((location.hash || '').startsWith('#logsync=')){
        runPreview().catch(()=>{});
      }
    }, 500);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  }else{
    init();
  }
})();
