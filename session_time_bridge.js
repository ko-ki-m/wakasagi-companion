// Wakasagi session time bridge
// Version: session_time_bridge_20260527i
//
// Purpose:
// - Keep Pico W log time (sid + seq + t_ms) correlated with smartphone epoch time.
// - This lets GPS candidates saved by smartphone Date.now() be matched to Pico W logs
//   even when Pico W has no NTP time in AP mode.
// - Smartphone/GitHub Pages side only. No GPS, no Pico W communication, no trip_records writes.
(function(){
  'use strict';

  const VERSION = 'session_time_bridge_20260527i';
  const DB_NAME = 'wakasagi_session_time_bridge_v1';
  const DB_VER = 1;
  const STORE = 'bridges';
  const MAX_ROWS_PER_SID = 2400;

  function s(v){ return String(v == null ? '' : v).trim(); }
  function n(v){ const x = Number(v); return Number.isFinite(x) ? x : null; }
  function now(){ return Date.now(); }

  function openDb(){
    return new Promise((resolve,reject)=>{
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = ev => {
        const db = ev.target.result;
        if(!db.objectStoreNames.contains(STORE)){
          const st = db.createObjectStore(STORE, {keyPath:'id'});
          try{ st.createIndex('sid', 'sid', {unique:false}); }catch(e){}
          try{ st.createIndex('sid_seq', ['sid','seq'], {unique:false}); }catch(e){}
          try{ st.createIndex('sid_phone', ['sid','phone_epoch_ms'], {unique:false}); }catch(e){}
          try{ st.createIndex('sid_pico', ['sid','pico_t_ms'], {unique:false}); }catch(e){}
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('session time bridge DB open failed'));
    });
  }

  async function withStore(mode, fn){
    const db = await openDb();
    try{
      return await new Promise((resolve,reject)=>{
        const tx = db.transaction(STORE, mode);
        const st = tx.objectStore(STORE);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error('session time bridge transaction failed'));
        tx.onabort = () => reject(tx.error || new Error('session time bridge transaction aborted'));
        Promise.resolve().then(()=>fn(st)).then(r=>{ result=r; }).catch(reject);
      });
    }finally{
      try{ db.close(); }catch(e){}
    }
  }

  function idFor(sid, seq, phoneMs, idx){
    const a = s(sid || 'nosid').replace(/[^A-Za-z0-9_.-]/g,'_');
    const q = n(seq);
    const p = n(phoneMs) || now();
    return a + '_' + (q != null ? ('Q' + String(q)) : ('T' + String(p))) + '_' + String(idx || 0);
  }

  async function list(sid){
    sid = s(sid);
    if(!sid) return [];
    return await withStore('readonly', async st => {
      const out = [];
      let req;
      try{ req = st.index('sid').openCursor(IDBKeyRange.only(sid)); }
      catch(e){ req = st.openCursor(); }
      return await new Promise((resolve,reject)=>{
        req.onsuccess = () => {
          const cur = req.result;
          if(!cur){
            out.sort((a,b)=>Number(a.phone_epoch_ms||0)-Number(b.phone_epoch_ms||0));
            resolve(out);
            return;
          }
          if(s(cur.value && cur.value.sid) === sid) out.push(cur.value);
          cur.continue();
        };
        req.onerror = () => reject(req.error || new Error('session bridge cursor failed'));
      });
    });
  }

  async function trimSid(sid){
    const rows = await list(sid);
    if(rows.length <= MAX_ROWS_PER_SID) return {deleted:0};
    const del = rows.slice(0, rows.length - MAX_ROWS_PER_SID);
    await withStore('readwrite', st => del.forEach(r=>st.delete(r.id)));
    return {deleted:del.length};
  }

  function rowBridgeFromPayloadRow(sid, row, idx){
    const seq = n(row && (row.q ?? row.seq));
    const pico = n(row && (row.t ?? row.t_ms));
    const phone = n(row && (row.r ?? row.recv_ms ?? row.first_recv_ms));
    if(phone == null || phone <= 0) return null;
    return {
      id:idFor(sid, seq, phone, idx),
      sid:sid,
      seq:seq,
      pico_t_ms:pico,
      phone_epoch_ms:phone,
      recv_ms:phone,
      source:'tlog_activity_row',
      created_ms:now(),
      version:VERSION
    };
  }

  async function recordPayload(payload){
    const sid = s(payload && payload.sid);
    if(!sid) return {ok:false, reason:'no_sid'};
    const rows = Array.isArray(payload.tlog_activity_rows) ? payload.tlog_activity_rows : [];
    const bridges = [];
    rows.forEach((row, idx)=>{
      const b = rowBridgeFromPayloadRow(sid, row, idx);
      if(b) bridges.push(b);
    });

    const firstSeq = n(payload.first_seq);
    const lastSeq = n(payload.last_seq);
    const firstT = n(payload.first_t_ms);
    const lastT = n(payload.last_t_ms);
    const firstRecv = n(payload.first_recv_ms);
    const lastRecv = n(payload.last_recv_ms);
    if(firstRecv != null && firstRecv > 0){
      bridges.push({id:idFor(sid, firstSeq, firstRecv, 'first'), sid, seq:firstSeq, pico_t_ms:firstT, phone_epoch_ms:firstRecv, recv_ms:firstRecv, source:'payload_first', created_ms:now(), version:VERSION});
    }
    if(lastRecv != null && lastRecv > 0){
      bridges.push({id:idFor(sid, lastSeq, lastRecv, 'last'), sid, seq:lastSeq, pico_t_ms:lastT, phone_epoch_ms:lastRecv, recv_ms:lastRecv, source:'payload_last', created_ms:now(), version:VERSION});
    }
    if(!bridges.length) return {ok:false, reason:'no_time_bridge_rows'};

    await withStore('readwrite', st => bridges.forEach(b=>st.put(b)));
    await trimSid(sid);
    return {ok:true, sid, saved:bridges.length};
  }

  async function picoToPhone(sid, picoTms){
    sid = s(sid);
    const target = n(picoTms);
    if(!sid || target == null) return null;
    const rows = (await list(sid)).filter(r => n(r.pico_t_ms) != null && n(r.phone_epoch_ms) != null);
    if(!rows.length) return null;
    let best = null;
    for(const r of rows){
      const d = Math.abs(Number(r.pico_t_ms) - target);
      if(!best || d < best.delta) best = {row:r, delta:d};
    }
    if(!best) return null;
    return Number(best.row.phone_epoch_ms) + (target - Number(best.row.pico_t_ms));
  }

  async function status(sid){
    const rows = sid ? await list(sid) : [];
    return {
      version:VERSION,
      db:DB_NAME,
      store:STORE,
      sid:sid || '',
      rows:rows.length,
      writes_trip_records:false,
      gets_gps:false,
      calls_pico_w:false,
      ntp_required:false
    };
  }

  window.wakasagiSessionTimeBridge = {
    version:VERSION,
    recordPayload,
    list,
    picoToPhone,
    status
  };
  try{ console.info('[wakasagi] session time bridge installed', VERSION); }catch(e){}
})();
