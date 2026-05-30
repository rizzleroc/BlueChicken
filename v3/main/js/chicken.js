// The robot chicken pet — renderer that reflects the Pet's state.
// Intensity (psychedelia) is driven by 1 - sanity. Pose follows mood.
// Poops, eggs, and zzz indicator are drawn here too.
(function(){
  'use strict';

  const canvas = document.getElementById('fg');
  const ctx = canvas.getContext('2d');

  const s = {
    w: 0, h: 0,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
    time: 0,
    enabled: false,
    intensity: 0,         // 0..1, derived from 1 - sanity/100
    pose: 'idle',         // 'idle' | 'eating' | 'playing' | 'sleeping' | 'pet' | 'dead'
    emotion: 'fine',      // 'fine' | 'sad' | 'panicked' | 'transcendent' | 'sleepy'
    variant: null,        // variant object { colors: [...], ... }
    isEgg: false,
    egg: null,            // egg state passthrough
    hatchAnim: 0,         // 0..1 hatch ceremony progress
    mouse: { x: 0.5, y: 0.5 },
    targetMouse: { x: 0.5, y: 0.5 },
    feathers: [],
    eggs: [],            // floor-resting eggs (laid)
    poops: [],
    particles: [],       // for ambient + reactions
    bob: 0,
    pulse: 0,
    blinkAt: 0,
    blinkUntil: 0,
    sparkleUntil: 0,     // for happiness moments
    actionFlash: null,   // { kind, until } - a short reaction overlay
    eggCount: 0,
    poopCount: 0,
    cx: 0, cy: 0,        // current center position
  };

  function resize(){
    s.dpr = Math.min(window.devicePixelRatio || 1, 2);
    s.w = window.innerWidth;
    s.h = window.innerHeight;
    canvas.width  = Math.floor(s.w * s.dpr);
    canvas.height = Math.floor(s.h * s.dpr);
    canvas.style.width  = s.w + 'px';
    canvas.style.height = s.h + 'px';
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();

  // ----- particles -----
  function spawnFeather(x, y){
    s.feathers.push({
      x, y,
      vx: (Math.random() - 0.5) * 6,
      vy: -Math.random() * 4 - 1,
      r: 5 + Math.random() * 8,
      a: Math.random() * Math.PI * 2,
      va: (Math.random() - 0.5) * 0.25,
      life: 1,
      decay: 0.005 + Math.random() * 0.01,
      hue: Math.random() * 360,
    });
  }
  function spawnSparkle(x, y){
    s.particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 3,
      vy: -1 - Math.random() * 2,
      r: 1 + Math.random() * 2,
      hue: 40 + Math.random() * 40,
      life: 1, decay: 0.02,
    });
  }
  function spawnHeart(x, y){
    s.particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 1.2,
      vy: -1 - Math.random() * 1.5,
      r: 5 + Math.random() * 3,
      hue: 340,
      life: 1, decay: 0.012,
      type: 'heart',
    });
  }
  function spawnGrain(x, y){
    s.particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 2,
      vy: -1 - Math.random() * 2,
      r: 2 + Math.random() * 1.5,
      hue: 35,
      life: 1, decay: 0.018,
      type: 'grain',
    });
  }

  // ----- helpers -----
  function roundRect(x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
  }

  // ----- color helpers -----
  function hexToRgb(hex){
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if(!m) return [255, 255, 255];
    return [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)];
  }
  function lighten(hex, amount){
    const [r,g,b] = hexToRgb(hex);
    const m = (c) => Math.round(c + (255 - c) * amount);
    return `rgb(${m(r)}, ${m(g)}, ${m(b)})`;
  }
  function darken(hex, amount){
    const [r,g,b] = hexToRgb(hex);
    const m = (c) => Math.round(c * (1 - amount));
    return `rgb(${m(r)}, ${m(g)}, ${m(b)})`;
  }

  // ----- secondary-motion springs -----
  // simple critically-damped springs that track a target with a soft lag.
  // applied to wattle, tail, head to give 'follow-through' on movement.
  const springs = {
    wattleY:  { v: 0, x: 0, target: 0, k: 0.18, d: 0.65 },
    tailRot:  { v: 0, x: 0, target: 0, k: 0.14, d: 0.7 },
    headLag:  { v: 0, x: 0, target: 0, k: 0.22, d: 0.7 },
  };
  function stepSpring(sp, target, dtFactor){
    sp.target = target;
    const k = sp.k * dtFactor;
    const d = sp.d;
    sp.v += (target - sp.x) * k;
    sp.v *= d;
    sp.x += sp.v;
    return sp.x;
  }

  // ----- chicken drawing -----
  function drawChicken(t, scale){
    scale = scale || 1;
    const U = 100 * scale;
    // dead state: slumped, X eyes (handled in drawEye via s.pose), no anim
    const isDead = window.Brain && window.Brain.pose() === 'dead';
    if(isDead){
      ctx.save();
      ctx.translate(0, U * 0.45);
      ctx.rotate(-Math.PI/2);
      ctx.scale(0.95, 0.95);
      // body
      const v2 = s.variant;
      ctx.fillStyle = v2 && v2.colors ? darken(v2.colors[2] || v2.colors[1], 0.3) : '#3a3458';
      ctx.beginPath();
      ctx.ellipse(0, 0, U*0.78, U*0.62, 0, 0, Math.PI*2);
      ctx.fill();
      // X eye
      ctx.strokeStyle = '#0a0710';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-6, -4); ctx.lineTo(6, 4);
      ctx.moveTo(6, -4); ctx.lineTo(-6, 4);
      ctx.stroke();
      ctx.restore();
      return;
    }
    // breathing — slow base rhythm with rare sighs that elongate one exhale
    const breathPhase = t * 0.0022;
    const sigh = Math.sin(t * 0.00037) > 0.94 ? 1.4 : 1;     // ~5s sighs
    const breathe = Math.sin(breathPhase) * 3 * sigh;
    const breathSquashY = 1 + Math.sin(breathPhase) * 0.025 * sigh;     // body subtly inflates

    // pull pose + facing from Brain when available
    const B = window.Brain;
    const pose = B ? B.pose() : 'idle';
    const facing = B ? B.facing() : 1;
    const sleep = pose === 'sleeping';
    const peck = pose === 'pecking';
    const sit = pose === 'sitting' || sleep || pose === 'cowering';
    const walking = pose === 'walking';
    const celebrating = pose === 'celebrating';
    const dancing = pose === 'dancing';
    const yawning = pose === 'yawning';
    const stretching = pose === 'stretching';
    const waving = pose === 'waving';
    const bowing = pose === 'bowing';
    const cowering = pose === 'cowering';
    const surprised = pose === 'surprised';
    const sneezing = pose === 'sneezing';
    const preening = pose === 'preening';

    // walking bob from leg cycle phase
    let walkBob = 0;
    if(walking && B){
      const ph = B.walkPhase();
      walkBob = Math.abs(Math.sin(ph)) * 2.5;
    }
    const peckBob = peck ? Math.sin(t * 0.018) * 4 : 0;
    const sitDrop = sit ? 22 : 0;
    const cowerSquash = cowering ? 0.85 : 1;
    const celebrateBounce = celebrating ? Math.abs(Math.sin(t * 0.012)) * 14 : 0;
    const danceBounce = dancing ? Math.abs(Math.sin(t * 0.018)) * 18 : 0;
    const danceRoll = dancing ? Math.sin(t * 0.008) * 0.18 : 0;
    // bow leans forward + down via head offset (real lean, not 0)
    const bowForward = bowing ? 8 : 0;
    // surprise: sharp upward jerk then settle (was dead code via mod cycle)
    const surpriseJerk = surprised ? -14 : 0;
    const sneezeJerk = sneezing ? Math.sin(t * 0.04) * 10 : 0;
    const stretchUp = stretching ? -8 : 0;

    // intensity-driven micro-shake
    const sx = (Math.random() - 0.5) * s.intensity * 14;
    const sy = (Math.random() - 0.5) * s.intensity * 14;

    // ease curves: smooth incoming pose transitions instead of snap
    // (used by some pose offsets below)

    ctx.save();
    ctx.translate(sx + sneezeJerk, sy + breathe + walkBob + sitDrop - celebrateBounce - danceBounce + surpriseJerk + stretchUp);
    ctx.scale(facing * cowerSquash, cowerSquash * breathSquashY * (stretching ? 1.08 : 1));
    ctx.rotate(danceRoll);

    // shadow
    ctx.fillStyle = 'rgba(20,5,35,0.45)';
    ctx.beginPath();
    ctx.ellipse(0, U*0.5, U*0.9, U*0.12, 0, 0, Math.PI*2);
    ctx.fill();

    // legs (tucked when sitting / sleeping)
    if(!sit){
      const ph = walking && B ? B.walkPhase() : 0;
      drawLeg(-U*0.22, 0, t, -1, walking ? Math.sin(ph) : 0);
      drawLeg( U*0.22, 0, t,  1, walking ? -Math.sin(ph) : 0);
    }

    // ---- body — colored by variant ----
    const bodyGrad = ctx.createRadialGradient(-U*0.2, -U*0.3, U*0.1, 0, 0, U);
    const v = s.variant;
    if(s.intensity > 0.6){
      const hue = (t * 0.05) % 360;
      bodyGrad.addColorStop(0, `hsl(${hue}, 100%, 85%)`);
      bodyGrad.addColorStop(1, `hsl(${(hue+80)%360}, 100%, 35%)`);
    } else if(v && v.colors){
      // use the lightest variant color as the highlight, not pure white,
      // so feral / ghost / lunar read as their actual color identity.
      const highlight = lighten(v.colors[0], 0.35);
      bodyGrad.addColorStop(0, highlight);
      bodyGrad.addColorStop(0.35, v.colors[0]);
      bodyGrad.addColorStop(0.75, v.colors[1]);
      bodyGrad.addColorStop(1, v.colors[2] || v.colors[1]);
    } else {
      bodyGrad.addColorStop(0, '#ffffff');
      bodyGrad.addColorStop(0.3, '#e8eaff');
      bodyGrad.addColorStop(0.65, '#7a8cc7');
      bodyGrad.addColorStop(1, '#1d1740');
    }
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, U*0.78, U*0.62, 0, 0, Math.PI*2);
    ctx.fill();

    // seam + rivets
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,.3)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-U*0.7, 0); ctx.lineTo(U*0.7, 0);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    for(let i=0;i<6;i++){
      const a = (i/6) * Math.PI*2;
      ctx.beginPath();
      ctx.arc(Math.cos(a)*U*0.55, Math.sin(a)*U*0.45, 1.5, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.restore();

    // wings (animated per pose)
    const wingOverride = {
      waving:     { right:  Math.sin(t * 0.022) * 1.2 + 1.0, left:  0 },
      stretching: { right:  -1.4, left: -1.4 },                  // both wings out
      dancing:    { right:  Math.sin(t * 0.020) * 0.8, left:  -Math.sin(t * 0.020) * 0.8 },
      bowing:     { right:  0.5, left:  0.5 },
      preening:   { right:  Math.sin(t * 0.01) * 0.4 + 0.6, left: 0.0 },
      cowering:   { right:  1.4, left: -1.4 },                   // wings wrap inward
      surprised:  { right:  -1.6, left:  1.6 },                  // both wings up shocked
    }[pose];
    drawWing(-U*0.55, -U*0.05, t, -1, wingOverride && wingOverride.left);
    drawWing( U*0.55, -U*0.05, t,  1, wingOverride && wingOverride.right);

    // tail feathers — spring follows happy/walking energy
    const tailEnergy = (walking ? 1 : 0) + (celebrating || dancing ? 1.5 : 0);
    const tailTarget = Math.sin(t * 0.012) * 0.3 * tailEnergy;
    const tailRot = stepSpring(springs.tailRot, tailTarget, 1);
    drawTail(-U*0.7, -U*0.1, t, tailRot);

    // neck + head — varied by pose
    let headTilt;
    let headYOffset = 0;     // extra vertical translation for poses that duck the head
    if(peck)            headTilt = 1.3;
    else if(sleep)      headTilt = -0.6;
    else if(yawning)    headTilt = -0.4;
    else if(stretching) headTilt = -1.0;
    else if(bowing)     { headTilt = 0.5; headYOffset = 18; }      // real forward+down lean
    else if(cowering)   { headTilt = 0.4; headYOffset = 22; }      // ducked, not face-planted
    else if(surprised)  headTilt = -0.3;
    else if(pose === 'looking') headTilt = Math.sin(t * 0.003) * 0.4;
    else if(dancing)    headTilt = Math.sin(t * 0.014) * 0.5;
    else {
      // smooth track of cursor regardless of sanity
      const look = (window.Brain && window.Brain.headLook && window.Brain.headLook()) || { x: 0, y: 0 };
      headTilt = (look.x * 0.6) + (look.y * 0.3);
    }
    const headX = Math.cos(headTilt - Math.PI/2) * U*0.7;
    const headY = Math.sin(headTilt - Math.PI/2) * U*0.7 + (peck ? 30 : 0) + headYOffset;

    ctx.save();
    ctx.strokeStyle = '#cdd6f4';
    ctx.lineWidth = U*0.18;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -U*0.4);
    ctx.quadraticCurveTo(headX*0.4, headY*0.6 - U*0.5, headX, headY - U*0.45);
    ctx.stroke();
    ctx.restore();

    drawHead(headX, headY - U*0.5, headTilt, t, U, pose);

    // sneeze puff
    if(sneezing){
      ctx.save();
      ctx.translate(headX + U*0.4, headY - U*0.45);
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      for(let i=0;i<5;i++){
        ctx.beginPath();
        ctx.arc(i*5, Math.sin(i)*3, 3 + Math.random(), 0, Math.PI*2);
        ctx.fill();
      }
      ctx.restore();
    }
    // greeting sparkles when waving
    if(waving && Math.random() < 0.25){
      spawnSparkle(headX + (Math.random()-0.5)*30, headY - U*0.7);
    }

    // zzz when sleeping
    if(sleep){
      ctx.save();
      ctx.translate(headX + U*0.5, headY - U*0.8);
      ctx.font = 'italic 18px "Instrument Serif", serif';
      ctx.fillStyle = 'rgba(255,255,255,.6)';
      const drift = (t * 0.0005) % 1;
      for(let i=0;i<3;i++){
        const yy = -i * 14 - drift * 14;
        const xx = i * 8 + Math.sin(drift * 6 + i) * 4;
        const alpha = 1 - Math.abs(drift - i/3) * 1.5;
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.fillText('z', xx, yy);
      }
      ctx.restore();
    }

    ctx.restore();
  }

  function drawLeg(x, y, t, side, lift){
    lift = lift || 0;
    const wob = Math.sin(t * 0.006 + side) * (2 + s.intensity * 6);
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = '#9aa6c4';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    const liftPx = lift * 14;
    ctx.beginPath();
    ctx.moveTo(0, 50); ctx.lineTo(wob*0.3, 80 - Math.max(0, liftPx));
    ctx.stroke();
    ctx.fillStyle = '#ffcd3c';
    ctx.beginPath(); ctx.arc(wob*0.3, 80 - Math.max(0, liftPx), 4, 0, Math.PI*2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(wob*0.3, 80 - Math.max(0, liftPx)); ctx.lineTo(wob*0.6 - side*4, 110 - Math.max(0, liftPx));
    ctx.stroke();
    // foot
    ctx.strokeStyle = '#ffcd3c';
    ctx.lineWidth = 3;
    const fx = wob*0.6 - side*4, fy = 110 - Math.max(0, liftPx);
    for(let i=-1;i<=1;i++){
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + i*9, fy + 7);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawWing(x, y, t, side, override){
    const sleep = s.pose === 'sleeping';
    let flap;
    if(override !== undefined && override !== null) flap = override;
    else flap = sleep ? 0.2 : Math.sin(t * 0.012 + side) * (0.3 + s.intensity * 1.1);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(flap * side);
    const grad = ctx.createLinearGradient(0, -30, 0, 30);
    grad.addColorStop(0, '#e8eaff');
    grad.addColorStop(1, '#3b3868');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(side*40, -20, side*55, 5);
    ctx.quadraticCurveTo(side*30, 25, 0, 18);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.lineWidth = 1;
    for(let i=1;i<=4;i++){
      ctx.beginPath();
      ctx.moveTo(side*6*i, 4);
      ctx.lineTo(side*(10 + i*8), 12);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTail(x, y, t, extraRot){
    ctx.save();
    ctx.translate(x, y);
    const tilt = Math.sin(t * 0.003) * 0.2 + (extraRot || 0);
    ctx.rotate(tilt - 0.3);
    // tail color: variant-tinted, or default rainbow for non-variant pets
    const v = s.variant;
    const colors = v && v.colors
      ? [ v.colors[0], v.colors[1], v.colors[2] || v.colors[0], lighten(v.colors[0], 0.4) ]
      : ['#ff5dd6', '#ffd57f', '#7fe9ff', '#7cff9a'];
    for(let i=0;i<4;i++){
      ctx.save();
      ctx.rotate(-0.3 + i * 0.18);
      ctx.fillStyle = colors[i];
      ctx.beginPath();
      ctx.ellipse(-22, 0, 24, 6, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawHead(x, y, tilt, t, U, pose){
    pose = pose || s.pose || 'idle';
    const sleep = pose === 'sleeping';
    const yawning = pose === 'yawning';
    const surprised = pose === 'surprised';
    const stretching = pose === 'stretching';
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt * 0.5);

    // head
    const grad = ctx.createRadialGradient(-8, -10, 4, 0, 0, 36);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, '#dde4ff');
    grad.addColorStop(1, '#4a4880');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, Math.PI*2);
    ctx.fill();

    // comb — variant-tinted
    const v = s.variant;
    ctx.fillStyle = v && v.colors ? darken(v.colors[0], 0.05) : '#ff3c5c';
    ctx.beginPath();
    for(let i=0;i<3;i++){
      ctx.arc(-10 + i*10, -32, 8 + (i===1?2:0), Math.PI, 0);
    }
    ctx.fill();

    // antenna
    ctx.strokeStyle = '#aab2d3';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -34);
    ctx.lineTo(0, -58);
    ctx.stroke();
    const ledPulse = 0.6 + Math.sin(t * 0.02) * 0.4;
    const ledColor = sleep
      ? '#5a548c'
      : (s.intensity > 0.5 ? `hsl(${(t*0.4)%360}, 100%, 65%)`
        : (v && v.colors ? lighten(v.colors[0], 0.2) : `hsl(${(t*0.05)%360}, 80%, 60%)`));
    ctx.fillStyle = ledColor;
    ctx.shadowColor = ledColor;
    ctx.shadowBlur = sleep ? 4 : 14;
    ctx.beginPath();
    ctx.arc(0, -62, sleep ? 2 : 4 + s.intensity*2, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // wattle — the soft flap under the beak, with springy follow-through
    // Target is driven by head motion (springs.headLag computed in render);
    // here it just hangs off the chin and wobbles based on a private spring.
    const wattleHang = stepSpring(springs.wattleY, Math.sin(t * 0.005) * 1.4, 1);
    ctx.save();
    ctx.translate(22, 18 + wattleHang);
    ctx.fillStyle = '#c83649';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(3, 6, 0, 9);
    ctx.quadraticCurveTo(-3, 6, 0, 0);
    ctx.fill();
    ctx.restore();

    // beak — yawning opens wide, sneezing trembles
    ctx.fillStyle = '#ffb340';
    let beakOpen = (s.actionFlash && s.actionFlash.kind === 'feed') ? 6 : 0;
    if(yawning) beakOpen = 18;
    if(pose === 'sneezing') beakOpen = Math.abs(Math.sin(t * 0.05)) * 8;
    ctx.beginPath();
    ctx.moveTo(28, 2);
    ctx.lineTo(50 + Math.sin(t*0.02)*2, 6);
    ctx.lineTo(28, 12 + beakOpen);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e08a20';
    ctx.beginPath();
    ctx.moveTo(28, 8);
    ctx.lineTo(46, 12 + beakOpen * 0.5);
    ctx.lineTo(28, 15 + beakOpen);
    ctx.closePath();
    ctx.fill();
    // dark mouth when yawning
    if(beakOpen > 8){
      ctx.fillStyle = '#1a0c1c';
      ctx.beginPath();
      ctx.moveTo(30, 6 + beakOpen * 0.2);
      ctx.lineTo(42, 9);
      ctx.lineTo(30, 13 + beakOpen * 0.7);
      ctx.closePath();
      ctx.fill();
    }

    // eyes — closed when sleeping or yawning; bigger when surprised; blink
    const eyeClosed = sleep || yawning;
    const eyeBig = surprised ? 1.4 : (stretching ? 1.1 : 1);
    const blink = window.Brain ? window.Brain.blinkOpen() : 1;
    drawEye(12, -4, t, eyeClosed, eyeBig, blink);
    drawEye(-16, -2, t, eyeClosed, eyeBig, blink);

    ctx.restore();
  }

  function drawEye(ex, ey, t, sleep, sizeMult, blink){
    sizeMult = sizeMult || 1;
    blink = blink === undefined ? 1 : blink;
    ctx.save();
    ctx.translate(ex, ey);

    if(sleep || blink < 0.3){
      ctx.strokeStyle = '#3a3458';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-6, 0); ctx.quadraticCurveTo(0, 3, 6, 0);
      ctx.stroke();
      ctx.restore();
      return;
    }

    // sclera with size + blink (vertical compression)
    const r = 8 * sizeMult;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * blink, 0, 0, Math.PI*2);
    ctx.fill();

    // pupil drifts toward mouse when calm; spins fast when insane
    const calm = 1 - s.intensity;
    const targetX = (s.mouse.x - 0.5) * 6 * calm;
    const targetY = (s.mouse.y - 0.5) * 6 * calm;
    const spin = t * 0.02 * s.intensity;
    const px = targetX + Math.cos(spin) * s.intensity * 3;
    const py = targetY + Math.sin(spin) * s.intensity * 3;

    ctx.fillStyle = '#0a0710';
    ctx.beginPath();
    ctx.arc(px, py, 4 - s.intensity * 1.2, 0, Math.PI*2);
    ctx.fill();

    if(s.intensity > 0.35){
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for(let i=0;i<3;i++){
        const hue = (t*0.5 + i*120) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, 60%, ${0.2 + s.intensity*0.3})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, 0, 3 + i*1.5, 0, Math.PI*2); ctx.stroke();
      }
      ctx.restore();
    }

    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.beginPath();
    ctx.arc(-2, -3, 1.5, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  // ---- world objects: floor eggs + poops ----
  function ensureEggs(count){
    while(s.eggs.length < count){
      s.eggs.push({
        x: s.cx + (Math.random() - 0.5) * 200,
        y: s.cy + 120 + Math.random() * 30,
        hue: Math.random() * 360,
        r: 10 + Math.random() * 4,
        rot: (Math.random() - 0.5) * 0.4,
      });
    }
    while(s.eggs.length > count) s.eggs.pop();
  }
  function ensurePoops(count){
    while(s.poops.length < count){
      s.poops.push({
        x: s.cx + (Math.random() - 0.5) * 240,
        y: s.cy + 130 + Math.random() * 20,
      });
    }
    while(s.poops.length > count) s.poops.pop();
  }

  // ---- world items (heat lamp, bed, henhouse, etc.) ----
  function drawWorldItems(t){
    const pet = window.Pet && window.Pet.get();
    if(!pet || !pet.inventory) return;
    const groundY = s.h * 0.83;
    const inv = pet.inventory;
    // henhouse — far left background
    if(inv.includes('henhouse')) drawHenhouse(s.w * 0.12, groundY, t);
    else if(inv.includes('coop')) drawCoop(s.w * 0.12, groundY, t);
    // fence — across the bottom
    if(inv.includes('fence')) drawFence(s.w * 0.0, groundY + 10, s.w);
    // heat lamp — above the egg / chicken area
    if(inv.includes('lamp')) drawHeatLamp(s.w * 0.5, groundY - 240, t, !!s.isEgg);
    // disco ball — only after coop or in late game
    if(inv.includes('disco')) drawDiscoBall(s.w * 0.5, groundY - 280, t);
    // bed — to the right of chicken area
    if(inv.includes('bed')) drawBed(s.w * 0.78, groundY - 8);
    // dish — left of chicken
    if(inv.includes('dish')) drawWaterDish(s.w * 0.32, groundY - 4);
    // feeder
    if(inv.includes('feeder')) drawFeeder(s.w * 0.68, groundY - 4);
    // perch
    if(inv.includes('perch')) drawPerch(s.w * 0.86, groundY - 60);
    // dust bath
    if(inv.includes('dustbath')) drawDustBath(s.w * 0.2, groundY - 4);
    // mirror
    if(inv.includes('mirror')) drawMirror(s.w * 0.72, groundY - 70);
    // ball
    if(inv.includes('ball')) drawBall(s.w * 0.62 + Math.sin(t*0.001)*6, groundY - 8);
    // worm
    if(inv.includes('worm')) drawWorm(s.w * 0.42 + Math.sin(t*0.003)*10, groundY - 4, t);
  }

  function drawHeatLamp(x, y, t, isEgg){
    ctx.save();
    ctx.translate(x, y);
    // chain
    ctx.strokeStyle = 'rgba(160,170,200,.45)';
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, -y); ctx.lineTo(0, 0); ctx.stroke();
    ctx.setLineDash([]);
    // lamp hood
    ctx.fillStyle = '#2c2640';
    ctx.beginPath();
    ctx.moveTo(-26, 0); ctx.lineTo(26, 0);
    ctx.lineTo(18, 22); ctx.lineTo(-18, 22);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.1)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // bulb
    const pulse = 0.85 + Math.sin(t * 0.004) * 0.15;
    const g = ctx.createRadialGradient(0, 24, 2, 0, 24, 20);
    g.addColorStop(0, `rgba(255,255,220,${pulse})`);
    g.addColorStop(0.5, `rgba(255,180,80,${pulse * 0.8})`);
    g.addColorStop(1, 'rgba(255,160,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 24, 20, 0, Math.PI*2); ctx.fill();
    // cone of light toward target
    const target = isEgg ? 220 : 200;
    const cone = ctx.createLinearGradient(0, 22, 0, target);
    cone.addColorStop(0, `rgba(255,200,120,${0.55 * pulse})`);
    cone.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(-22, 22); ctx.lineTo(-90, target);
    ctx.lineTo(90, target); ctx.lineTo(22, 22); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawCoop(x, y, t){
    ctx.save();
    ctx.translate(x, y);
    // body
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(-50, -56, 100, 56);
    // roof
    ctx.fillStyle = '#5c3a1c';
    ctx.beginPath();
    ctx.moveTo(-60, -56); ctx.lineTo(0, -88); ctx.lineTo(60, -56);
    ctx.closePath(); ctx.fill();
    // door
    ctx.fillStyle = '#1f1408';
    ctx.beginPath();
    ctx.arc(0, 0, 18, Math.PI, 0); ctx.lineTo(18, -1); ctx.lineTo(-18, -1);
    ctx.closePath(); ctx.fill();
    // window
    ctx.fillStyle = '#ffcd3c';
    ctx.fillRect(-30, -46, 14, 14);
    ctx.fillStyle = '#0a0710';
    ctx.fillRect(-29, -45, 6, 12); ctx.fillRect(-23, -45, 6, 12);
    ctx.restore();
  }

  function drawHenhouse(x, y, t){
    ctx.save();
    ctx.translate(x, y);
    // larger 2-story
    ctx.fillStyle = '#a76a32';
    ctx.fillRect(-72, -86, 144, 86);
    ctx.fillStyle = '#6b4019';
    ctx.beginPath();
    ctx.moveTo(-82, -86); ctx.lineTo(0, -126); ctx.lineTo(82, -86);
    ctx.closePath(); ctx.fill();
    // upper window
    ctx.fillStyle = '#ffcd3c';
    ctx.fillRect(-12, -100, 24, 14);
    ctx.fillStyle = '#0a0710';
    ctx.fillRect(-11, -99, 10, 12); ctx.fillRect(1, -99, 10, 12);
    // doors
    ctx.fillStyle = '#3a230f';
    ctx.fillRect(-44, -56, 26, 56);
    ctx.fillRect(18, -56, 26, 56);
    // hen on the roof, tiny
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(28, -100, 4, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#ff3c5c';
    ctx.fillRect(30, -103, 3, 3);
    ctx.restore();
  }

  function drawFence(x, y, w){
    ctx.save();
    ctx.translate(x, y);
    const post = 6, gap = 18, h = 30;
    ctx.fillStyle = '#cdb593';
    for(let i = 0; i < w; i += gap){
      ctx.beginPath();
      ctx.moveTo(i, -h);
      ctx.lineTo(i + post, -h);
      ctx.lineTo(i + post + 2, -h + 6);
      ctx.lineTo(i + post + 2, 0);
      ctx.lineTo(i - 2, 0);
      ctx.lineTo(i - 2, -h + 6);
      ctx.closePath();
      ctx.fill();
    }
    // rails
    ctx.fillStyle = '#b59770';
    ctx.fillRect(0, -22, w, 3);
    ctx.fillRect(0, -12, w, 3);
    ctx.restore();
  }

  function drawBed(x, y){
    ctx.save();
    ctx.translate(x, y);
    // straw pile, soft oval
    const g = ctx.createRadialGradient(-10, -8, 4, 0, 0, 40);
    g.addColorStop(0, '#fff1c0');
    g.addColorStop(0.6, '#d5b264');
    g.addColorStop(1, '#7a5a26');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, 38, 18, 0, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'rgba(60,40,20,.5)';
    ctx.lineWidth = 0.8;
    for(let i = -7; i <= 7; i++){
      ctx.beginPath();
      ctx.moveTo(i*5, -8 + Math.abs(i)*0.5);
      ctx.lineTo(i*5 + 2, 4);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawWaterDish(x, y){
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#3a3458';
    ctx.beginPath(); ctx.ellipse(0, 4, 18, 5, 0, 0, Math.PI*2); ctx.fill();
    const g = ctx.createLinearGradient(0, -4, 0, 4);
    g.addColorStop(0, '#7fbfff');
    g.addColorStop(1, '#3c6ea0');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, 16, 4, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.beginPath(); ctx.ellipse(-4, -1, 3, 0.6, 0.3, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function drawFeeder(x, y){
    ctx.save();
    ctx.translate(x, y);
    // metal tray
    ctx.fillStyle = '#9aa6c4';
    ctx.fillRect(-22, -6, 44, 6);
    ctx.fillStyle = '#5c5478';
    ctx.fillRect(-22, 0, 44, 4);
    // grain piles
    ctx.fillStyle = '#ffcd3c';
    for(let i = -3; i <= 3; i++){
      ctx.beginPath();
      ctx.arc(i*6, -6, 1.6, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  function drawPerch(x, y){
    ctx.save();
    ctx.translate(x, y);
    // vertical posts
    ctx.fillStyle = '#7a5a26';
    ctx.fillRect(-2, 0, 4, 60);
    ctx.fillRect(-36, 0, 4, 60);
    // horizontal bar
    ctx.fillStyle = '#d5b264';
    ctx.fillRect(-40, -4, 44, 6);
    ctx.restore();
  }

  function drawDustBath(x, y){
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#3a3458';
    ctx.beginPath(); ctx.ellipse(0, 6, 22, 5, 0, 0, Math.PI*2); ctx.fill();
    // dust
    ctx.fillStyle = '#a89570';
    ctx.beginPath(); ctx.ellipse(0, 2, 20, 5, 0, 0, Math.PI*2); ctx.fill();
    // puffs
    ctx.fillStyle = 'rgba(168,149,112,.4)';
    ctx.beginPath(); ctx.arc(-8, -2, 4, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(8, -4, 5, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function drawMirror(x, y){
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#3a3458';
    ctx.fillRect(-2, -10, 4, 70);
    ctx.fillStyle = '#cdb593';
    ctx.fillRect(-18, -10, 36, 26);
    const g = ctx.createLinearGradient(-14, -8, 14, 14);
    g.addColorStop(0, '#e8e8ff');
    g.addColorStop(1, '#9f9fb8');
    ctx.fillStyle = g;
    ctx.fillRect(-14, -8, 28, 22);
    ctx.restore();
  }

  function drawBall(x, y){
    ctx.save();
    ctx.translate(x, y);
    const g = ctx.createRadialGradient(-3, -3, 1, 0, 0, 10);
    g.addColorStop(0, '#ffd1e3');
    g.addColorStop(1, '#ff5dd6');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.3)';
    ctx.lineWidth = 0.6;
    for(let i = 0; i < 6; i++){
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(i)*9, Math.sin(i)*9);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawWorm(x, y, t){
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = '#ff9be3';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for(let i = -12; i <= 12; i += 2){
      const yy = Math.sin(i * 0.4 + t * 0.005) * 3;
      if(i === -12) ctx.moveTo(i, yy);
      else ctx.lineTo(i, yy);
    }
    ctx.stroke();
    // eye
    ctx.fillStyle = '#0a0710';
    ctx.beginPath(); ctx.arc(12, Math.sin(12*0.4 + t*0.005)*3 - 1, 1.2, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function drawDiscoBall(x, y, t){
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(160,170,200,.4)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, -y); ctx.lineTo(0, -16); ctx.stroke();
    // ball
    const r = 14;
    const g = ctx.createRadialGradient(-4, -6, 2, 0, 0, r);
    g.addColorStop(0, '#fff');
    g.addColorStop(1, '#aab2d3');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.fill();
    // facets
    ctx.strokeStyle = 'rgba(0,0,0,.3)';
    ctx.lineWidth = 0.5;
    for(let i = 0; i < 6; i++){
      ctx.beginPath(); ctx.arc(0, 0, r - i*2, 0, Math.PI*2); ctx.stroke();
    }
    // sparkles
    for(let i = 0; i < 4; i++){
      const a = i * 1.6 + t * 0.005;
      ctx.fillStyle = `hsl(${(t*0.4 + i*60) % 360}, 100%, 70%)`;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 30, Math.sin(a) * 30, 2, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  function drawLaidEgg(e){
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.rot);
    ctx.fillStyle = 'rgba(20,5,35,0.4)';
    ctx.beginPath();
    ctx.ellipse(0, e.r*0.6, e.r*0.9, e.r*0.18, 0, 0, Math.PI*2);
    ctx.fill();
    const g = ctx.createRadialGradient(-3, -5, 1, 0, 0, e.r);
    g.addColorStop(0, '#fff');
    g.addColorStop(0.7, `hsl(${e.hue}, 70%, 88%)`);
    g.addColorStop(1, `hsl(${e.hue}, 70%, 60%)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, e.r*0.78, e.r, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  function tickParticles(t){
    for(let i = s.particles.length - 1; i >= 0; i--){
      const p = s.particles[i];
      p.x += p.vx; p.y += p.vy;
      p.vy += 0.03;
      p.life -= p.decay;
      if(p.life <= 0){ s.particles.splice(i,1); continue; }
      ctx.save();
      ctx.globalAlpha = p.life;
      if(p.type === 'heart'){
        ctx.translate(p.x, p.y);
        ctx.scale(p.r/10, p.r/10);
        ctx.fillStyle = `hsl(${p.hue}, 90%, 70%)`;
        ctx.beginPath();
        ctx.moveTo(0, 3);
        ctx.bezierCurveTo(8, -5, 4, -12, 0, -6);
        ctx.bezierCurveTo(-4, -12, -8, -5, 0, 3);
        ctx.fill();
      } else if(p.type === 'grain'){
        ctx.fillStyle = `hsl(35, 80%, 65%)`;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.r, p.r*0.4, 0.5, 0, Math.PI*2);
        ctx.fill();
      } else {
        ctx.fillStyle = `hsla(${p.hue}, 100%, 70%, ${p.life})`;
        ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    }
  }

  function drawPoop(p){
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = 'rgba(20,5,35,0.5)';
    ctx.beginPath();
    ctx.ellipse(0, 8, 12, 3, 0, 0, Math.PI*2);
    ctx.fill();
    const g = ctx.createRadialGradient(-2, -2, 1, 0, 0, 10);
    g.addColorStop(0, '#6b4a2a');
    g.addColorStop(1, '#3a2a18');
    ctx.fillStyle = g;
    // three blobs stacked
    ctx.beginPath(); ctx.arc(0, 4, 7, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(-1, -2, 5.5, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(1, -7, 4, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  // ---- EGG drawing ----
  function drawEgg(t){
    const e = s.egg;
    if(!e) return;
    const cx = s.cx, cy = s.cy;
    const wobble = Math.sin(t * 0.005) * (1 + e.hatchProgress * 0.04);
    const heat = (e.warmth - 50) / 50; // -1..1
    const eggR = 78;

    // nest under egg
    ctx.save();
    ctx.translate(cx, cy + eggR + 16);
    // nest twigs
    ctx.strokeStyle = '#6b4a2a';
    ctx.lineWidth = 3;
    for(let i = 0; i < 10; i++){
      const a = (i / 10) * Math.PI;
      const r = 90;
      const x1 = Math.cos(a) * r;
      const y1 = Math.sin(a) * 8;
      ctx.beginPath();
      ctx.moveTo(x1 - 20, y1 - 2); ctx.lineTo(x1 + 20, y1 + 4);
      ctx.stroke();
    }
    ctx.strokeStyle = '#4a3318';
    ctx.lineWidth = 2;
    for(let i = 0; i < 8; i++){
      ctx.beginPath();
      const x = -70 + i * 18;
      ctx.moveTo(x - 12, 6); ctx.lineTo(x + 14, -2);
      ctx.stroke();
    }
    ctx.restore();

    // glow halo (warmth visualization)
    if(e.warmth > 50){
      const halo = ctx.createRadialGradient(cx, cy, eggR * 0.5, cx, cy, eggR * 3);
      halo.addColorStop(0, `rgba(255, 200, 100, ${Math.min(0.45, (e.warmth - 50) / 200)})`);
      halo.addColorStop(1, 'rgba(255, 200, 100, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(cx, cy, eggR * 3, 0, Math.PI*2); ctx.fill();
    } else if(e.warmth < 40){
      const halo = ctx.createRadialGradient(cx, cy, eggR * 0.5, cx, cy, eggR * 3);
      halo.addColorStop(0, `rgba(127, 191, 255, ${Math.min(0.35, (40 - e.warmth) / 100)})`);
      halo.addColorStop(1, 'rgba(127, 191, 255, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(cx, cy, eggR * 3, 0, Math.PI*2); ctx.fill();
    }

    // egg shadow
    ctx.fillStyle = 'rgba(20, 5, 35, 0.4)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + eggR * 0.9, eggR * 0.7, eggR * 0.13, 0, 0, Math.PI*2);
    ctx.fill();

    // egg body
    ctx.save();
    ctx.translate(cx + wobble, cy);

    const eg = ctx.createRadialGradient(-15, -25, 8, 0, 0, eggR);
    eg.addColorStop(0, '#ffffff');
    eg.addColorStop(0.5,
      heat > 0 ? `hsl(${30 - heat * 10}, ${50 + heat * 30}%, ${85 - heat * 10}%)`
               : `hsl(${200 + Math.abs(heat) * 20}, 40%, ${85 - Math.abs(heat) * 10}%)`
    );
    eg.addColorStop(1, heat > 0 ? '#c97a44' : '#7a8cc7');
    ctx.fillStyle = eg;
    ctx.beginPath();
    ctx.ellipse(0, 0, eggR * 0.78, eggR, 0, 0, Math.PI*2);
    ctx.fill();

    // speckles
    ctx.fillStyle = 'rgba(60, 40, 30, 0.45)';
    for(let i = 0; i < 12; i++){
      const ang = (i / 12) * Math.PI * 2;
      const r = (eggR * 0.4) + ((i * 17) % 25);
      ctx.beginPath();
      ctx.arc(Math.cos(ang) * r * 0.6, Math.sin(ang) * r, 1.5 + ((i*3)%2), 0, Math.PI*2);
      ctx.fill();
    }

    // cracks appear as hatchProgress climbs — deterministic per-crack offsets
    // so they stay still instead of shimmering every frame.
    if(e.hatchProgress > 40){
      const cracks = Math.min(6, Math.floor(e.hatchProgress / 12));
      ctx.strokeStyle = 'rgba(40, 20, 50, 0.75)';
      ctx.lineWidth = 1.6;
      for(let i = 0; i < cracks; i++){
        ctx.save();
        ctx.rotate((i / cracks) * Math.PI * 2 + 0.6);
        ctx.beginPath();
        ctx.moveTo(0, -eggR * 0.5);
        for(let j = 1; j <= 4; j++){
          // pseudo-random but stable: hash on crack index + segment index
          const seed = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
          const dx = ((seed - Math.floor(seed)) - 0.5) * 12;
          const dy = -eggR * 0.5 + j * 18;
          ctx.lineTo(dx, dy);
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    // tremble particles when close to hatching
    if(e.hatchProgress > 70 && Math.random() < 0.3){
      spawnSparkle(cx + (Math.random() - 0.5) * eggR * 1.5, cy + (Math.random() - 0.5) * eggR);
    }

    ctx.restore();

    // hatch progress ring
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(255,255,255,.06)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, eggR + 14, 0, Math.PI*2);
    ctx.stroke();
    ctx.strokeStyle = '#ff7fd6';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.shadowColor = '#ff7fd6';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(0, 0, eggR + 14, -Math.PI / 2, -Math.PI / 2 + (e.hatchProgress / 100) * Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // ---- HATCH ceremony overlay ----
  function drawHatchBurst(t){
    const a = s.hatchAnim;
    if(a <= 0) return;
    const cx = s.cx, cy = s.cy;
    const ringR = 30 + (1 - a) * 320;
    ctx.save();
    ctx.globalAlpha = a;
    const grad = ctx.createRadialGradient(cx, cy, ringR * 0.3, cx, cy, ringR);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  // ---- main render ----
  function render(t){
    s.time = t * 0.001;
    // smooth mouse
    s.mouse.x += (s.targetMouse.x - s.mouse.x) * 0.08;
    s.mouse.y += (s.targetMouse.y - s.mouse.y) * 0.08;

    // action flash decay
    if(s.actionFlash && s.actionFlash.until < t) s.actionFlash = null;
    // hatch animation decay
    if(s.hatchAnim > 0) s.hatchAnim -= 0.005;

    ctx.clearRect(0, 0, s.w, s.h);
    if(!s.enabled) return;

    // ---- WORLD (sky/ground/sun/moon/clouds) ----
    if(window.World) window.World.draw(ctx, t, s.w, s.h);

    // ---- The Static (antagonist silhouette in the distance) ----
    if(window.Story) window.Story.drawStatic(ctx, t, s.w, s.h);

    // ---- shop items in the world (behind the chicken) ----
    drawWorldItems(t);

    // pet position
    s.cx = s.w * 0.5;
    s.cy = s.h * 0.66;

    // ---- EGG MODE: draw the unhatched egg and return ----
    if(s.isEgg){
      drawEgg(t);
      tickParticles(t);
      return;
    }

    // ---- chicken roams the world via Brain ----
    if(window.Brain){
      const groundY = s.h * 0.83;
      const bx = window.Brain.x();
      // map normalized 0.15..0.85 to screen
      s.cx = s.w * (0.15 + bx * 0.7);
      s.cy = groundY - 22;
    }

    // draw eggs the chicken has laid (behind chicken)
    s.eggs.forEach(drawLaidEgg);

    // ghost copies of chicken when sanity low
    const copies = 1 + Math.floor(s.intensity * 3);
    for(let i = copies - 1; i >= 0; i--){
      ctx.save();
      ctx.translate(s.cx, s.cy);
      if(i > 0){
        const ang = i * 1.3 + t * 0.0005;
        const rad = s.intensity * 70;
        ctx.translate(Math.cos(ang) * rad, Math.sin(ang) * rad * 0.6);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35;
      }
      drawChicken(t);
      ctx.restore();
    }

    // draw poops (in front)
    s.poops.forEach(drawPoop);

    // feathers
    for(let i = s.feathers.length - 1; i >= 0; i--){
      const f = s.feathers[i];
      f.x += f.vx; f.y += f.vy;
      f.vy += 0.08; f.vx *= 0.99;
      f.a += f.va;
      f.life -= f.decay;
      if(f.life <= 0 || f.y > s.h + 40){ s.feathers.splice(i,1); continue; }
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.a);
      ctx.globalAlpha = f.life;
      ctx.fillStyle = `hsl(${f.hue}, 90%, 75%)`;
      ctx.beginPath();
      ctx.ellipse(0, 0, f.r, f.r*0.35, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }

    // particles (hearts, sparkles, grain)
    tickParticles(t);

    // speech bubble (drawn over everything)
    drawSpeechBubble(t);

    // hatch ceremony overlay
    drawHatchBurst(t);
  }

  // ---- speech bubble ----
  function drawSpeechBubble(t){
    const B = window.Brain;
    if(!B) return;
    const text = B.thought();
    if(!text) return;
    const cx = s.cx;
    const cy = s.cy - 160;
    ctx.save();
    ctx.font = 'italic 16px "Instrument Serif", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const metrics = ctx.measureText(text);
    const padX = 14, padY = 9;
    const w = Math.min(360, metrics.width + padX * 2);
    const h = 30;
    // bubble bg
    ctx.fillStyle = 'rgba(20, 12, 32, 0.92)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    const x = cx - w / 2, y = cy - h / 2;
    const r = 15;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // little tail down toward chicken
    ctx.fillStyle = 'rgba(20, 12, 32, 0.92)';
    ctx.beginPath();
    ctx.moveTo(cx - 6, y + h);
    ctx.lineTo(cx, y + h + 10);
    ctx.lineTo(cx + 6, y + h);
    ctx.closePath();
    ctx.fill();
    // text
    ctx.fillStyle = '#f7f3ff';
    ctx.fillText(text, cx, y + h / 2);
    ctx.restore();
  }

  // ---- API ----
  window.ChickenPet = {
    render,
    resize,
    enable(){ s.enabled = true; },
    disable(){ s.enabled = false; },
    setIntensity(v){ s.intensity = Math.max(0, Math.min(1, v)); },
    setPose(p){ s.pose = p; },
    setEmotion(e){ s.emotion = e; },
    setMouse(x, y){ s.targetMouse.x = x; s.targetMouse.y = y; },
    setEggCount(n){ ensureEggs(Math.min(n, 12)); },
    setPoopCount(n){ ensurePoops(Math.min(n, 5)); },
    setEgg(egg){ s.isEgg = !!egg; s.egg = egg; },
    setVariant(v){ s.variant = v; },
    triggerHatchBurst(){ s.hatchAnim = 1; },
    eggCenter(){ return { x: s.cx, y: s.cy }; },
    reactWarm(t){
      const c = s.cx, cy = s.cy;
      for(let i = 0; i < 8; i++){
        s.particles.push({
          x: c + (Math.random() - 0.5) * 80,
          y: cy + 50, vx: (Math.random() - 0.5) * 2, vy: -1 - Math.random() * 2,
          r: 2 + Math.random(), hue: 30, life: 1, decay: 0.02,
        });
      }
    },
    reactCool(t){
      const c = s.cx, cy = s.cy;
      for(let i = 0; i < 8; i++){
        s.particles.push({
          x: c + (Math.random() - 0.5) * 80,
          y: cy - 50, vx: (Math.random() - 0.5) * 1.5, vy: 1 + Math.random() * 1.5,
          r: 1.5 + Math.random(), hue: 210, life: 1, decay: 0.02,
        });
      }
    },
    reactTurn(t){
      for(let i = 0; i < 5; i++) spawnSparkle(s.cx + (Math.random()-0.5)*60, s.cy);
    },
    reactFeed(t){
      s.actionFlash = { kind: 'feed', until: t + 600 };
      const cx = s.cx, cy = s.cy;
      for(let i=0;i<14;i++) spawnGrain(cx + (Math.random()-0.5)*40, cy - 20);
    },
    reactPlay(t){
      s.actionFlash = { kind: 'play', until: t + 800 };
      for(let i=0;i<10;i++) spawnFeather(s.cx + (Math.random()-0.5)*60, s.cy - 20);
    },
    reactPet(t){
      s.actionFlash = { kind: 'pet', until: t + 600 };
      for(let i=0;i<5;i++) spawnHeart(s.cx + (Math.random()-0.5)*30, s.cy - 40);
    },
    reactMeds(t){
      s.actionFlash = { kind: 'meds', until: t + 600 };
      for(let i=0;i<10;i++) spawnSparkle(s.cx + (Math.random()-0.5)*40, s.cy - 20);
    },
    reactLayEgg(t){
      // adds an egg to floor
      s.eggs.push({
        x: s.cx + (Math.random() - 0.5) * 60,
        y: s.cy + 130,
        hue: Math.random() * 360,
        r: 11 + Math.random() * 4,
        rot: (Math.random() - 0.5) * 0.4,
      });
    },
    centerXY(){ return { x: s.cx, y: s.cy }; },
  };
})();
