// care.js
// -----------------------------------------------------------------------------
// Blue Chicken's care state, distilled from the deployed Cluckbot pet game
// (gh-pages branch). Tracks the 5 Tamagotchi-style needs (hunger, energy,
// happiness, cleanliness, sanity) plus bond. Decays over wall-clock time so
// the chicken keeps living between page loads. Action effects + decay rates
// are ported verbatim from /tmp/chicken-game-snapshot/js/pet.js — proven
// numbers, no need to re-tune.
//
// The fusion contract:
//  - Blue Chicken is character #0, always the first hatchling.
//  - As bond crosses thresholds, world.tryReleasePrize(care.bond) is called.
//    Each prize-animal hatchling is gated on (bond >= X) and unlocked exactly
//    once. Once unlocked, the prize's egg appears in the 3D scene.
//  - Stats are visualized in a Tamagotchi-style HUD panel that surfaces only
//    after Blue is hatched.
//
// localStorage key is "bluechicken/care/v1" (separate from the world snapshot
// so wiping one doesn't wipe the other).

const KEY = "bluechicken/care/v1";

// Decay-per-hour values copy/pasted from the chicken game's pet.js.
const DECAY = {
  hunger: 35,       // gets hungry in ~3h
  energy: 20,       // tired in ~5h
  cleanliness: 18,  // dirty in ~6h
  happiness: 22,    // gets sad in ~4.5h
  // sanity decays only under "need pressure" — handled separately
};

function clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }

// Each prize animal is gated by (bond ≥ X). Order chosen with care: Whisper
// first because "first proof of love" + her brief is dark/anxious which lands
// thematically; cosmic Aurora reserved for the high-bond payoff before the
// secret tenth Solis.
//
// The variant→hatchling mapping is the audit's recommendation modulated by
// the design fanout — care-style hints in the comments are aspirational and
// will become real once the egg-laying loop is in (Phase 2).
export const PRIZE_THRESHOLDS = [
  { bond: 8,  id: "magma",     hint: "fed warm + active" },
  { bond: 18, id: "mossback",  hint: "patient, steady" },
  { bond: 30, id: "pip",       hint: "played with often" },
  { bond: 44, id: "glimmer",   hint: "petted, happiness peaks" },
  { bond: 60, id: "bubble",    hint: "kept clean" },
  { bond: 74, id: "whisper",   hint: "rested through the night" },
  { bond: 86, id: "ember",     hint: "rescued from sickness" },
  { bond: 98, id: "aurora",    hint: "balance across all bars" },
];

export class Care {
  constructor() {
    const loaded = Care._load();
    this.s = loaded || Care._fresh();
    this._listeners = [];
  }

  static _fresh() {
    return {
      v: 1,
      bornAt: Date.now(),
      lastTick: Date.now(),
      hunger: 80,
      energy: 90,
      cleanliness: 100,
      happiness: 75,
      sanity: 100,
      bond: 0,
      isSleeping: false,
      timesFed: 0,
      timesPlayed: 0,
      timesPetted: 0,
      timesCleaned: 0,
      unlocked: {},          // id -> true once a prize is released
    };
  }

  static _load() {
    if (typeof localStorage === "undefined") return null;
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || s.v !== 1) return null;
      return s;
    } catch (_) { return null; }
  }

  _save() {
    if (typeof localStorage === "undefined") return;
    try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch (_) {}
  }

  reset() {
    this.s = Care._fresh();
    this._save();
    this._notify();
  }

  // Per-frame tick (dt in ms). Decays needs proportional to real wall time;
  // sanity only drops when other needs are critically low (matches pet.js).
  tick(dtMs) {
    const now = Date.now();
    // Use wall-clock so offline progress applies on next load; cap to 12h so
    // overnight closures don't kill the chicken outright.
    const elapsedH = Math.min(12, (now - this.s.lastTick) / 3_600_000);
    this.s.lastTick = now;
    if (elapsedH <= 0) return;

    if (this.s.isSleeping) {
      // sleep: energy regen, others decay much slower (0.4x)
      this.s.energy = clamp(this.s.energy + 40 * elapsedH);
      this.s.hunger = clamp(this.s.hunger - DECAY.hunger * 0.4 * elapsedH);
      this.s.cleanliness = clamp(this.s.cleanliness - DECAY.cleanliness * 0.4 * elapsedH);
      this.s.happiness = clamp(this.s.happiness - DECAY.happiness * 0.4 * elapsedH);
    } else {
      this.s.hunger = clamp(this.s.hunger - DECAY.hunger * elapsedH);
      this.s.energy = clamp(this.s.energy - DECAY.energy * elapsedH);
      this.s.cleanliness = clamp(this.s.cleanliness - DECAY.cleanliness * elapsedH);
      this.s.happiness = clamp(this.s.happiness - DECAY.happiness * elapsedH);
    }
    // Sanity tightening: only drops if 2+ other needs are critical (< 25).
    const crits = [this.s.hunger, this.s.energy, this.s.cleanliness, this.s.happiness]
      .filter((n) => n < 25).length;
    if (crits >= 2) this.s.sanity = clamp(this.s.sanity - 15 * elapsedH * (crits - 1));
    else this.s.sanity = clamp(this.s.sanity + 4 * elapsedH); // gentle recovery

    // Bond accumulates passively when wellbeing is good (one-way ratchet).
    const wellbeing = (this.s.hunger + this.s.energy + this.s.happiness + this.s.cleanliness + this.s.sanity) / 500;
    if (wellbeing > 0.6) {
      this.s.bond = clamp(this.s.bond + (wellbeing - 0.6) * 6 * elapsedH);
    }

    this._save();
    this._notify();
  }

  // ----- actions (each returns true if the action fired) ------------------

  feed() {
    if (this.s.isSleeping) return false;
    this.s.hunger = clamp(this.s.hunger + 35);
    this.s.happiness = clamp(this.s.happiness + 5);
    this.s.timesFed++;
    this._touch();
    return true;
  }

  play() {
    if (this.s.isSleeping || this.s.energy < 10) return false;
    this.s.happiness = clamp(this.s.happiness + 20);
    this.s.energy = clamp(this.s.energy - 12);
    this.s.bond = clamp(this.s.bond + 3);
    this.s.timesPlayed++;
    this._touch();
    return true;
  }

  pet() {
    this.s.happiness = clamp(this.s.happiness + 6);
    this.s.bond = clamp(this.s.bond + 2);
    this.s.sanity = clamp(this.s.sanity + 4);
    this.s.timesPetted++;
    this._touch();
    return true;
  }

  clean() {
    this.s.cleanliness = clamp(this.s.cleanliness + 40);
    this.s.happiness = clamp(this.s.happiness + 3);
    this.s.timesCleaned++;
    this._touch();
    return true;
  }

  sleep(toggle) {
    this.s.isSleeping = toggle === undefined ? !this.s.isSleeping : !!toggle;
    this._touch();
    return true;
  }

  // Status one-liner, mirroring pet.js's cascading vibe ladder.
  vibe() {
    const s = this.s;
    if (s.isSleeping) return "Blue is sleeping. zzz.";
    if (s.sanity < 20) return "Blue is losing it. urgent.";
    if (s.hunger < 25) return "Blue is starving.";
    if (s.cleanliness < 25) return "Blue is filthy.";
    if (s.energy < 20) return "Blue is exhausted.";
    if (s.happiness < 25) return "Blue is sad.";
    if (s.happiness > 80 && s.hunger > 60) return "Blue is thriving.";
    if (s.bond > 50) return "Blue loves you.";
    return "Blue is fine.";
  }

  // Which prize hatchlings are newly unlocked since last call (bond-based).
  newlyUnlocked() {
    const out = [];
    for (const t of PRIZE_THRESHOLDS) {
      if (this.s.bond >= t.bond && !this.s.unlocked[t.id]) {
        this.s.unlocked[t.id] = true;
        out.push(t);
      }
    }
    if (out.length) { this._save(); this._notify(); }
    return out;
  }

  // ----- listener glue ----------------------------------------------------

  onChange(fn) { this._listeners.push(fn); }
  _notify() { for (const fn of this._listeners) try { fn(this.s); } catch (_) {} }
  _touch() { this._save(); this._notify(); }
}
