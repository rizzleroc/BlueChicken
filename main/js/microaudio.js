// Micro-audio: tiny life-cues that thicken the anthropomorphic feel.
// All cues are gated by recency (silence if we made noise <500ms ago) and
// kept under -18dB so they layer with the ambient drone without clashing.
(function(){
  'use strict';

  let ctx = null;
  let bus = null;
  let muted = true;
  let lastCueAt = 0;

  function ensure(){
    if(ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;
    // share with PsyAudio if it's already started; otherwise lazy-create
    if(window.PsyAudio && window.PsyAudio._sharedCtx){
      ctx = window.PsyAudio._sharedCtx;
    } else {
      ctx = new AC();
    }
    bus = ctx.createGain();
    bus.gain.value = muted ? 0 : 0.18;          // intentionally quiet
    bus.connect(ctx.destination);
  }

  function setMuted(m){
    muted = m;
    if(bus) bus.gain.linearRampToValueAtTime(muted ? 0 : 0.18, ctx.currentTime + 0.15);
  }

  // gate against rapid-fire cues so they feel like restraint, not chatter
  function gate(now){
    if(now - lastCueAt < 500) return false;
    lastCueAt = now;
    return true;
  }

  // soft "tk" — pluck at a high frequency, very short
  function blinkTick(){
    ensure();
    if(!ctx || muted || !gate(performance.now())) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(2400, now);
    o.frequency.exponentialRampToValueAtTime(900, now + 0.02);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.06, now + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    o.connect(g).connect(bus);
    o.start(now);
    o.stop(now + 0.06);
  }

  // descending two-note trill — recognition / eye-contact response
  function recogTrill(){
    ensure();
    if(!ctx || muted || !gate(performance.now())) return;
    const now = ctx.currentTime;
    [880, 660].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, now + i*0.07);
      g.gain.linearRampToValueAtTime(0.04, now + i*0.07 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i*0.07 + 0.12);
      o.connect(g).connect(bus);
      o.start(now + i*0.07);
      o.stop(now + i*0.07 + 0.15);
    });
  }

  // soft filtered noise — exhale / sigh
  function breath(){
    ensure();
    if(!ctx || muted || !gate(performance.now())) return;
    const now = ctx.currentTime;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for(let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i/d.length);
    const n = ctx.createBufferSource();
    n.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.08;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1400, now);
    f.frequency.exponentialRampToValueAtTime(400, now + 0.25);
    n.connect(f).connect(g).connect(bus);
    n.start(now);
  }

  // bent down chirp — interrupted thought / aborted-step
  function unsure(){
    ensure();
    if(!ctx || muted || !gate(performance.now())) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(660, now);
    o.frequency.exponentialRampToValueAtTime(220, now + 0.18);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.05, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    o.connect(g).connect(bus);
    o.start(now);
    o.stop(now + 0.25);
  }

  // tiny click for weight-shift
  function step(){
    ensure();
    if(!ctx || muted || !gate(performance.now())) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = 180;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.045, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    o.connect(g).connect(bus);
    o.start(now);
    o.stop(now + 0.05);
  }

  window.MicroAudio = {
    init: ensure, setMuted, blinkTick, recogTrill, breath, unsure, step,
    isMuted(){ return muted; },
  };
})();
