// Story & dreams. Triggers one-line italicized monologues at specific
// milestones, gives each variant an origin paragraph for the hatch
// ceremony, and tracks "dream flags" to ensure each beat fires once.
(function(){
  'use strict';

  // Origin paragraphs for the hatch ceremony, replacing the one-liners.
  const ORIGINS = {
    cosmic: 'you raised it through every weather. when it cracked open, it was already wearing the sky.',
    solar:  'you loved it like a fire. the shell came off black. now it carries the sun.',
    lunar:  'you let it cool. it learned the dark first. it will always prefer the moon.',
    hyper:  'you touched it too much. it hatched already running.',
    feral:  'you forgot it once. it remembers.',
    glitch: 'you did everything and nothing. the shell broke twice.',
    mossy:  'you were slow with it. it learned slow back.',
    ghost:  'you weren’t there. neither, mostly, is it.',
    ancestral: 'this one came from the mountain. you don’t know what it has seen.',
    haunted: 'the static left it behind. it remembers being taken.',
  };

  // Dream events. Each is { id, when(pet), text(pet), once: true }.
  // 'when' is evaluated every UI tick; first true → fire, mark seen, never again.
  const DREAMS = [
    // egg-phase whispers
    { id: 'egg-light', phase: 'egg',
      when: (p) => p.egg && p.egg.attention >= 1 && nightish(),
      text: () => 'the egg dreams of light.' },
    { id: 'egg-cold', phase: 'egg',
      when: (p) => p.egg && p.egg.coldSeconds >= 30,
      text: () => 'the egg fears the cold.' },
    { id: 'egg-attention', phase: 'egg',
      when: (p) => p.egg && p.egg.turns >= 5,
      text: () => 'the egg is paying attention.' },
    { id: 'egg-listening', phase: 'egg',
      when: (p) => p.egg && p.egg.hatchProgress >= 80,
      text: () => 'something inside is listening.' },

    // first-time chicken events
    { id: 'first-night', phase: 'chicken',
      when: (p) => !p.egg && p.hatchedAt && p.hatchedAt > 0 && nightish() && (Date.now() - p.hatchedAt > 30000),
      text: () => 'i remember the warm.' },
    { id: 'first-pet', phase: 'chicken',
      when: (p) => !p.egg && p.bond >= 5,
      text: () => 'a soft thing. i didn’t know.' },
    { id: 'first-meds', phase: 'chicken',
      when: (p) => !p.egg && p.sanity >= 80 && p._wasInCrisis,
      text: () => 'you came back for me.' },
    { id: 'first-egg', phase: 'chicken',
      when: (p) => !p.egg && p.eggsLaid >= 1,
      text: () => 'it has my voice.' },
    { id: 'adult-arrival', phase: 'chicken',
      when: (p) => !p.egg && window.Pet && Pet.stage() === 'adult',
      text: () => 'this is the field i live in now.' },
    { id: 'elder-arrival', phase: 'chicken',
      when: (p) => !p.egg && window.Pet && Pet.stage() === 'elder',
      text: () => 'the mountain is calling.' },

    // variant-specific dreams (each variant gets a few)
    { id: 'd-cosmic', phase: 'chicken', variant: 'cosmic',
      when: (p) => p.variant === 'cosmic' && p.bond >= 20,
      text: () => 'i can hear the sky breathing.' },
    { id: 'd-solar', phase: 'chicken', variant: 'solar',
      when: (p) => p.variant === 'solar' && nightish(),
      text: () => 'something in me is still burning.' },
    { id: 'd-lunar', phase: 'chicken', variant: 'lunar',
      when: (p) => p.variant === 'lunar' && p.sanity > 90,
      text: () => 'i was made for quiet places.' },
    { id: 'd-hyper', phase: 'chicken', variant: 'hyper',
      when: (p) => p.variant === 'hyper' && p.energy < 30,
      text: () => 'why can’t i stop.' },
    { id: 'd-feral', phase: 'chicken', variant: 'feral',
      when: (p) => p.variant === 'feral' && p.bond >= 10,
      text: () => 'i thought i was alone.' },
    { id: 'd-glitch', phase: 'chicken', variant: 'glitch',
      when: (p) => p.variant === 'glitch' && p.sanity < 50,
      text: () => 'i am also the other ones.' },
    { id: 'd-mossy', phase: 'chicken', variant: 'mossy',
      when: (p) => p.variant === 'mossy' && Pet.ageSeconds() > 600,
      text: () => 'slow is also a way.' },
    { id: 'd-ghost', phase: 'chicken', variant: 'ghost',
      when: (p) => p.variant === 'ghost' && p.bond < 5 && Pet.ageSeconds() > 120,
      text: () => 'i am almost not here.' },
  ];

  function nightish(){
    if(!window.World) return false;
    const t = window.World.timeOfDay();
    return t < 0.2 || t > 0.82;
  }

  // expose to pet via the seenDreams set
  function ensureSeen(pet){
    if(!pet.seenDreams) pet.seenDreams = {};
    return pet.seenDreams;
  }

  function tick(pet){
    if(!pet) return null;
    const seen = ensureSeen(pet);
    for(const d of DREAMS){
      if(seen[d.id]) continue;
      if(d.phase === 'egg' && !pet.egg) continue;
      if(d.phase === 'chicken' && pet.egg) continue;
      try {
        if(d.when(pet)){
          seen[d.id] = Date.now();
          return d.text(pet);
        }
      } catch(e){ /* ignore — defensive */ }
    }
    return null;
  }

  // ----- the Static (antagonist silhouette in the distance) -----
  // Tracks an x position (0..1, off-screen-left at 0 ish) that drifts toward
  // the chicken when sanity is low and retreats when it recovers.
  const staticState = {
    visible: false,
    x: 0,             // -0.2..1.2 in normalized world coords
    intensity: 0,     // 0..1, how present it is
    angerAt: 0,
  };
  function tickStatic(pet, dt){
    if(!pet || pet.egg || pet.isDead){
      staticState.intensity *= 0.95;
      return;
    }
    if(pet.sanity < 30){
      staticState.visible = true;
      // approach from offscreen at 0.04 per second
      staticState.x = staticState.x === 0 ? -0.15 : staticState.x;
      staticState.x = Math.min(0.45, staticState.x + dt * 0.005);
      staticState.intensity = Math.min(1, staticState.intensity + dt * 0.05);
    } else if(pet.sanity > 60){
      // retreat
      staticState.x = staticState.x - dt * 0.003;
      staticState.intensity = Math.max(0, staticState.intensity - dt * 0.02);
      if(staticState.x < -0.2){ staticState.visible = false; staticState.x = -0.15; }
    }
    // takes the chicken if it reaches them at intensity 1
    if(staticState.visible && staticState.intensity >= 1 && staticState.x >= 0.4){
      // forcibly "ascend" — death-by-static
      pet.isDead = true;
      pet.causeOfDeath = 'taken by the static';
      pet.deathAt = Date.now();
      pet.staticLeftEgg = true;     // flag for haunted-egg drop
      if(window.Pet) window.Pet.save();
    }
  }

  function draw(ctx, t, vw, vh){
    if(!staticState.visible || staticState.intensity < 0.05) return;
    const groundY = vh * 0.83;
    const x = staticState.x * vw * 0.7;
    const a = staticState.intensity;
    ctx.save();
    ctx.translate(x, groundY - 110);
    ctx.globalAlpha = a * 0.85;

    // If a Static portrait asset is available, use it. Pulsing red glow
    // still applies behind so the eye reads even with a flat sprite.
    const portrait = window.Assets && window.Assets.load('assets/static/portrait.png');
    if(portrait && portrait.ready){
      const pulse = 0.7 + Math.sin(t * 0.005) * 0.3;
      ctx.save();
      ctx.shadowColor = 'rgba(255, 40, 60, 0.9)';
      ctx.shadowBlur = 18 * pulse;
      const w = 60, h = 90;
      ctx.drawImage(portrait.img, -w/2, -h * 0.4, w, h);
      ctx.restore();
    } else {
      // procedural fallback — drone with red eye
      ctx.fillStyle = '#0a0710';
      ctx.beginPath();
      ctx.ellipse(0, 0, 18, 8, 0, 0, Math.PI*2);
      ctx.fill();
      const pulse = 0.7 + Math.sin(t * 0.005) * 0.3;
      ctx.fillStyle = `rgba(255, 60, 80, ${a * pulse})`;
      ctx.shadowColor = 'rgba(255, 40, 60, 0.9)';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(0, -2, 3.5, 0, Math.PI*2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(40, 20, 40, ${a * 0.6})`;
      ctx.lineWidth = 1.5;
      for(let i = -1; i <= 1; i++){
        ctx.beginPath();
        ctx.moveTo(i * 8, 4);
        ctx.bezierCurveTo(i * 8 + Math.sin(t * 0.003 + i) * 4, 18,
                          i * 6, 30, i * 5, 40 + Math.sin(t * 0.002 + i) * 4);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  window.Story = {
    ORIGINS,
    tickDream: tick,
    tickStatic,
    drawStatic: draw,
    staticState,
    eraseSeen(pet){ if(pet) pet.seenDreams = {}; },
  };
})();
