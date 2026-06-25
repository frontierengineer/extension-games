// EmulatorJS runs from window globals and a single global instance, so each
// game gets its own <iframe> for isolation — multiple game tabs can run at once
// and the emulator's keyboard handling stays scoped to its frame. The frame is
// an `srcdoc` document sandboxed to `allow-scripts` (opaque origin), so the CDN
// code can't reach the app origin's DOM, storage, or cookies. It waits for the
// ROM bytes over postMessage, then boots EmulatorJS from a version-pinned CDN
// path. The ROM is never refetched here — the host already downloaded it past
// CORS; we only hand EmulatorJS the bytes, and it extracts/zip-detects (blob:
// URLs still work inside the sandbox). The opaque origin has no storage of its
// own, so battery saves and save states round-trip over postMessage and
// persist in the extension store.

// The pinned EmulatorJS CDN. The ORIGIN is declared in two places that MUST stay
// in sync: the extension's `ui.frameHosts` (extension.json — widens the parent
// webview CSP, which this sandboxed child frame inherits) and the srcdoc's own
// <meta> CSP below (an explicit, self-contained policy so the contained frame is
// allowed to run eval/WASM + load from this CDN even on a browser that doesn't
// apply CSP inheritance to a sandboxed opaque-origin srcdoc frame).
export const EJS_ORIGIN = 'https://cdn.emulatorjs.org';
export const EJS_DATA = `${EJS_ORIGIN}/4.2.3/data/`;

export const EMU_READY = 'ejs-ready';
export const EMU_ROM = 'ejs-rom';
export const EMU_ERROR = 'ejs-error';
export const EMU_SAVE = 'ejs-save';
export const EMU_STATE = 'ejs-state';

export function emulatorSrcdoc(): string {
  // Explicit CSP for THIS opaque-origin sandboxed frame. It permits exactly what
  // EmulatorJS needs — eval + WASM compilation, and code/styles/data from the
  // pinned CDN — and nothing app-origin (the frame has no same-origin reach
  // anyway). When the frame DOES inherit the parent webview policy (the common
  // case), the two are enforced as an intersection; the parent's `ui` opt-in is
  // widened to the same CDN so the intersection still allows it. When it does
  // NOT inherit, this is the whole policy. Either way the frame can boot.
  const csp = [
    `default-src 'self' ${EJS_ORIGIN} blob: data:`,
    `script-src 'self' ${EJS_ORIGIN} 'unsafe-eval' 'wasm-unsafe-eval' 'unsafe-inline' blob:`,
    `style-src 'self' ${EJS_ORIGIN} 'unsafe-inline'`,
    `worker-src 'self' ${EJS_ORIGIN} blob:`,
  ].join('; ');
  return `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${csp}"><style>
html,body{margin:0;height:100%;background:#000;overflow:hidden}
#game{width:100%;height:100%}
</style></head><body><div id="game"></div><script>
(function(){
  // Opaque origin: localStorage access throws and indexedDB.open rejects mid-boot,
  // so give EmulatorJS an in-memory localStorage and no indexedDB (its own guards
  // handle undefined; a throwing one hangs its core download).
  var mem={};
  var shim={
    getItem:function(k){ return Object.prototype.hasOwnProperty.call(mem,k)?mem[k]:null; },
    setItem:function(k,v){ mem[k]=String(v); },
    removeItem:function(k){ delete mem[k]; },
    clear:function(){ mem={}; },
    key:function(i){ return Object.keys(mem)[i]||null; },
    get length(){ return Object.keys(mem).length; }
  };
  try{ Object.defineProperty(window,'localStorage',{value:shim,configurable:true}); }catch(e){}
  try{ Object.defineProperty(window,'indexedDB',{value:undefined,configurable:true}); }catch(e){}

  var booted=false, save=null, state=null;
  function fail(m){ try{ parent.postMessage({type:${JSON.stringify(EMU_ERROR)},message:String(m)},'*'); }catch(e){} }
  function send(type,bytes){ try{ parent.postMessage({type:type,bytes:bytes},'*'); }catch(e){} }
  function notify(m){ try{ window.EJS_emulator.displayMessage(m); }catch(e){} }
  function gm(){ return window.EJS_emulator.gameManager; }
  function sameBytes(a,b){
    if(!a||!b||a.length!==b.length) return false;
    for(var i=0;i<a.length;i++) if(a[i]!==b[i]) return false;
    return true;
  }
  function writeSaveFile(bytes){
    var g=gm(), path=g.getSaveFilePath(), parts=path.split('/'), cp='';
    for(var i=0;i<parts.length-1;i++){
      if(!parts[i]) continue;
      cp+='/'+parts[i];
      if(!g.FS.analyzePath(cp).exists) g.FS.mkdir(cp);
    }
    if(g.FS.analyzePath(path).exists) g.FS.unlink(path);
    g.FS.writeFile(path,bytes);
    g.loadSaveFiles();
  }
  function flushSave(){
    try{
      var b=gm().getSaveFile();
      if(b&&b.length&&!sameBytes(b,save)){ save=new Uint8Array(b); send(${JSON.stringify(EMU_SAVE)},save); }
    }catch(e){}
  }
  window.addEventListener('message',function(e){
    if(e.source!==parent) return;
    var d=e.data; if(!d||d.type!==${JSON.stringify(EMU_ROM)}||booted) return; booted=true;
    save=d.save?new Uint8Array(d.save):null;
    state=d.state?new Uint8Array(d.state):null;
    try{
      window.EJS_player='#game';
      window.EJS_core=d.core;
      window.EJS_pathtodata=${JSON.stringify(EJS_DATA)};
      window.EJS_gameUrl=URL.createObjectURL(new Blob([d.bytes]));
      window.EJS_gameName=d.name||'Game';
      window.EJS_startOnLoaded=true;
      window.EJS_threads=false;
      window.EJS_onGameStart=function(){
        if(save){ try{ writeSaveFile(save); }catch(err){} }
        setInterval(flushSave,30000);
      };
      window.EJS_onSaveState=function(p){
        if(!p||!p.state||!p.state.length) return;
        state=new Uint8Array(p.state);
        send(${JSON.stringify(EMU_STATE)},state);
        notify('State saved to your library');
      };
      window.EJS_onLoadState=function(){
        if(!state){ notify('No saved state yet'); return; }
        try{ gm().loadState(state); notify('State loaded'); }catch(err){ notify('Failed to load state'); }
      };
      window.EJS_onSaveSave=function(p){
        if(!p||!p.save||!p.save.length){ notify('No save data yet'); return; }
        save=new Uint8Array(p.save);
        send(${JSON.stringify(EMU_SAVE)},save);
        notify('Save stored to your library');
      };
      window.EJS_onLoadSave=function(){
        if(!save){ notify('No save data yet'); return; }
        try{ writeSaveFile(save); notify('Save loaded'); }catch(err){ notify('Failed to load save'); }
      };
      var s=document.createElement('script');
      s.src=window.EJS_pathtodata+'loader.js';
      var settled=false;
      s.onload=function(){ settled=true; };
      s.onerror=function(){ settled=true; fail('Failed to load EmulatorJS from its CDN.'); };
      document.body.appendChild(s);
      // A CSP-blocked script load fires NEITHER onload nor onerror in some
      // engines, so without this watchdog the frame would just sit black. If
      // loader.js hasn't resolved either way, surface it instead of hanging.
      setTimeout(function(){ if(!settled) fail('Could not load EmulatorJS from its CDN — it may be blocked or unreachable.'); },15000);
    }catch(err){ fail(err && err.message || err); }
  });
  parent.postMessage({type:${JSON.stringify(EMU_READY)}},'*');
})();
</script></body></html>`;
}
