// Orchestrator
(function(){
  'use strict';

  const intro = document.getElementById('intro');
  const stage = document.getElementById('stage');
  const beginBtn = document.getElementById('begin');
  const muteBtn  = document.getElementById('muteBtn');
  const exitBtn  = document.getElementById('exitBtn');
  const sanityBar = document.getElementById('sanityBar');
  const fluxBar   = document.getElementById('fluxBar');
  const entropyBar= document.getElementById('entropyBar');
  const phaseLabel= document.getElementById('phaseLabel');
  const bigtext   = document.getElementById('bigtext');
  const hint      = document.getElementById('hint');

  const state = {
    running: false,
    startTime: 0,
    intensity: 0,
    targetIntensity: 0,
    sanity: 1,
    flux: 0,
    entropy: 0,
    phase: -1,
    autoEscalate: true,
  };

  // ----- phase scripts ----------------------------------------------------
  // each phase: { name, t (start sec), intensity (target), msg }
  const PHASES = [
    { t:  0.0, name:'PHASE 01 · ONBOARDING',   intensity: 0.05, msg:'hello, little engine' },
    { t:  6.0, name:'PHASE 02 · CALIBRATION',  intensity: 0.18, msg:'tuning the cluck' },
    { t: 14.0, name:'PHASE 03 · IGNITION',     intensity: 0.36, msg:'oh.' },
    { t: 22.0, name:'PHASE 04 · OVERDRIVE',    intensity: 0.58, msg:'oh no.' },
    { t: 32.0, name:'PHASE 05 · KALEIDOCLUCK', intensity: 0.78, msg:'we are the chicken' },
    { t: 44.0, name:'PHASE 06 · ENLIGHTENMENT',intensity: 0.95, msg:'the egg sees you' },
    { t: 58.0, name:'PHASE 07 · TRANSCENDENCE',intensity: 1.00, msg:'cluck. cluck. om.' },
  ];

  // ----- mouse / input ----------------------------------------------------
  let mouse = { x: 0.5, y: 0.5 };

  function onPointer(e){
    const px = (e.clientX || (e.touches && e.touches[0].clientX) || 0);
    const py = (e.clientY || (e.touches && e.touches[0].clientY) || 0);
    mouse.x = px / window.innerWidth;
    mouse.y = py / window.innerHeight;
    PsyShader.setMouse(mouse.x, mouse.y);
    Chicken.setMouse(mouse.x, mouse.y);
    Chicken.shake(0.04 * state.intensity);
    state.flux = Math.min(1, state.flux + 0.01);
  }
  window.addEventListener('mousemove', onPointer, { passive: true });
  window.addEventListener('touchmove', onPointer, { passive: true });

  function onClick(e){
    if(!state.running) return;

    // ignore clicks on UI elements
    const hitUi = e.target && e.target.closest && e.target.closest('.rig, .readouts, .hud');
    if(hitUi) return;

    // hit-test the chicken parts first
    const part = Chicken.hitTest(e.clientX, e.clientY);
    if(part === 'beak'){
      PsyAudio.pluckCluck(); PsyAudio.pluckCluck();
      Chicken.sparkAt(e.clientX, e.clientY);
      return;
    }
    if(part === 'head'){
      // toggle head detach
      const cur = !!state._uiHeadOff;
      state._uiHeadOff = !cur;
      Chicken.toggle('headOff', !cur);
      syncSwitch('headOff', !cur);
      return;
    }
    if(part === 'body'){
      const cur = !!state._uiHatched;
      state._uiHatched = !cur;
      Chicken.toggle('hatched', !cur);
      syncSwitch('hatched', !cur);
      Chicken.burstFeathers(12);
      return;
    }
    if(part === 'dial'){
      // dial click without drag — just pulse
      PsyShader.triggerPulse(0.6);
      return;
    }

    PsyShader.triggerPulse(0.5 + Math.random()*0.3);
    Chicken.glitch(0.6);
    Chicken.shake(0.5);
    Chicken.burstFeathers(8 + Math.floor(state.intensity * 20));
    Chicken.sparkAt(e.clientX, e.clientY);
    PsyAudio.pluckCluck();
    state.shakeBurst = Math.min(1, (state.shakeBurst || 0) + 0.25);
    state.entropy = Math.min(1, state.entropy + 0.08);
    state.sanity = Math.max(0, state.sanity - 0.05);
    if(state.autoEscalate){
      state.targetIntensity = Math.min(1, state.targetIntensity + 0.04);
    }
  }
  window.addEventListener('click', onClick);

  window.addEventListener('keydown', (e) => {
    if(!state.running) return;
    if(e.code === 'Space'){
      e.preventDefault();
      PsyAudio.bigPulse();
      PsyShader.triggerPulse(0.9);
      Chicken.panic(0.9);
      Chicken.burstFeathers(40);
      state.targetIntensity = Math.min(1, state.targetIntensity + 0.18);
      state.sanity = Math.max(0, state.sanity - 0.18);
      state.entropy = Math.min(1, state.entropy + 0.2);
      state.shakeBurst = Math.min(1, (state.shakeBurst || 0) + 0.6);
    }
  });

  // ----- transitions ------------------------------------------------------
  function showBigText(msg){
    bigtext.textContent = msg;
    bigtext.classList.add('show');
    clearTimeout(showBigText._t);
    showBigText._t = setTimeout(() => bigtext.classList.remove('show'), 2600);
  }

  function setPhase(p){
    if(p === state.phase) return;
    state.phase = p;
    const def = PHASES[p];
    phaseLabel.textContent = def.name;
    state.targetIntensity = def.intensity;
    showBigText(def.msg);
    // hue shift per phase
    PsyShader.setHue((0.78 + p * 0.13) % 1);
    if(p >= 2){
      Chicken.glitch(0.4);
      Chicken.burstFeathers(12 + p * 4);
    }
    if(p >= 4){
      PsyAudio.bigPulse();
    }
  }

  // ----- main loop --------------------------------------------------------
  function loop(t){
    requestAnimationFrame(loop);

    // smooth intensity
    state.intensity += (state.targetIntensity - state.intensity) * 0.03;

    // screen shake at high intensity + on pulse spikes
    const shakeAmt = state.intensity > 0.5
      ? (state.intensity - 0.5) * 14 + (state.shakeBurst || 0) * 20
      : (state.shakeBurst || 0) * 10;
    if(shakeAmt > 0.1){
      document.body.style.setProperty('--shake-x', ((Math.random()-0.5) * shakeAmt).toFixed(2) + 'px');
      document.body.style.setProperty('--shake-y', ((Math.random()-0.5) * shakeAmt).toFixed(2) + 'px');
    } else {
      document.body.style.setProperty('--shake-x', '0px');
      document.body.style.setProperty('--shake-y', '0px');
    }
    state.shakeBurst = (state.shakeBurst || 0) * 0.86;
    PsyShader.setIntensity(state.intensity);
    Chicken.setIntensity(state.intensity);
    PsyAudio.setIntensity(state.intensity);

    // hue drift
    if(state.running){
      const elapsed = (performance.now() - state.startTime) * 0.001;
      let p = 0;
      for(let i = 0; i < PHASES.length; i++){
        if(elapsed >= PHASES[i].t) p = i;
      }
      if(state.autoEscalate && p !== state.phase) setPhase(p);

      // gentle hue rotation
      const livePhase = state.phase >= 0 ? state.phase : 0;
      PsyShader.setHue(((0.78 + livePhase * 0.13) + elapsed * 0.008) % 1);
    }

    // sanity drifts down with intensity
    state.sanity += (Math.max(0, 1 - state.intensity*1.2) - state.sanity) * 0.01;
    state.flux *= 0.985;
    state.entropy *= 0.997;

    sanityBar.style.width  = (state.sanity * 100).toFixed(1) + '%';
    fluxBar.style.width    = (state.flux * 100).toFixed(1) + '%';
    entropyBar.style.width = (state.entropy * 100).toFixed(1) + '%';

    // render
    PsyShader.tick(t);
    Chicken.render(t);
  }
  requestAnimationFrame(loop);

  // ----- begin / reset ----------------------------------------------------
  function begin(){
    if(state.running) return;
    state.running = true;
    state.startTime = performance.now();
    state.targetIntensity = 0.05;
    state.sanity = 1; state.flux = 0; state.entropy = 0;
    Chicken.enable();

    // audio (requires user gesture)
    PsyAudio.start();
    PsyAudio.setMuted(false);
    muteBtn.textContent = 'SOUND: ON';

    // crossfade
    intro.classList.add('fade-out');
    intro.style.transition = 'opacity 700ms ease, transform 700ms ease';
    intro.style.opacity = '0';
    intro.style.transform = 'scale(0.96)';
    setTimeout(() => {
      intro.classList.add('hidden');
      stage.classList.remove('hidden');
      stage.setAttribute('aria-hidden', 'false');
      stage.style.opacity = '0';
      requestAnimationFrame(() => {
        stage.style.transition = 'opacity 700ms ease';
        stage.style.opacity = '1';
      });
    }, 700);
  }

  function reset(){
    state.running = false;
    state.phase = -1;
    state.targetIntensity = 0;
    state.intensity = 0;
    Chicken.disable();
    PsyAudio.setMuted(true);
    muteBtn.textContent = 'SOUND: OFF';

    stage.style.transition = 'opacity 500ms ease';
    stage.style.opacity = '0';
    setTimeout(() => {
      stage.classList.add('hidden');
      stage.setAttribute('aria-hidden', 'true');
      intro.classList.remove('hidden');
      intro.style.opacity = '1';
      intro.style.transform = 'scale(1)';
    }, 500);
  }

  beginBtn.addEventListener('click', begin);
  exitBtn.addEventListener('click', reset);

  muteBtn.addEventListener('click', () => {
    const m = !PsyAudio.isMuted();
    PsyAudio.setMuted(m);
    muteBtn.textContent = 'SOUND: ' + (m ? 'OFF' : 'ON');
  });

  // initial pointer to center
  PsyShader.setMouse(0.5, 0.5);
  Chicken.setMouse(0.5, 0.5);

  // scroll wheel = manual escalation knob
  window.addEventListener('wheel', (e) => {
    if(!state.running) return;
    if(e.target && e.target.closest && e.target.closest('.rig')) return;
    state.autoEscalate = false;
    state.targetIntensity = Math.max(0, Math.min(1, state.targetIntensity + (e.deltaY > 0 ? 0.04 : -0.04)));
    Chicken.glitch(0.2);
  }, { passive: true });

  // ===== dial drag (manual intensity by twist) =====
  let dragging = false;
  let dragStartAngle = 0;
  let dragStartIntensity = 0;
  function angleFrom(dial, x, y){
    return Math.atan2(y - dial.cy, x - dial.cx);
  }
  window.addEventListener('mousedown', (e) => {
    if(!state.running) return;
    const dial = Chicken.dialAt && Chicken.dialAt();
    if(!dial) return;
    const dx = e.clientX - dial.cx, dy = e.clientY - dial.cy;
    if(dx*dx + dy*dy <= dial.r * dial.r){
      dragging = true;
      dragStartAngle = angleFrom(dial, e.clientX, e.clientY);
      dragStartIntensity = state.targetIntensity;
      state.autoEscalate = false;
      e.preventDefault();
    }
  });
  window.addEventListener('mousemove', (e) => {
    if(!dragging) return;
    const dial = Chicken.dialAt && Chicken.dialAt();
    if(!dial) return;
    const a = angleFrom(dial, e.clientX, e.clientY);
    let d = a - dragStartAngle;
    // wrap to (-pi, pi)
    if(d > Math.PI) d -= Math.PI*2;
    if(d < -Math.PI) d += Math.PI*2;
    // 1 full revolution = 1.0 intensity
    state.targetIntensity = Math.max(0, Math.min(1, dragStartIntensity + d / (Math.PI * 1.5)));
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  // ===== control rig wiring =====
  const switchEls = {};
  document.querySelectorAll('.switch').forEach(el => {
    const name = el.getAttribute('data-toggle');
    switchEls[name] = el;
    el.addEventListener('click', () => {
      const on = !el.classList.contains('on');
      el.classList.toggle('on', on);
      Chicken.toggle(name, on);
      // sync hidden state mirror so chicken-body click can also reflect
      if(name === 'hatched') state._uiHatched = on;
      if(name === 'headOff') state._uiHeadOff = on;
      PsyAudio.pluckCluck();
      Chicken.shake(0.2);
    });
  });
  function syncSwitch(name, on){
    const el = switchEls[name];
    if(el) el.classList.toggle('on', on);
  }

  // sliders
  document.querySelectorAll('.slider').forEach(s => {
    const name = s.getAttribute('data-slider');
    const input = s.querySelector('input');
    const value = s.querySelector('.slider-value');
    const apply = () => {
      const v = +input.value;
      if(name === 'fractal'){ Chicken.setFractal(v); value.textContent = String(v); }
      else if(name === 'gravity'){ Chicken.setGravity(v / 100); value.textContent = (v/100).toFixed(2); }
      else if(name === 'warp'){ Chicken.setWarp(v / 100); value.textContent = v + '%'; }
    };
    input.addEventListener('input', apply);
    apply();
  });

  // action buttons
  document.querySelectorAll('.rig-btn').forEach(b => {
    b.addEventListener('click', () => {
      const a = b.getAttribute('data-action');
      if(a === 'lay'){
        Chicken.layEgg();
        PsyAudio.pluckCluck();
      } else if(a === 'zap'){
        PsyShader.triggerPulse(0.8);
        Chicken.glitch(0.7);
        Chicken.shake(0.6);
        Chicken.burstFeathers(16);
        PsyAudio.bigPulse();
        state.shakeBurst = Math.min(1, (state.shakeBurst || 0) + 0.4);
      } else if(a === 'meltdown'){
        Chicken.meltdown();
        PsyAudio.bigPulse();
        PsyShader.triggerPulse(1.0);
        Chicken.panic(1);
        state.shakeBurst = 1;
        state.targetIntensity = 1;
        state.autoEscalate = false;
        if(switchEls.hatched) switchEls.hatched.classList.add('on');
        if(switchEls.headOff) switchEls.headOff.classList.add('on');
        if(switchEls.eyeEject) switchEls.eyeEject.classList.add('on');
        if(switchEls.strobe) switchEls.strobe.classList.add('on');
        state._uiHatched = true; state._uiHeadOff = true;
      }
    });
  });

  // egg counter display
  const eggCountEl = document.getElementById('eggCount');
  if(eggCountEl){
    setInterval(() => {
      eggCountEl.textContent = String(Chicken.eggCount()).padStart(3, '0');
    }, 200);
  }

  // make pointer change on hover over chicken parts / dial
  window.addEventListener('mousemove', (e) => {
    if(!state.running) return;
    if(e.target && e.target.closest && e.target.closest('.rig')) return;
    const part = Chicken.hitTest(e.clientX, e.clientY);
    document.body.style.cursor = part ? (part === 'dial' ? 'grab' : 'pointer') : '';
  });

})();
