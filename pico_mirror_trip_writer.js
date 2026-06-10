(()=>{
  'use strict';

  const VERSION = 'pico_mirror_trip_writer_20260610m';
  const qs = new URLSearchParams(location.search);
  const allowedPicoOrigin = String(qs.get('pico') || '').trim();
  let worker = null;
  let workerFailed = false;

  function originOk(ev){
    if(!allowedPicoOrigin) return true;
    return String(ev && ev.origin || '') === allowedPicoOrigin;
  }

  function ensureWorker(){
    if(worker || workerFailed) return worker;
    try{
      worker = new Worker('./pico_mirror_trip_worker.js?v=20260610m');
      worker.onerror = function(){
        workerFailed = true;
        try{ worker.terminate(); }catch(e){}
        worker = null;
      };
      return worker;
    }catch(e){
      workerFailed = true;
      return null;
    }
  }

  window.addEventListener('message', function(ev){
    const data = ev && ev.data ? ev.data : null;
    if(!data || !data.type) return;
    if(data.type !== 'wakasagi:pico-gps-candidate' && data.type !== 'wakasagi:pico-activity-rows') return;
    if(!originOk(ev)) return;
    const w = ensureWorker();
    if(!w) return;
    try{ w.postMessage(data); }catch(e){}
  }, false);
})();
