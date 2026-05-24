// WebGL kaleidoscope plate driven from main.js
(function(){
  'use strict';

  const canvas = document.getElementById('bg');
  const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });

  if(!gl){
    // Graceful CSS fallback: an animated conic gradient that still feels lush.
    canvas.style.background = 'conic-gradient(from 0deg at 50% 50%, #ff7fd6, #ffd57f, #7fe9ff, #c890ff, #ff7fd6)';
    canvas.style.filter = 'blur(40px) saturate(1.2)';
    canvas.style.opacity = '.6';
    const noop = () => {};
    const fakeState = { intensity: 0, mouse: [0.5, 0.5], pulse: 0, hue: 0.78 };
    window.PsyShader = {
      tick: noop, resize: noop,
      setIntensity(v){ fakeState.intensity = v; canvas.style.opacity = (0.35 + v*0.55).toFixed(2); },
      setMouse(x,y){ fakeState.mouse[0]=x; fakeState.mouse[1]=y; },
      triggerPulse(){}, setHue(h){ fakeState.hue = h; },
      get state(){ return fakeState; }
    };
    return;
  }

  function compile(type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
      console.error(gl.getShaderInfoLog(s));
    }
    return s;
  }

  const vs = compile(gl.VERTEX_SHADER,   document.getElementById('vs').textContent);
  const fs = compile(gl.FRAGMENT_SHADER, document.getElementById('fs').textContent);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs);
  gl.linkProgram(prog); gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1,-1,  1,-1,  -1,1,
    -1, 1,  1,-1,   1,1
  ]), gl.STATIC_DRAW);

  const loc = gl.getAttribLocation(prog, 'a_position');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const u = {
    res:       gl.getUniformLocation(prog, 'u_res'),
    time:      gl.getUniformLocation(prog, 'u_time'),
    intensity: gl.getUniformLocation(prog, 'u_intensity'),
    mouse:     gl.getUniformLocation(prog, 'u_mouse'),
    pulse:     gl.getUniformLocation(prog, 'u_pulse'),
    hue:       gl.getUniformLocation(prog, 'u_hue'),
  };

  const state = {
    intensity: 0.02,
    mouse: [0.5, 0.5],
    pulse: 0,
    hue: 0.78,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
  };

  function resize(){
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.floor(window.innerWidth  * state.dpr);
    canvas.height = Math.floor(window.innerHeight * state.dpr);
    canvas.style.width  = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  window.addEventListener('resize', resize, { passive: true });
  resize();

  function tick(t){
    // pulse decay
    if(state.pulse > 0.001) state.pulse *= 0.94;
    else state.pulse = 0;

    gl.uniform2f(u.res, canvas.width, canvas.height);
    gl.uniform1f(u.time, t * 0.001);
    gl.uniform1f(u.intensity, state.intensity);
    gl.uniform2f(u.mouse, state.mouse[0], state.mouse[1]);
    gl.uniform1f(u.pulse, state.pulse);
    gl.uniform1f(u.hue, state.hue);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  window.PsyShader = {
    tick,
    resize,
    setIntensity(v){ state.intensity = Math.max(0, Math.min(1, v)); },
    setMouse(x, y){ state.mouse[0] = x; state.mouse[1] = 1 - y; },
    triggerPulse(r){ state.pulse = Math.max(state.pulse, r || 0.45); },
    setHue(h){ state.hue = h; },
    get state(){ return state; }
  };
})();
