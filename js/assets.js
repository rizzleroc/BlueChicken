// Asset loader: small Image() registry with a graceful "ready" flag.
// Every consumer reads .ready on a returned handle and falls back to its
// procedural drawing path until the image actually loads (or errors).
//
// Paths are relative to the page root. Missing files quietly stay
// unready — the site keeps running, the procedural visuals keep
// drawing. Drop a PNG into assets/<path> and the next frame picks it up.
(function(){
  'use strict';

  const cache = new Map();

  function load(path){
    if(cache.has(path)) return cache.get(path);
    const handle = { img: new Image(), ready: false, failed: false, path };
    handle.img.decoding = 'async';
    handle.img.addEventListener('load', () => {
      if(handle.img.naturalWidth > 0) handle.ready = true;
      else handle.failed = true;
    }, { once: true });
    handle.img.addEventListener('error', () => { handle.failed = true; }, { once: true });
    handle.img.src = path;
    cache.set(path, handle);
    return handle;
  }

  window.Assets = { load };
})();
