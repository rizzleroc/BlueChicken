// The CLUCK STORE. Items unlock as the player progresses. Owned items live
// in the world (rendered behind the chicken) and modify gameplay (warmth,
// energy recovery, happiness, egg-laying rate, etc.).
//
// Currency: CLUCKS. Earned by caring for the pet, laying eggs, playing,
// and just keeping the pet alive over time.
(function(){
  'use strict';

  // Item catalog
  // id, name, glyph (text icon), price, description, unlock(pet) → bool,
  // effects keyed by tag, category, slot (where it appears in the world)
  const CATALOG = [
    // ===== ESSENTIALS — unlocked from the start =====
    { id: 'lamp', name: 'HEAT LAMP', glyph: '☀', price: 5,
      description: 'keeps the egg warm even when you look away.',
      unlock: () => true, category: 'essentials',
      effects: { eggWarmth: +12, ambientBoost: +14 } },

    { id: 'dish', name: 'WATER DISH', glyph: '◡', price: 3,
      description: 'a small bowl of water. cleanliness drains slower.',
      unlock: () => true, category: 'essentials',
      effects: { cleanlinessDecayMult: 0.7 } },

    { id: 'feeder', name: 'AUTO-FEEDER', glyph: '⫯', price: 18,
      description: 'releases a single grain every hour. hunger drains slower.',
      unlock: () => true, category: 'essentials',
      effects: { hungerDecayMult: 0.7 } },

    // ===== COMFORT — needs a little bond =====
    { id: 'bed', name: 'STRAW BED', glyph: '~', price: 12,
      description: 'a soft place to rest. energy recovers faster while sleeping.',
      unlock: (pet) => pet && pet.bond >= 3, category: 'comfort',
      effects: { sleepEnergyMult: 1.6 } },

    { id: 'perch', name: 'WOODEN PERCH', glyph: '⌐', price: 22,
      description: 'a bar to roost on. small sanity recovery while resting.',
      unlock: (pet) => pet && pet.bond >= 10, category: 'comfort',
      effects: { restSanityPerSec: 0.4 } },

    { id: 'dustbath', name: 'DUST BATH', glyph: '⋯', price: 30,
      description: 'a dish of dust. cleanliness barely drains anymore.',
      unlock: (pet) => pet && pet.timesPlayed >= 3, category: 'comfort',
      effects: { cleanlinessDecayMult: 0.4 } },

    // ===== TOYS — needs play history =====
    { id: 'ball', name: 'YARN BALL', glyph: '◯', price: 15,
      description: 'rolls when bumped. happiness drains slower.',
      unlock: (pet) => pet && pet.timesPlayed >= 1, category: 'toys',
      effects: { happinessDecayMult: 0.75 } },

    { id: 'mirror', name: 'TINY MIRROR', glyph: '▢', price: 28,
      description: 'the chicken sees itself. small bond gain over time.',
      unlock: (pet) => pet && pet.bond >= 15, category: 'toys',
      effects: { bondPerMinute: 0.6 } },

    { id: 'worm', name: 'ROBOT WORM', glyph: '〜', price: 35,
      description: 'an animatronic worm. chicken chases it. happiness +.',
      unlock: (pet) => pet && pet.timesPlayed >= 6, category: 'toys',
      effects: { happinessDecayMult: 0.55 } },

    // ===== STRUCTURES — needs eggs / age =====
    { id: 'coop', name: 'CHICKEN COOP', glyph: '⌂', price: 60,
      description: 'a simple shelter. sanity recovers faster at night.',
      unlock: (pet) => pet && pet.eggsLaid >= 1, category: 'structures',
      effects: { nightSanityMult: 2.0 } },

    { id: 'henhouse', name: 'HENHOUSE', glyph: '⌂⌂', price: 110,
      description: 'roomy and warm. eggs are laid more often.',
      unlock: (pet) => pet && pet.eggsLaid >= 3, category: 'structures',
      effects: { eggLayChanceMult: 2.0 } },

    { id: 'fence', name: 'PICKET FENCE', glyph: '⫼', price: 45,
      description: 'a sense of place. small permanent happiness boost.',
      unlock: (pet) => pet && Pet.ageSeconds() > 240, category: 'structures',
      effects: { happinessFloor: 25 } },

    // ===== LATE-GAME ABSURDITY =====
    { id: 'disco', name: 'DISCO BALL', glyph: '◉', price: 200,
      description: 'a small disco ball above the coop. chicken party.',
      unlock: (pet) => pet && pet.bond >= 50, category: 'late',
      effects: { happinessFloor: 60 } },

    { id: 'therapist', name: 'AI THERAPIST', glyph: '⊜', price: 320,
      description: 'a smaller robot that listens. sanity floors at 50.',
      unlock: (pet) => pet && pet.sanity < 30 && pet.timesFed >= 10, category: 'late',
      effects: { sanityFloor: 50 } },
  ];

  function get(id){ return CATALOG.find(it => it.id === id); }

  function ownsItem(pet, id){
    return !!(pet && pet.inventory && pet.inventory.includes(id));
  }

  function canBuy(pet, id){
    const item = get(id);
    if(!item) return false;
    if(ownsItem(pet, id)) return false;
    if(!item.unlock(pet)) return false;
    return (pet.coins || 0) >= item.price;
  }

  function buy(pet, id){
    if(!canBuy(pet, id)) return false;
    const item = get(id);
    pet.coins = (pet.coins || 0) - item.price;
    pet.inventory = pet.inventory || [];
    pet.inventory.push(id);
    if(window.Pet) window.Pet.save();
    return true;
  }

  // Compute aggregated effects across all owned items.
  function effects(pet){
    const eff = {
      eggWarmth: 0,
      ambientBoost: 0,
      hungerDecayMult: 1,
      cleanlinessDecayMult: 1,
      happinessDecayMult: 1,
      sleepEnergyMult: 1,
      restSanityPerSec: 0,
      bondPerMinute: 0,
      nightSanityMult: 1,
      eggLayChanceMult: 1,
      happinessFloor: 0,
      sanityFloor: 0,
    };
    if(!pet || !pet.inventory) return eff;
    for(const id of pet.inventory){
      const it = get(id);
      if(!it || !it.effects) continue;
      for(const k in it.effects){
        if(k.endsWith('Mult')) eff[k] = (eff[k] || 1) * it.effects[k];
        else if(k.endsWith('Floor')) eff[k] = Math.max(eff[k] || 0, it.effects[k]);
        else eff[k] = (eff[k] || 0) + it.effects[k];
      }
    }
    return eff;
  }

  // Earn coins from caring actions / time / eggs.
  function awardCoins(pet, source){
    if(!pet) return 0;
    pet.coins = pet.coins || 0;
    let n = 0;
    switch(source){
      case 'feed':  n = 1; break;
      case 'play':  n = 2; break;
      case 'pet':   n = 1; break;
      case 'clean': n = 1; break;
      case 'meds':  n = 0; break;
      case 'lay':   n = 5; break;
      case 'tick':  n = 1; break;
      case 'hatch': n = 10; break;
    }
    pet.coins += n;
    return n;
  }

  function availableItems(pet){
    return CATALOG.filter(it => it.unlock(pet));
  }

  function categories(){
    return [
      { id: 'essentials', name: 'ESSENTIALS' },
      { id: 'comfort',    name: 'COMFORT'    },
      { id: 'toys',       name: 'TOYS'       },
      { id: 'structures', name: 'STRUCTURES' },
      { id: 'late',       name: 'EXOTIC'     },
    ];
  }

  window.Shop = {
    CATALOG, get, ownsItem, canBuy, buy, effects, awardCoins,
    availableItems, categories,
  };
})();
