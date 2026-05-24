// The chicken's BRAIN: autonomous behavior. The chicken decides what to do
// based on its needs and the world around it. It walks, pecks, looks at
// things, sits down, sleeps, lays eggs spontaneously.
//
// This is a behavior tree disguised as a state machine. It runs entirely
// from Pet state. Output is consumed by ChickenPet's renderer (position,
// pose, facing).
(function(){
  'use strict';

  // World position: normalized 0..1 across the ground strip.
  // (Renderer maps to the floor zone of the canvas.)
  const brain = {
    x: 0.5,          // current position
    targetX: 0.5,    // where the chicken wants to be
    facing: 1,       // 1 = right, -1 = left
    pose: 'idle',    // 'idle' | 'walking' | 'pecking' | 'looking' | 'sleeping' | 'sitting'
    poseUntil: 0,    // time when current pose expires
    nextDecisionAt: 0,
    lastPoopAt: 0,
    speed: 0.0007,   // normalized units per ms
    walkPhase: 0,
    head: { tilt: 0, lookX: 0, lookY: 0 },
    thoughtAt: 0,
    thought: '',
    thoughtUntil: 0,
  };

  // Decide next behavior every ~3-7 seconds (or sooner if pose ends).
  function tick(t, pet){
    if(!pet || pet.egg || pet.isDead){
      brain.pose = pet && pet.isDead ? 'dead' : 'idle';
      return;
    }

    // sleeping override
    if(pet.isSleeping){
      brain.pose = 'sleeping';
      brain.targetX = brain.x;
      return;
    }

    // walking toward target
    if(brain.pose === 'walking'){
      const d = brain.targetX - brain.x;
      const ad = Math.abs(d);
      if(ad < 0.01){
        brain.pose = 'idle';
        brain.poseUntil = t + 600 + Math.random() * 600;
      } else {
        const dt = brain._lastT ? (t - brain._lastT) : 16;
        const step = brain.speed * dt;
        brain.x += Math.sign(d) * Math.min(ad, step);
        brain.facing = d > 0 ? 1 : -1;
        brain.walkPhase += dt * 0.008;
      }
    }

    brain._lastT = t;

    // expire pose → decide next
    if(t < brain.nextDecisionAt && brain.pose !== 'idle') return;
    if(brain.pose === 'idle' && t < brain.poseUntil) return;

    decideNext(t, pet);
  }

  function decideNext(t, pet){
    // pick an intent weighted by current needs
    const w = {
      wander: 3.5,
      peck: pet.hunger < 50 ? 3 : 1.5,
      look: 1.2,
      sit: pet.energy < 35 ? 2 : 0.3,
      preen: 0.8,
      celebrate: pet.happiness > 75 ? 1 : 0.2,
    };
    if(window.World){
      const tod = window.World.timeOfDay();
      if(tod < 0.18 || tod > 0.85) w.sit *= 2.5;        // night → sit more
    }
    const total = Object.values(w).reduce((a,b) => a + b, 0);
    let pick = Math.random() * total;
    let chosen = 'wander';
    for(const k in w){
      pick -= w[k];
      if(pick <= 0){ chosen = k; break; }
    }

    if(chosen === 'wander'){
      brain.targetX = 0.18 + Math.random() * 0.64;
      brain.pose = 'walking';
      brain.nextDecisionAt = t + 6000;
    } else if(chosen === 'peck'){
      brain.pose = 'pecking';
      brain.poseUntil = t + 900 + Math.random() * 600;
      brain.nextDecisionAt = brain.poseUntil + 200;
    } else if(chosen === 'look'){
      brain.pose = 'looking';
      brain.facing = Math.random() > 0.5 ? 1 : -1;
      brain.poseUntil = t + 1400 + Math.random() * 1200;
      brain.nextDecisionAt = brain.poseUntil + 200;
    } else if(chosen === 'sit'){
      brain.pose = 'sitting';
      brain.poseUntil = t + 3000 + Math.random() * 4000;
      brain.nextDecisionAt = brain.poseUntil + 200;
    } else if(chosen === 'preen'){
      brain.pose = 'preening';
      brain.poseUntil = t + 1600;
      brain.nextDecisionAt = brain.poseUntil + 200;
    } else if(chosen === 'celebrate'){
      brain.pose = 'celebrating';
      brain.poseUntil = t + 1200;
      brain.nextDecisionAt = brain.poseUntil + 200;
    }
  }

  function think(text, ms){
    brain.thought = text;
    brain.thoughtUntil = performance.now() + (ms || 5000);
  }

  function clearThought(){
    brain.thought = '';
    brain.thoughtUntil = 0;
  }

  window.Brain = {
    tick,
    think,
    clearThought,
    state(){ return brain; },
    // for the renderer
    x(){ return brain.x; },
    facing(){ return brain.facing; },
    pose(){ return brain.pose; },
    walkPhase(){ return brain.walkPhase; },
    thought(){ return performance.now() < brain.thoughtUntil ? brain.thought : ''; },
  };
})();
