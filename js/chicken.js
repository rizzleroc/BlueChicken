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

  // ----- chicken drawing -----
  function drawChicken(t, scale){
    scale = scale || 1;
    const U = 100 * scale;        // base unit
    const breathe = Math.sin(t * 0.003) * 3;
    const sleep = s.pose === 'sleeping';

    // intensity-driven micro-shake
    const sx = (Math.random() - 0.5) * s.intensity * 14;
    const sy = (Math.random() - 0.5) * s.intensity * 14;

    ctx.save();
    ctx.translate(sx, sy + breathe);

    // shadow
    ctx.fillStyle = 'rgba(20,5,35,0.45)';
    ctx.beginPath();
    ctx.ellipse(0, U*0.5, U*0.9, U*0.12, 0, 0, Math.PI*2);
    ctx.fill();

    // legs (tucked when sleeping)
    if(!sleep){
      drawLeg(-U*0.22, 0, t, -1);
      drawLeg( U*0.22, 0, t,  1);
    }

    // ---- body ----
    const bodyGrad = ctx.createRadialGradient(-U*0.2, -U*0.3, U*0.1, 0, 0, U);
    if(s.intensity < 0.6){
      bodyGrad.addColorStop(0, '#ffffff');
      bodyGrad.addColorStop(0.3, '#e8eaff');
      bodyGrad.addColorStop(0.65, '#7a8cc7');
      bodyGrad.addColorStop(1, '#1d1740');
    } else {
      // colors shift as sanity drops
      const hue = (t * 0.05) % 360;
      bodyGrad.addColorStop(0, `hsl(${hue}, 100%, 85%)`);
      bodyGrad.addColorStop(1, `hsl(${(hue+80)%360}, 100%, 35%)`);
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

    // wings
    drawWing(-U*0.55, -U*0.05, t, -1);
    drawWing( U*0.55, -U*0.05, t,  1);

    // tail feathers
    drawTail(-U*0.7, -U*0.1, t);

    // neck + head
    const headTilt = sleep ? -0.6 : Math.atan2(s.mouse.y - 0.5, s.mouse.x - 0.5 + 4) * 0.3;
    const headX = Math.cos(headTilt - Math.PI/2) * U*0.7;
    const headY = Math.sin(headTilt - Math.PI/2) * U*0.7;

    ctx.save();
    ctx.strokeStyle = '#cdd6f4';
    ctx.lineWidth = U*0.18;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -U*0.4);
    ctx.quadraticCurveTo(headX*0.4, headY*0.6 - U*0.5, headX, headY - U*0.45);
    ctx.stroke();
    ctx.restore();

    drawHead(headX, headY - U*0.5, headTilt, t, U);

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

  function drawLeg(x, y, t, side){
    const wob = Math.sin(t * 0.006 + side) * (2 + s.intensity * 6);
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = '#9aa6c4';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 50); ctx.lineTo(wob*0.3, 80);
    ctx.stroke();
    ctx.fillStyle = '#ffcd3c';
    ctx.beginPath(); ctx.arc(wob*0.3, 80, 4, 0, Math.PI*2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(wob*0.3, 80); ctx.lineTo(wob*0.6 - side*4, 110);
    ctx.stroke();
    // foot
    ctx.strokeStyle = '#ffcd3c';
    ctx.lineWidth = 3;
    const fx = wob*0.6 - side*4, fy = 110;
    for(let i=-1;i<=1;i++){
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + i*9, fy + 7);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawWing(x, y, t, side){
    const sleep = s.pose === 'sleeping';
    const flap = sleep ? 0.2 : Math.sin(t * 0.012 + side) * (0.3 + s.intensity * 1.1);
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

  function drawTail(x, y, t){
    ctx.save();
    ctx.translate(x, y);
    const tilt = Math.sin(t * 0.003) * 0.2;
    ctx.rotate(tilt - 0.3);
    const colors = ['#ff5dd6', '#ffd57f', '#7fe9ff', '#7cff9a'];
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

  function drawHead(x, y, tilt, t, U){
    const sleep = s.pose === 'sleeping';
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

    // comb
    ctx.fillStyle = '#ff3c5c';
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
      : (s.intensity > 0.5 ? `hsl(${(t*0.4)%360}, 100%, 65%)` : `hsl(${(t*0.05)%360}, 80%, 60%)`);
    ctx.fillStyle = ledColor;
    ctx.shadowColor = ledColor;
    ctx.shadowBlur = sleep ? 4 : 14;
    ctx.beginPath();
    ctx.arc(0, -62, sleep ? 2 : 4 + s.intensity*2, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // beak
    ctx.fillStyle = '#ffb340';
    const beakOpen = (s.actionFlash && s.actionFlash.kind === 'feed') ? 6 : 0;
    ctx.beginPath();
    ctx.moveTo(28, 2);
    ctx.lineTo(50 + Math.sin(t*0.02)*2, 6);
    ctx.lineTo(28, 12 + beakOpen);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e08a20';
    ctx.beginPath();
    ctx.moveTo(28, 8);
    ctx.lineTo(46, 12);
    ctx.lineTo(28, 15 + beakOpen);
    ctx.closePath();
    ctx.fill();

    // eyes
    drawEye(12, -4, t, sleep);
    drawEye(-16, -2, t, sleep);

    ctx.restore();
  }

  function drawEye(ex, ey, t, sleep){
    ctx.save();
    ctx.translate(ex, ey);

    if(sleep){
      // closed eye — single line
      ctx.strokeStyle = '#3a3458';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-6, 0); ctx.quadraticCurveTo(0, 3, 6, 0);
      ctx.stroke();
      ctx.restore();
      return;
    }

    // sclera
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI*2);
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

  function drawEgg(e){
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

  // ---- main render ----
  function render(t){
    s.time = t * 0.001;
    // smooth mouse
    s.mouse.x += (s.targetMouse.x - s.mouse.x) * 0.08;
    s.mouse.y += (s.targetMouse.y - s.mouse.y) * 0.08;

    // action flash decay
    if(s.actionFlash && s.actionFlash.until < t) s.actionFlash = null;

    ctx.clearRect(0, 0, s.w, s.h);
    if(!s.enabled) return;

    // chicken sits centered, slightly above middle
    s.cx = s.w * 0.5;
    s.cy = s.h * 0.6;

    // floor strip — subtle gradient under the chicken
    const floorGrad = ctx.createLinearGradient(0, s.cy + 60, 0, s.cy + 200);
    floorGrad.addColorStop(0, 'rgba(255,255,255,0.04)');
    floorGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(s.cx - 280, s.cy + 60, 560, 200);

    // draw eggs (behind chicken)
    s.eggs.forEach(drawEgg);

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
