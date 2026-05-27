// Generative psychedelic chicken audio synth
(function(){
  'use strict';

  let ctx = null;
  let master = null;
  let started = false;
  let muted = true;
  let intensity = 0;

  let pad, lfo, lfoGain, padFilter;
  let droneOsc, droneGain;
  let clucks = [];

  function ensureCtx(){
    if(ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);
  }

  function start(){
    ensureCtx();
    if(!ctx || started) return;
    started = true;

    // ----- drone -----
    droneOsc = ctx.createOscillator();
    droneOsc.type = 'sawtooth';
    droneOsc.frequency.value = 55; // A1
    droneGain = ctx.createGain();
    droneGain.gain.value = 0.0;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 200;
    droneFilter.Q.value = 4;
    droneOsc.connect(droneFilter).connect(droneGain).connect(master);
    droneOsc.start();

    // ----- pad (slow detuned) -----
    pad = [];
    const padBus = ctx.createGain();
    padBus.gain.value = 0.06;
    padFilter = ctx.createBiquadFilter();
    padFilter.type = 'bandpass';
    padFilter.frequency.value = 600;
    padFilter.Q.value = 1.6;
    padBus.connect(padFilter).connect(master);

    [220, 277.18, 329.63, 415.30].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 12;
      const g = ctx.createGain();
      g.gain.value = 0.25;
      o.connect(g).connect(padBus);
      o.start();
      pad.push({ o, g });
    });

    // LFO on filter
    lfo = ctx.createOscillator();
    lfo.frequency.value = 0.12;
    lfoGain = ctx.createGain();
    lfoGain.gain.value = 280;
    lfo.connect(lfoGain).connect(padFilter.frequency);
    lfo.start();

    // fade in master
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.linearRampToValueAtTime(muted ? 0 : 0.25, ctx.currentTime + 1.2);
  }

  function pluckCluck(){
    if(!ctx || muted) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 8;
    const baseHz = 440 + Math.random() * 600 + intensity * 800;
    o.frequency.setValueAtTime(baseHz * 1.8, now);
    o.frequency.exponentialRampToValueAtTime(baseHz, now + 0.07);
    f.frequency.value = baseHz;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.18, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    o.type = 'square';
    o.connect(f).connect(g).connect(master);
    o.start(now);
    o.stop(now + 0.2);
  }

  function bigPulse(){
    if(!ctx || muted) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(80, now);
    o.frequency.exponentialRampToValueAtTime(28, now + 0.8);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.35, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    o.connect(g).connect(master);
    o.start(now);
    o.stop(now + 1.0);

    // noisy crash
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i] = (Math.random()*2-1) * (1 - i/d.length);
    const n = ctx.createBufferSource();
    n.buffer = buf;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.18, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    const nf = ctx.createBiquadFilter();
    nf.type = 'highpass'; nf.frequency.value = 1200;
    n.connect(nf).connect(ng).connect(master);
    n.start(now);
  }

  function setIntensity(v){
    intensity = Math.max(0, Math.min(1, v));
    if(!ctx) return;
    const now = ctx.currentTime;
    if(droneGain) droneGain.gain.linearRampToValueAtTime(0.08 + intensity * 0.18, now + 0.3);
    if(lfo)       lfo.frequency.linearRampToValueAtTime(0.1 + intensity * 2.5, now + 0.3);
    if(padFilter) padFilter.Q.linearRampToValueAtTime(1.5 + intensity * 9, now + 0.3);
    // detune pads progressively
    pad && pad.forEach((p, i) => {
      p.o.detune.linearRampToValueAtTime(intensity * 60 * (i%2 ? 1 : -1), now + 0.5);
    });
  }

  function setMuted(m){
    muted = m;
    if(!ctx) return;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.linearRampToValueAtTime(muted ? 0 : 0.3, ctx.currentTime + 0.25);
  }

  window.PsyAudio = {
    start,
    pluckCluck,
    bigPulse,
    setIntensity,
    setMuted,
    isMuted(){ return muted; },
  };
})();
