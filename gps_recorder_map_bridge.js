(function(){
  'use strict';

  const VERSION = 'gps_recorder_map_bridge_20260526f';
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

  function currentSidHint(){
    const q = new URLSearchParams(location.search);
    return s(q.get('sid')) || s(q.get('pico_sid')) || s(localStorage.getItem('wakasagi_last_sid')) || '';
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

  function ensurePanel(){
    let panel = document.getElementById('gpsRecorderBridgePanel');
    if(panel) return panel;

    panel = document.createElement('section');
    panel.className = 'card';
    panel.id = 'gpsRecorderBridgePanel';
    panel.innerHTML = `
      <div class="cardHead">
        <div>
          <h2>GPS候補記録</h2>
          <p>gps-recorder.html が保存した移動ポイント候補を読み込みます。ここでは釣行履歴へ保存せず、候補確認だけを行います。</p>
        </div>
        <span id="gpsRecorderBridgeBadge" class="pill">未読込</span>
      </div>
      <div class="actions">
        <button id="gpsRecorderBridgeLoad" type="button">GPS候補を読み込み</button>
        <button id="gpsRecorderBridgeOpen" type="button">GPS候補記録ページを開く</button>
        <button id="gpsRecorderBridgeClearSid" type="button">このsidのGPS候補を削除</button>
      </div>
      <p id="gpsRecorderBridgeStatus" class="muted">未読込</p>
      <div id="gpsRecorderBridgeList" class="list"></div>
    `;

    const logCard = document.querySelector('.logSyncCard');
    if(logCard && logCard.parentNode){
      logCard.parentNode.insertBefore(panel, logCard.nextSibling);
    }else{
      document.body.appendChild(panel);
    }
    return panel;
  }

  function setBadge(text, cls){
    const b = document.getElementById('gpsRecorderBridgeBadge');
    if(!b) return;
    b.textContent = text;
    b.className = 'pill ' + (cls || '');
  }
  function setStatus(text){
    const st = document.getElementById('gpsRecorderBridgeStatus');
    if(st) st.textContent = text;
  }

  function renderRows(rows, sid){
    const box = document.getElementById('gpsRecorderBridgeList');
    if(!box) return;
    if(!rows.length){
      box.innerHTML = '<div class="emptyBox">GPS候補はありません。</div>';
      return;
    }
    box.innerHTML = rows.map(r => {
      const lat = s(r.latest_lat || r.lat);
      const lng = s(r.latest_lng || r.lng);
      const moved = s(r.moved_from_prev_m || r.moved_m || '');
      const acc = s(r.best_acc_m || r.acc_m || '');
      return `<div class="item">
        <div class="top"><span>G${esc(r.candidate_no || '-')} / sid ${esc(r.sid || '-')}</span><span>${esc(fmt(r.start_ms))}</span></div>
        <div class="body">
          座標 ${esc(lat)}, ${esc(lng)}<br>
          精度 ${esc(acc || '-')}m / 前候補から ${esc(moved || '-')}m / samples ${esc(r.sample_count || '-')}
        </div>
      </div>`;
    }).join('');
  }

  async function loadAndRender(){
    ensurePanel();
    const sid = currentSidHint();
    setStatus('GPS候補を読み込み中...');
    setBadge('読込中','warn');
    const rows = await readRecorderCandidates(sid);
    renderRows(rows, sid);
    setBadge(rows.length ? `候補${rows.length}` : '候補なし', rows.length ? 'good' : 'warn');
    setStatus(
      (sid ? `sid=${sid} / ` : 'sid指定なし / ') +
      `GPS候補 ${rows.length}件を読み込みました。現在は候補表示のみで、釣行履歴には保存しません。`
    );
    try{ window.wakasagiGpsRecorderCandidates = rows; }catch(e){}
  }

  function openRecorder(){
    const sid = currentSidHint() || 'TEST001';
    const url = './gps-recorder.html?sid=' + encodeURIComponent(sid);
    window.open(url, '_blank', 'noopener');
  }


  function deleteRecorderCandidatesBySid(sidTarget){
    return new Promise(async resolve=>{
      const db = await openRecorderDb();
      if(!db || !sidTarget){ resolve(0); return; }
      let count = 0;
      try{
        const tx = db.transaction(STORE_CAND, 'readwrite');
        const st = tx.objectStore(STORE_CAND);
        const req = st.openCursor();
        req.onsuccess = ev => {
          const cur = ev.target.result;
          if(!cur) return;
          const r = cur.value || {};
          if(s(r.sid) === s(sidTarget)){
            cur.delete();
            count++;
          }
          cur.continue();
        };
        tx.oncomplete = () => resolve(count);
        tx.onerror = () => resolve(count);
      }catch(e){
        resolve(count);
      }
    });
  }

  async function clearCurrentSidRecorderCandidates(){
    ensurePanel();
    const sid = currentSidHint();
    if(!sid){
      setStatus('sidが分からないため削除できません。/logからMap連携後、またはsid付きURLで開いてください。');
      setBadge('削除不可','warn');
      return;
    }
    if(!confirm('GPS Recorder側のこのsidの候補だけを削除します。\\n\\nsid=' + sid + '\\n\\nMap保存済み履歴やPico W /log側DBは削除しません。')){
      return;
    }
    setStatus('GPS Recorder候補を削除中...');
    setBadge('削除中','warn');
    const count = await deleteRecorderCandidatesBySid(sid);
    setStatus('GPS Recorder候補を削除しました: ' + count + '件 / sid=' + sid);
    setBadge('削除完了','good');
    await loadAndRender();
  }

  function init(){
    ensurePanel();
    const b1 = document.getElementById('gpsRecorderBridgeLoad');
    const b2 = document.getElementById('gpsRecorderBridgeOpen');
    const b3 = document.getElementById('gpsRecorderBridgeClearSid');
    if(b1) b1.onclick = loadAndRender;
    if(b2) b2.onclick = openRecorder;
    if(b3) b3.onclick = clearCurrentSidRecorderCandidates;
    setStatus('GPS Recorder候補DBをまだ読んでいません。');
    console.info('[wakasagi] gps recorder map bridge installed', VERSION);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  }else{
    init();
  }
})();
