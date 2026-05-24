// CLUCKBOT — a persistent robot-chicken Tamagotchi.
// Real-time stats that decay even when the tab is closed.
// All state is persisted to localStorage so the pet keeps living between visits.
(function(){
  'use strict';

  const STORAGE_KEY = 'cluckbot.v1';

  // Time scale: 1 in-game day = 30 real minutes by default.
  // Stats decay proportional to real time elapsed since last tick.
  // Tuned so a typical session has meaningful change without forcing constant action.
  const DECAY_PER_HOUR = {
    hunger:    35,    // gets hungry in ~3h
    energy:    20,    // tired in ~5h
    cleanliness: 18,  // dirty in ~6h
    happiness: 22,    // gets sad in ~4.5h
    sanity:    0,     // sanity only drops if OTHER needs are unmet
  };

  // Lifecycle: ages over real time
  // Egg 0-30s, Chick 30s-3min, Teen 3-10min, Adult 10min-2h, Elder 2h+
  // (compressed so users see lifecycle in one session)
  const LIFE_STAGES = [
    { name: 'egg',   tMin: 0,        max:    30 },
    { name: 'chick', tMin: 30,       max:   180 },
    { name: 'teen',  tMin: 180,      max:   600 },
    { name: 'adult', tMin: 600,      max:  7200 },
    { name: 'elder', tMin: 7200,     max: Infinity },
  ];

  // Default new-pet state — starts as an EGG
  function freshPet(name){
    return {
      name: name || 'EGG',
      bornAt: Date.now(),
      hatchedAt: null,
      lastTick: Date.now(),
      hunger: 80,
      energy: 90,
      cleanliness: 100,
      happiness: 75,
      sanity: 100,
      bond: 0,
      isSleeping: false,
      isDead: false,
      causeOfDeath: null,
      poops: 0,
      eggsLaid: 0,
      timesFed: 0,
      timesPlayed: 0,
      version: 2,
      // egg phase
      egg: window.Egg ? window.Egg.fresh() : null,
      variant: null,         // assigned at hatch
      variantName: null,
      variantTagline: null,
    };
  }

  let pet = null;

  function load(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return null;
      const parsed = JSON.parse(raw);
      if(!parsed || !parsed.name) return null;
      return parsed;
    } catch(e){ return null; }
  }

  function save(){
    if(!pet) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pet)); } catch(e){}
  }

  // Apply decay for elapsed real time since lastTick.
  // Called on load (to catch up offline time) and on every frame (small deltas).
  function tickElapsed(now){
    if(!pet || pet.isDead) return;
    const dt = Math.max(0, (now - pet.lastTick) / 1000);    // seconds
    pet.lastTick = now;
    if(dt < 0.01) return;

    // ----- EGG PHASE -----
    if(pet.egg){
      // ambient is colder at night
      const tod = window.World ? window.World.timeOfDay() : 0.5;
      const isNight = tod < 0.22 || tod > 0.82;
      const ambient = isNight ? 20 : 30;
      window.Egg && window.Egg.tick(pet.egg, dt, ambient);

      if(pet.egg.hatchProgress >= 100){
        hatch();
      }
      // egg phase doesn't decay other stats
      return;
    }

    const hours = dt / 3600;
    // sleeping recovers energy + slower decay
    const sleepMult = pet.isSleeping ? 0.4 : 1.0;
    pet.hunger      = clamp(pet.hunger      - DECAY_PER_HOUR.hunger * hours * sleepMult);
    pet.cleanliness = clamp(pet.cleanliness - DECAY_PER_HOUR.cleanliness * hours);
    pet.happiness   = clamp(pet.happiness   - DECAY_PER_HOUR.happiness * hours * sleepMult);
    if(pet.isSleeping){
      pet.energy = clamp(pet.energy + 40 * hours);
    } else {
      pet.energy = clamp(pet.energy - DECAY_PER_HOUR.energy * hours);
    }

    // sanity decays IF needs are unmet
    const needPressure = (
      Math.max(0, 40 - pet.hunger) +
      Math.max(0, 40 - pet.energy) +
      Math.max(0, 40 - pet.cleanliness) +
      Math.max(0, 40 - pet.happiness)
    ) / 40;       // 0..4-ish
    if(needPressure > 0.05){
      pet.sanity = clamp(pet.sanity - needPressure * 6 * hours);
    } else {
      // recover sanity slowly when content
      pet.sanity = clamp(pet.sanity + 4 * hours);
    }

    // chance of pooping each in-game hour
    if(!pet.isSleeping && Math.random() < hours * 0.6){
      pet.poops = Math.min(5, pet.poops + 1);
      pet.cleanliness = clamp(pet.cleanliness - 8);
    }

    // chance of laying an egg if happy
    if(!pet.isSleeping && pet.happiness > 70 && pet.hunger > 50 && Math.random() < hours * 0.4){
      pet.eggsLaid++;
      pet.onLayEgg = true;     // transient flag for UI
    }

    // death conditions: starvation or insanity below 0 for too long
    if(pet.hunger <= 0 || pet.sanity <= 0){
      pet.isDead = true;
      pet.causeOfDeath = pet.hunger <= 0 ? 'starvation' : 'irreversible psychosis';
      pet.deathAt = now;
    }
  }

  function clamp(v){ return Math.max(0, Math.min(100, v)); }

  // ---- HATCH ----
  function hatch(){
    if(!pet || !pet.egg) return;
    const variant = window.Egg.variantFor(pet.egg);
    pet.variant = variant.id;
    pet.variantName = variant.name;
    pet.variantTagline = variant.tagline;
    pet.hatchedAt = Date.now();
    pet.onHatch = true;       // transient flag for UI
    pet.egg = null;
    // tiny variant-driven stat bumps
    pet.sanity = clamp(100 + variant.sanityBoost);
    save();
  }

  function ageSeconds(){
    if(!pet) return 0;
    return Math.floor((Date.now() - pet.bornAt) / 1000);
  }

  function stage(){
    const a = ageSeconds();
    for(const s of LIFE_STAGES){
      if(a >= s.tMin && a < s.max) return s.name;
    }
    return 'elder';
  }

  // a single descriptive line based on current state
  function vibe(){
    if(!pet) return '';
    if(pet.isDead) return `${pet.name} is no more (${pet.causeOfDeath}).`;
    if(pet.isSleeping) return `${pet.name} is sleeping. zzz.`;
    if(pet.sanity < 20) return `${pet.name} is losing it. urgent.`;
    if(pet.hunger < 25) return `${pet.name} is starving.`;
    if(pet.cleanliness < 25) return `${pet.name} is filthy.`;
    if(pet.energy < 20) return `${pet.name} is exhausted.`;
    if(pet.happiness < 25) return `${pet.name} is sad.`;
    if(pet.poops >= 3) return `${pet.name} is surrounded by poop.`;
    if(pet.happiness > 80 && pet.hunger > 60) return `${pet.name} is thriving.`;
    if(pet.bond > 50) return `${pet.name} loves you.`;
    return `${pet.name} is fine.`;
  }

  // ----- actions ---------------------------------------------------------
  function feed(){
    if(!pet || pet.isDead || pet.isSleeping) return false;
    pet.hunger = clamp(pet.hunger + 35);
    pet.happiness = clamp(pet.happiness + 5);
    pet.timesFed++;
    pet.onFeed = true;
    save();
    return true;
  }
  function play(){
    if(!pet || pet.isDead || pet.isSleeping || pet.energy < 10) return false;
    pet.happiness = clamp(pet.happiness + 20);
    pet.energy = clamp(pet.energy - 12);
    pet.bond = clamp(pet.bond + 3);
    pet.timesPlayed++;
    pet.onPlay = true;
    save();
    return true;
  }
  function pet_(){
    if(!pet || pet.isDead) return false;
    pet.happiness = clamp(pet.happiness + 6);
    pet.bond = clamp(pet.bond + 2);
    pet.sanity = clamp(pet.sanity + 4);
    pet.onPet = true;
    save();
    return true;
  }
  function clean(){
    if(!pet || pet.isDead) return false;
    pet.poops = 0;
    pet.cleanliness = clamp(pet.cleanliness + 40);
    pet.happiness = clamp(pet.happiness + 3);
    save();
    return true;
  }
  function sleep(toggle){
    if(!pet || pet.isDead) return false;
    pet.isSleeping = toggle === undefined ? !pet.isSleeping : !!toggle;
    save();
    return true;
  }
  function medicate(){
    if(!pet || pet.isDead) return false;
    pet.sanity = clamp(pet.sanity + 40);
    pet.energy = clamp(pet.energy - 5);
    pet.onMeds = true;
    save();
    return true;
  }
  function reset(name){
    pet = freshPet(name);
    save();
    return pet;
  }

  // ----- init -----------------------------------------------------------
  function init(name){
    pet = load();
    if(!pet){
      pet = freshPet(name);
      save();
    } else {
      // catch up on offline decay
      tickElapsed(Date.now());
      save();
    }
    return pet;
  }

  // periodic save every ~10s while tab is open
  setInterval(() => save(), 10000);
  document.addEventListener('visibilitychange', () => {
    if(document.hidden) save();
    else if(pet) { pet.lastTick = Date.now(); tickElapsed(Date.now()); }
  });

  // ---- EGG ACTIONS ----
  function eggAction(name){
    if(!pet || !pet.egg) return false;
    const a = window.Egg && window.Egg.actions[name];
    if(!a) return false;
    a(pet.egg);
    save();
    return true;
  }
  function forceHatch(){
    if(!pet || !pet.egg) return false;
    pet.egg.hatchProgress = 100;
    hatch();
    return true;
  }
  function isEgg(){ return !!(pet && pet.egg); }

  function eggVibe(){
    if(!pet || !pet.egg) return '';
    const e = pet.egg;
    if(e.warmth < 25) return `the egg is freezing.`;
    if(e.warmth > 92) return `the egg is overheating.`;
    if(e.warmth > 85) return `the egg is very hot.`;
    if(e.hatchProgress > 90) return `something is moving inside the egg.`;
    if(e.hatchProgress > 60) return `the egg trembles.`;
    if(e.hatchProgress > 30) return `the egg is warming up nicely.`;
    if(e.warmth < 40) return `the egg is cold.`;
    return `the egg waits.`;
  }

  window.Pet = {
    init,
    get(){ return pet; },
    save,
    tick: tickElapsed,
    feed, play, clean, sleep, medicate, pet: pet_,
    reset, stage, vibe, ageSeconds,
    isEgg, eggAction, forceHatch, eggVibe,
    clearTransients(){
      if(!pet) return;
      pet.onFeed = pet.onPlay = pet.onPet = pet.onMeds = pet.onLayEgg = pet.onHatch = false;
    },
  };
})();
