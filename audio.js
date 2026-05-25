// audio.js
// -----------------------------------------------------------------------------
// Procedural Web Audio. Every sound here is synthesized in-browser — no audio
// files to ship. A handful of small oscillator + noise + envelope helpers
// compose into per-event cues. Game code calls audio.hatch(), audio.ufoSwoop(),
// etc.; main3d.js wires the few touch points.
//
// AudioContext can't start until a user gesture. We auto-init on the very
// first pointerdown / keydown anywhere so an event firing before the user
// has explicitly clicked "Begin" or the audio toggle still gets sound. The
// engine still starts muted; toggling the HUD button unmutes.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = true;  // start muted; user opts in
    this.started = false;
    this.ambientNodes = null;
    // Capture-phase one-shot listeners so any user gesture brings up the
    // context, not just the welcome-screen button. Once started, removed.
    if (typeof document !== "undefined") {
      const arm = () => {
        this.init();
        document.removeEventListener("pointerdown", arm, true);
        document.removeEventListener("keydown", arm, true);
        document.removeEventListener("touchstart", arm, true);
      };
      document.addEventListener("pointerdown", arm, true);
      document.addEventListener("keydown", arm, true);
      document.addEventListener("touchstart", arm, true);
    }
  }

  // Idempotent — safe to call from any gesture handler.
  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.45;
    this.master.connect(this.ctx.destination);
    this.started = true;
    this._startAmbient();
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.linearRampToValueAtTime(muted ? 0 : 0.45, t + 0.25);
  }

  // ---- low-level helpers --------------------------------------------------

  _now() { return this.ctx.currentTime; }

  // ADSR-enveloped oscillator burst. `freqEnv` can be a number (constant) or
  // [from, to] (linear ramp from->to over the duration).
  _blip({ type = "sine", freqEnv = 440, vol = 0.2, dur = 0.3, attack = 0.01, release = null, detune = 0 }) {
    if (!this.started) return;
    const t = this._now();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.detune.value = detune;
    if (Array.isArray(freqEnv)) {
      osc.frequency.setValueAtTime(freqEnv[0], t);
      osc.frequency.linearRampToValueAtTime(freqEnv[1], t + dur);
    } else {
      osc.frequency.setValueAtTime(freqEnv, t);
    }
    const rel = release == null ? dur * 0.6 : release;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol * 0.001), t + attack + rel);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // Filtered white noise burst — for wind, rain, whooshes.
  _noiseBurst({ vol = 0.18, dur = 0.5, attack = 0.02, release = null, filter = 1200, filterEnv = null, q = 1 }) {
    if (!this.started) return;
    const t = this._now();
    const bufferSize = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const biquad = this.ctx.createBiquadFilter();
    biquad.type = "bandpass";
    biquad.Q.value = q;
    if (filterEnv) {
      biquad.frequency.setValueAtTime(filterEnv[0], t);
      biquad.frequency.linearRampToValueAtTime(filterEnv[1], t + dur);
    } else {
      biquad.frequency.value = filter;
    }
    const gain = this.ctx.createGain();
    const rel = release == null ? dur * 0.6 : release;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + rel);
    src.connect(biquad).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  _chord(freqs, opts = {}) {
    for (const f of freqs) this._blip(Object.assign({ freqEnv: f, vol: 0.08, dur: opts.dur || 0.9, attack: 0.03, release: 0.7 }, opts));
  }

  // ---- ambient ------------------------------------------------------------

  // A very soft two-tone drone that breathes underneath everything. Cheap.
  _startAmbient() {
    if (this.ambientNodes) return;
    const t = this._now();
    const a = this.ctx.createOscillator();
    const b = this.ctx.createOscillator();
    a.type = "sine"; b.type = "sine";
    a.frequency.value = 65;
    b.frequency.value = 98;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 6;
    lfo.connect(lfoGain).connect(b.frequency);
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    a.connect(g); b.connect(g);
    g.connect(this.master);
    a.start(t); b.start(t); lfo.start(t);
    this.ambientNodes = { a, b, lfo, g };
  }

  // ---- event cues ---------------------------------------------------------

  tap()         { this._blip({ type: "triangle", freqEnv: [880, 660], vol: 0.12, dur: 0.12, attack: 0.005, release: 0.08 }); }
  hatch()       {
    // Triumphant little major arpeggio.
    [0, 0.06, 0.12, 0.22].forEach((d, i) => setTimeout(() => {
      const notes = [392, 494, 587, 784][i]; // G4 B4 D5 G5
      this._blip({ type: "triangle", freqEnv: notes, vol: 0.18, dur: 0.45, attack: 0.01, release: 0.4 });
    }, d * 1000));
  }
  pet()         { this._blip({ type: "sine", freqEnv: [600, 900], vol: 0.10, dur: 0.18, attack: 0.005, release: 0.14 }); }
  pop()         { this._blip({ type: "sine", freqEnv: [1200, 200], vol: 0.18, dur: 0.18, attack: 0.001, release: 0.12 }); }
  toast()       { this._blip({ type: "sine", freqEnv: 1080, vol: 0.06, dur: 0.18, attack: 0.005, release: 0.14 }); }

  // Character specials
  constellation() {
    const notes = [523, 659, 784, 988, 1175]; // C5 E5 G5 B5 D6
    notes.forEach((f, i) => setTimeout(() =>
      this._blip({ type: "sine", freqEnv: f, vol: 0.08, dur: 0.7, attack: 0.02, release: 0.6 }),
      i * 90
    ));
  }
  rainbow() {
    // Sparkly upward sweep, then sustain.
    this._blip({ type: "triangle", freqEnv: [220, 1760], vol: 0.10, dur: 0.7, attack: 0.02, release: 0.5 });
    setTimeout(() => this._chord([523, 659, 784, 988], { vol: 0.06, dur: 1.4, release: 1.2 }), 250);
  }
  pipRain() {
    for (let i = 0; i < 14; i++) setTimeout(() =>
      this._blip({ type: "sine", freqEnv: 1500 + Math.random() * 800, vol: 0.05, dur: 0.08, attack: 0.001, release: 0.06 }),
      i * 100
    );
  }
  memoryBubble() {
    this._blip({ type: "sine", freqEnv: [440, 660], vol: 0.10, dur: 0.5, attack: 0.05, release: 0.4 });
  }
  rebirth() {
    this._noiseBurst({ vol: 0.14, dur: 0.8, attack: 0.02, release: 0.7, filterEnv: [400, 3200], q: 0.8 });
    setTimeout(() => this._chord([330, 415, 494], { vol: 0.10, dur: 1.0, release: 0.9 }), 200);
  }
  dash() {
    this._noiseBurst({ vol: 0.10, dur: 0.5, attack: 0.005, release: 0.4, filterEnv: [800, 3000], q: 0.6 });
  }

  // World events
  ufoSwoop() {
    // Two-stage descend: rising shimmer + descending whine.
    this._blip({ type: "sawtooth", freqEnv: [120, 660], vol: 0.08, dur: 3.0, attack: 0.4, release: 2.6, detune: 7 });
    this._blip({ type: "sawtooth", freqEnv: [125, 655], vol: 0.08, dur: 3.0, attack: 0.4, release: 2.6, detune: -7 });
    setTimeout(() =>
      this._blip({ type: "sine", freqEnv: [1320, 220], vol: 0.10, dur: 1.6, attack: 0.05, release: 1.4 }),
      2200
    );
  }
  firstContact() {
    // Mysterious 5-tone arrival.
    const notes = [440, 554, 659, 740, 880];
    notes.forEach((f, i) => setTimeout(() =>
      this._blip({ type: "sine", freqEnv: f, vol: 0.10, dur: 0.6, attack: 0.05, release: 0.5 }),
      i * 180
    ));
  }
  wolf() {
    // Low growl: detuned saw with slow filter sweep.
    this._noiseBurst({ vol: 0.10, dur: 1.4, attack: 0.06, release: 1.2, filterEnv: [120, 240], q: 4 });
    this._blip({ type: "sawtooth", freqEnv: [90, 75], vol: 0.10, dur: 1.4, attack: 0.06, release: 1.2 });
  }
  freeze() {
    // Cold airy whoosh.
    this._noiseBurst({ vol: 0.16, dur: 2.4, attack: 0.6, release: 1.8, filterEnv: [600, 4000], q: 1 });
  }
  snowfall() {
    // High shimmer pad.
    this._chord([1175, 1568, 2093], { vol: 0.04, dur: 3.5, release: 3.0 });
  }
  igloo() {
    this._blip({ type: "triangle", freqEnv: [220, 330], vol: 0.10, dur: 0.7, attack: 0.04, release: 0.6 });
  }
  polarBear() {
    this._blip({ type: "sawtooth", freqEnv: [60, 80], vol: 0.12, dur: 1.6, attack: 0.08, release: 1.4 });
    this._noiseBurst({ vol: 0.08, dur: 1.6, attack: 0.08, release: 1.4, filterEnv: [180, 320], q: 2 });
  }
  thaw() {
    this._blip({ type: "sine", freqEnv: [220, 660], vol: 0.08, dur: 2.2, attack: 0.4, release: 1.8 });
  }
  auroraBorealis() {
    // Wide ethereal pad.
    [261, 329, 392, 494, 587, 659].forEach((f, i) => setTimeout(() =>
      this._blip({ type: "sine", freqEnv: f, vol: 0.06, dur: 4.0, attack: 0.6, release: 3.0 }),
      i * 220
    ));
  }
  meteor() {
    // Quick high descent.
    this._blip({ type: "sawtooth", freqEnv: [2200, 220], vol: 0.10, dur: 0.7, attack: 0.005, release: 0.6 });
    this._noiseBurst({ vol: 0.06, dur: 0.7, attack: 0.005, release: 0.6, filterEnv: [2000, 200], q: 1 });
  }
  eclipse() {
    this._blip({ type: "sine", freqEnv: 55, vol: 0.14, dur: 4.0, attack: 1.2, release: 2.6 });
    this._blip({ type: "sine", freqEnv: 110, vol: 0.10, dur: 4.0, attack: 1.2, release: 2.6, detune: 12 });
  }
  reveal() {
    // Used when the hatch-reveal modal pops.
    this._chord([392, 494, 587], { vol: 0.08, dur: 1.4, release: 1.1 });
  }
}

export const audio = new AudioEngine();
