(function(){
  'use strict';
  const VERSION = 'wakasagi_pico_fixed_nav_20260625a';

  function qs(){
    try{ return new URLSearchParams(location.search); }
    catch(e){ return new URLSearchParams(''); }
  }

  function normalizePicoHost(v){
    let s = String(v || '').trim();
    if(!s) return '';
    try{ s = decodeURIComponent(s); }catch(e){}
    s = s.replace(/^https?:\/\//i,'').replace(/\/.*$/,'').trim();
    return s;
  }

  function readPicoHost(){
    const p = qs();
    let host = normalizePicoHost(p.get('pico'));
    if(!host){
      try{ host = normalizePicoHost(localStorage.getItem('pico_ip')); }catch(e){}
    }
    if(!host) host = '192.168.4.1';
    try{ localStorage.setItem('pico_ip', host); }catch(e){}
    return host;
  }

  function picoUrl(path){
    const host = readPicoHost();
    const p = String(path || '/log');
    return 'http://' + host + (p.charAt(0)==='/' ? p : '/' + p);
  }

  function setText(id, text){
    const el = document.getElementById(id);
    if(el) el.textContent = text;
  }

  function markReady(){
    const host = readPicoHost();
    setText('fixedPicoHost', 'Pico W: ' + host);
    try{
      window.wakasagiPicoFixedNav = {
        version: VERSION,
        host: host,
        log: picoUrl('/log'),
        remote: picoUrl('/remote')
      };
    }catch(e){}
  }

  function bind(){
    markReady();

    const logBtn = document.getElementById('fixedPicoLog');
    if(logBtn && !logBtn.__wakasagiBound){
      logBtn.__wakasagiBound = true;
      logBtn.addEventListener('click', function(ev){
        ev.preventDefault();
        markReady();
        location.href = picoUrl('/log');
      });
    }

    const remoteBtn = document.getElementById('fixedPicoRemote');
    if(remoteBtn && !remoteBtn.__wakasagiBound){
      remoteBtn.__wakasagiBound = true;
      remoteBtn.addEventListener('click', function(ev){
        ev.preventDefault();
        markReady();
        location.href = picoUrl('/remote');
      });
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', bind);
  }else{
    bind();
  }
  window.addEventListener('pageshow', bind);
})();
