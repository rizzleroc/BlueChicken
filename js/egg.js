// The EGG phase. Before you have a chicken, you have an egg you must hatch.
// The way you treat the egg determines the variant of chicken that emerges.
//
// Variants are mystery boxes — the player only sees the trait sliders, never
// the variant table. Discovery is the fun.
(function(){
  'use strict';

  // Variants — color, vibe, and a one-liner.
  // Each variant is matched against the care profile below.
  const VARIANTS = [
    { id: 'cosmic',  name: 'COSMIC',  colors: ['#ff7fd6', '#7fe9ff', '#c890ff'],
      tagline: 'born from perfect balance.',
      sanityBoost: 20, hungerDecayMod: 0.7, energyDecayMod: 0.7 },
    { id: 'solar',   name: 'SOLAR',   colors: ['#ffd57f', '#ff7f5d', '#ffae00'],
      tagline: 'born from a hot, hot egg.',
      sanityBoost: 5,  hungerDecayMod: 1.3, energyDecayMod: 0.8 },
    { id: 'lunar',   name: 'LUNAR',   colors: ['#7fbfff', '#c8d0ff', '#5a548c'],
      tagline: 'born from quiet darkness.',
      sanityBoost: 10, hungerDecayMod: 0.9, energyDecayMod: 0.6 },
    { id: 'hyper',   name: 'HYPER',   colors: ['#ff3c5c', '#ffcd3c', '#fff'],
      tagline: 'born from too much love.',
      sanityBoost: -10, hungerDecayMod: 1.4, energyDecayMod: 1.6 },
    { id: 'feral',   name: 'FERAL',   colors: ['#6b6b78', '#3a3458', '#1a0f24'],
      tagline: 'born from neglect.',
      sanityBoost: -20, hungerDecayMod: 0.8, energyDecayMod: 1.0 },
    { id: 'glitch',  name: 'GLITCH',  colors: ['#00ffaa', '#ff00aa', '#aaff00'],
      tagline: 'born from chaos.',
      sanityBoost: 0,  hungerDecayMod: 1.0, energyDecayMod: 1.0 },
    { id: 'mossy',   name: 'MOSSY',   colors: ['#7cff9a', '#2c5f3a', '#a8e6b2'],
      tagline: 'born from steady patience.',
      sanityBoost: 15, hungerDecayMod: 0.8, energyDecayMod: 0.8 },
    { id: 'ghost',   name: 'GHOST',   colors: ['#ffffff', '#e8e8ff', '#9f9fb8'],
      tagline: 'born from absence.',
      sanityBoost: 0,  hungerDecayMod: 0.5, energyDecayMod: 0.5 },
  ];

  // Initial egg state included in pet.
  function freshEgg(){
    return {
      isEgg: true,
      eggLaidAt: Date.now(),
      warmth: 72,          // 0..100 — starts warm so you have a window
      turns: 0,            // total times turned
      lastTurnAt: 0,
      taps: 0,             // pokes / disturbances
      attention: 0,        // total caretaker actions
      coldSeconds: 0,      // accumulated seconds below warmth=35
      hotSeconds: 0,       // accumulated seconds above warmth=85
      hatchProgress: 0,    // 0..100
      // egg hatches at hatchProgress >= 100, requires warmth in [40,90] sustained
    };
  }

  // Care profile → variant. Pure function of the egg's lifetime stats.
  function variantFromEgg(egg){
    const turns = egg.turns;
    const warmth = egg.warmth;
    const taps = egg.taps;
    const att = egg.attention;
    const cold = egg.coldSeconds;
    const hot = egg.hotSeconds;

    // Decision tree — designed to be discoverable through play.
    if(att < 8 && cold > 60) return VARIANTS.find(v => v.id === 'feral');
    if(att < 3) return VARIANTS.find(v => v.id === 'ghost');
    if(taps > 60 || att > 80) return VARIANTS.find(v => v.id === 'hyper');
    if(hot > 90) return VARIANTS.find(v => v.id === 'solar');
    if(cold > 90) return VARIANTS.find(v => v.id === 'lunar');
    if(turns < 4 && taps < 10 && att > 8) return VARIANTS.find(v => v.id === 'mossy');
    if(warmth >= 55 && warmth <= 80 && turns >= 6 && turns <= 20 && att >= 12 && att <= 40) {
      return VARIANTS.find(v => v.id === 'cosmic');
    }
    return VARIANTS.find(v => v.id === 'glitch');
  }

  // Per-tick update of egg metrics (called from main loop).
  // dt is seconds since last tick. ambient is the resting target temperature
  // — bumped by heat-lamp items.
  function tickEgg(egg, dt, ambient){
    if(!egg) return;
    // warmth drifts toward ambient. slow drift so manual care is meaningful
    // but offline pauses still affect it.
    const target = ambient ?? 42;
    egg.warmth += (target - egg.warmth) * Math.min(1, dt * 0.02);
    // accumulate cold/hot exposure
    if(egg.warmth < 35) egg.coldSeconds += dt;
    if(egg.warmth > 85) egg.hotSeconds += dt;
    // hatch progress requires warmth in sweet spot
    const inSweet = egg.warmth > 40 && egg.warmth < 90;
    if(inSweet){
      egg.hatchProgress = Math.min(100, egg.hatchProgress + dt * 0.9);
    } else {
      egg.hatchProgress = Math.max(0, egg.hatchProgress - dt * 0.3);
    }
  }

  // Actions performed on the egg.
  const actions = {
    warm(egg, amount){
      if(!egg) return;
      egg.warmth = Math.min(100, egg.warmth + (amount ?? 22));
      egg.attention++;
    },
    cool(egg, amount){
      if(!egg) return;
      egg.warmth = Math.max(0, egg.warmth - (amount ?? 14));
      egg.attention++;
    },
    turn(egg){
      if(!egg) return;
      egg.turns++;
      egg.attention++;
      egg.lastTurnAt = Date.now();
    },
    tap(egg){
      if(!egg) return;
      egg.taps++;
      egg.attention++;
    },
  };

  window.Egg = {
    fresh: freshEgg,
    tick: tickEgg,
    variantFor: variantFromEgg,
    actions,
    VARIANTS,
  };
})();
