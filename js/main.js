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
    PsyShader.triggerPulse(0.5 + Math.random()*0.3);
    Chicken.glitch(0.6);
    Chicken.shake(0.5);
    Chicken.burstFeathers(8 + Math.floor(state.intensity * 20));
    Chicken.sparkAt(e.clientX, e.clientY);
    PsyAudio.pluckCluck();
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
    state.autoEscalate = false;
    state.targetIntensity = Math.max(0, Math.min(1, state.targetIntensity + (e.deltaY > 0 ? 0.04 : -0.04)));
    Chicken.glitch(0.2);
  }, { passive: true });

})();
