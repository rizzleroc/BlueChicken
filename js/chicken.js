// Procedural robot chicken + particle field
(function(){
  'use strict';

  const canvas = document.getElementById('fg');
  const ctx = canvas.getContext('2d');

  const state = {
    intensity: 0,        // 0..1
    mouse: { x: 0.5, y: 0.5 },
    targetMouse: { x: 0.5, y: 0.5 },
    shake: 0,
    pulse: 0,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
    w: 0, h: 0,
    particles: [],
    feathers: [],
    sparks: [],
    glitch: 0,
    panic: 0,             // sudden burst of panic
    enabled: false,
    time: 0,
  };

  function resize(){
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.w = window.innerWidth;
    state.h = window.innerHeight;
    canvas.width  = Math.floor(state.w * state.dpr);
    canvas.height = Math.floor(state.h * state.dpr);
    canvas.style.width  = state.w + 'px';
    canvas.style.height = state.h + 'px';
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();

  // ---------- particles ----------
  function spawnFeather(x, y, hue){
    state.feathers.push({
      x, y,
      vx: (Math.random() - 0.5) * 6,
      vy: -Math.random() * 4 - 1,
      r: 6 + Math.random() * 10,
      a: Math.random() * Math.PI * 2,
      va: (Math.random() - 0.5) * 0.3,
      life: 1,
      decay: 0.005 + Math.random() * 0.01,
      hue: hue ?? (Math.random() * 360),
    });
  }
  function spawnSpark(x, y){
    for(let i=0;i<8;i++){
      state.sparks.push({
        x, y,
        vx: (Math.random() - 0.5) * 12,
        vy: (Math.random() - 0.5) * 12,
        life: 1,
        decay: 0.04 + Math.random() * 0.04,
        hue: 50 + Math.random() * 30,
      });
    }
  }
  function spawnAmbient(){
    if(state.particles.length > 220) return;
    state.particles.push({
      x: Math.random() * state.w,
      y: state.h + 8,
      vx: (Math.random() - 0.5) * 0.6,
      vy: -0.4 - Math.random() * 1.4 * (0.3 + state.intensity),
      r: 0.8 + Math.random() * 2.4,
      hue: (state.time * 30 + Math.random() * 180) % 360,
      life: 1,
      decay: 0.002 + Math.random() * 0.003,
    });
  }

  // ---------- chicken drawing ----------
  function drawChicken(t){
    const cx = state.w * 0.5;
    const cy = state.h * 0.62;
    const intensity = state.intensity;

    // ---- the OPERATOR (the robot that does this) ----
    drawOperator(cx, cy, t, intensity);

    // mouse follows for head tilt
    const dx = (state.mouse.x - 0.5) * 200;
    const dy = (state.mouse.y - 0.5) * 120;

    // breathing / shake
    const breathe = Math.sin(t * 0.0025) * 4;
    const shakeX = (Math.random() - 0.5) * state.shake * 18;
    const shakeY = (Math.random() - 0.5) * state.shake * 18;

    // panic micro-twitch
    const twitchX = (Math.random() - 0.5) * state.panic * 30;
    const twitchY = (Math.random() - 0.5) * state.panic * 30;

    const ox = cx + shakeX + twitchX;
    const oy = cy + breathe + shakeY + twitchY;

    // ghost copies when intensity is high (kaleidoscopic chicken)
    const copies = 1 + Math.floor(intensity * 5);
    for(let i = 0; i < copies; i++){
      const angle = (i / copies) * Math.PI * 2;
      const rad = intensity * 80;
      const gx = ox + Math.cos(angle + t * 0.0006) * rad;
      const gy = oy + Math.sin(angle + t * 0.0006) * rad * 0.6;
      const scale = 1 - i * 0.04;
      const alpha = i === 0 ? 1 : 0.22 + (1 - i/copies) * 0.3;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = i === 0 ? 'source-over' : 'lighter';
      drawChickenAt(gx, gy, scale, dx, dy, t, intensity, i);
      ctx.restore();
    }
  }

  // ----- THE OPERATOR --------------------------------------------------
  // A mechanical arm and console hover above the chicken. A dial twists
  // further open as intensity climbs; cables snake down to the chicken's
  // antenna; sparks crackle along the wire.
  function drawOperator(cx, cy, t, intensity){
    const baseX = cx;
    const baseY = cy - 280;
    const wob = Math.sin(t * 0.0014) * 6 + Math.sin(t * 0.0023) * 4;
    const tiltJitter = (Math.random() - 0.5) * 0.04 * intensity;

    // hanging cables/rails from the top
    ctx.save();
    ctx.strokeStyle = 'rgba(170,180,210,.4)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(baseX - 90, 0); ctx.lineTo(baseX - 70, baseY - 20);
    ctx.moveTo(baseX + 90, 0); ctx.lineTo(baseX + 70, baseY - 20);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // ---- console body ----
    ctx.save();
    ctx.translate(baseX + wob, baseY);
    ctx.rotate(tiltJitter);

    // chassis shadow
    ctx.fillStyle = 'rgba(8,4,16,.5)';
    ctx.beginPath();
    ctx.ellipse(0, 70, 110, 8, 0, 0, Math.PI*2);
    ctx.fill();

    // chassis
    const chassis = ctx.createLinearGradient(0, -40, 0, 50);
    chassis.addColorStop(0, '#3a3458');
    chassis.addColorStop(0.4, '#1f1b34');
    chassis.addColorStop(1, '#0e0a1a');
    ctx.fillStyle = chassis;
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    roundRect(-110, -40, 220, 90, 12);
    ctx.fill(); ctx.stroke();

    // label
    ctx.fillStyle = 'rgba(220,210,255,.55)';
    ctx.font = '600 9px ui-monospace, "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('UNIT-7 // FEATHERBREAK', -100, -22);

    // status LEDs
    for(let i=0;i<5;i++){
      const lit = i < (1 + Math.floor(intensity * 4));
      const hue = i * 50;
      ctx.fillStyle = lit ? `hsl(${hue}, 100%, 65%)` : 'rgba(255,255,255,.08)';
      if(lit){ ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8; }
      ctx.beginPath(); ctx.arc(-90 + i*14, -8, 3, 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
    }

    // big DIAL (twists as intensity rises)
    const dialX = 55, dialY = 0;
    // dial well
    ctx.fillStyle = '#0a0710';
    ctx.beginPath(); ctx.arc(dialX, dialY, 30, 0, Math.PI*2); ctx.fill();
    // dial face
    const dialGrad = ctx.createRadialGradient(dialX-6, dialY-8, 4, dialX, dialY, 28);
    dialGrad.addColorStop(0, '#e7e1ff');
    dialGrad.addColorStop(1, '#5a548c');
    ctx.fillStyle = dialGrad;
    ctx.beginPath(); ctx.arc(dialX, dialY, 24, 0, Math.PI*2); ctx.fill();
    // tick marks (0..10)
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 1.4;
    for(let i=0;i<=10;i++){
      const a = -Math.PI*0.75 + (i/10) * Math.PI*1.5;
      const r1 = 19, r2 = i % 5 === 0 ? 13 : 16;
      ctx.beginPath();
      ctx.moveTo(dialX + Math.cos(a)*r1, dialY + Math.sin(a)*r1);
      ctx.lineTo(dialX + Math.cos(a)*r2, dialY + Math.sin(a)*r2);
      ctx.stroke();
    }
    // dial pointer
    const dialAngle = -Math.PI*0.75 + intensity * Math.PI*1.5;
    ctx.strokeStyle = '#ff3c5c';
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(dialX, dialY);
    ctx.lineTo(dialX + Math.cos(dialAngle)*20, dialY + Math.sin(dialAngle)*20);
    ctx.stroke();
    // center hub
    ctx.fillStyle = '#ffcd3c';
    ctx.beginPath(); ctx.arc(dialX, dialY, 3.5, 0, Math.PI*2); ctx.fill();

    // INTENSITY label under dial
    ctx.fillStyle = 'rgba(220,210,255,.5)';
    ctx.font = '500 8px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('INTENSITY', dialX, dialY + 38);

    // ARM — mechanical extension reaching down toward chicken
    ctx.restore();

    // arm origin world coords
    const armOX = baseX + wob - 40;
    const armOY = baseY + 30;

    // chicken-head approximate world coords (top of head)
    const headTargetX = cx;
    const headTargetY = cy - 110 + Math.sin(t*0.0025)*4;

    // ARM joints (2-segment IK-ish)
    const midX = (armOX + headTargetX) / 2 + Math.sin(t*0.002)*8;
    const midY = (armOY + headTargetY) / 2 + 30 + intensity * 15 * Math.sin(t*0.01);

    ctx.save();
    ctx.strokeStyle = '#aab2d3';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(armOX, armOY);
    ctx.lineTo(midX, midY);
    ctx.lineTo(headTargetX, headTargetY);
    ctx.stroke();

    // arm joint pivots
    ctx.fillStyle = '#ffcd3c';
    [[armOX, armOY], [midX, midY]].forEach(([px,py]) => {
      ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#0a0710';
      ctx.beginPath(); ctx.arc(px, py, 1.6, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#ffcd3c';
    });

    // electrode/claw at the tip
    ctx.save();
    ctx.translate(headTargetX, headTargetY);
    const claw = Math.atan2(headTargetY - midY, headTargetX - midX);
    ctx.rotate(claw);
    ctx.fillStyle = '#3a3458';
    roundRect(-10, -6, 20, 12, 2);
    ctx.fill();
    // electrode tip glow
    ctx.fillStyle = `hsl(${(t*0.3) % 360}, 100%, 65%)`;
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 16 + intensity * 24;
    ctx.beginPath(); ctx.arc(0, 0, 3.5 + intensity*2, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();

    // crackling sparks along the arm at high intensity
    if(intensity > 0.3 && Math.random() < 0.5){
      const seg = Math.random();
      const sx = armOX + (midX - armOX) * seg + (Math.random()-0.5)*8;
      const sy = armOY + (midY - armOY) * seg + (Math.random()-0.5)*8;
      spawnSpark(sx, sy);
    }
    if(intensity > 0.5 && Math.random() < 0.6){
      spawnSpark(headTargetX + (Math.random()-0.5)*10, headTargetY + (Math.random()-0.5)*10);
    }

    ctx.restore();
  }

  // helper
  function roundRect(x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
  }

  function drawChickenAt(x, y, scale, dx, dy, t, intensity, idx){
    const s = 100 * scale;     // base unit

    // Glitch shear
    const shear = state.glitch ? (Math.random() - 0.5) * state.glitch * 0.6 : 0;

    ctx.save();
    ctx.translate(x, y);
    ctx.transform(1, shear, 0, 1, 0, 0);

    // ---- legs (robotic pistons) ----
    drawLeg(-s*0.22, 0, t, intensity, -1);
    drawLeg( s*0.22, 0, t, intensity,  1);

    // ---- body shadow ----
    ctx.save();
    ctx.fillStyle = 'rgba(20, 5, 35, 0.45)';
    ctx.beginPath();
    ctx.ellipse(0, s*0.5, s*0.9, s*0.12, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    // ---- body (chrome egg) ----
    const bodyGrad = ctx.createRadialGradient(-s*0.2, -s*0.3, s*0.1, 0, 0, s*1.0);
    if(idx === 0){
      bodyGrad.addColorStop(0, '#ffffff');
      bodyGrad.addColorStop(0.3, '#dee4ff');
      bodyGrad.addColorStop(0.65, '#7a8cc7');
      bodyGrad.addColorStop(1, '#1d1740');
    } else {
      const hue = (t * 0.05 + idx * 60) % 360;
      bodyGrad.addColorStop(0, `hsl(${hue}, 100%, 80%)`);
      bodyGrad.addColorStop(1, `hsl(${(hue+80)%360}, 100%, 35%)`);
    }
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, s*0.78, s*0.62, 0, 0, Math.PI*2);
    ctx.fill();

    // body panel seams
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-s*0.7, 0); ctx.lineTo(s*0.7, 0);
    ctx.moveTo(0, -s*0.55); ctx.lineTo(0, s*0.55);
    ctx.stroke();

    // rivets
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    for(let i=0;i<6;i++){
      const a = (i/6) * Math.PI*2;
      ctx.beginPath();
      ctx.arc(Math.cos(a)*s*0.55, Math.sin(a)*s*0.45, 1.6, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.restore();

    // ---- wings (servo flaps) ----
    drawWing(-s*0.55, -s*0.05, t, intensity, -1);
    drawWing( s*0.55, -s*0.05, t, intensity,  1);

    // ---- tail feathers ----
    drawTail(-s*0.7, -s*0.1, t, intensity);

    // ---- neck (corrugated tube) ----
    const headTilt = Math.atan2(dy, dx + 400) * 0.4;
    const headX = Math.cos(headTilt - Math.PI/2) * s*0.7;
    const headY = Math.sin(headTilt - Math.PI/2) * s*0.7;

    ctx.save();
    ctx.strokeStyle = '#cdd6f4';
    ctx.lineWidth = s*0.18;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -s*0.4);
    ctx.quadraticCurveTo(headX*0.4, headY*0.6 - s*0.5, headX, headY - s*0.45);
    ctx.stroke();

    // corrugations
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1.2;
    for(let i=1;i<=5;i++){
      const tt = i/6;
      const px = headX*tt;
      const py = -s*0.4 + (headY - s*0.45 - (-s*0.4)) * tt;
      ctx.beginPath();
      ctx.ellipse(px, py, s*0.1, s*0.025, headTilt, 0, Math.PI*2);
      ctx.stroke();
    }
    ctx.restore();

    // ---- head ----
    drawHead(headX, headY - s*0.5, headTilt, t, intensity, idx, s);
  }

  function drawLeg(x, y, t, intensity, side){
    const wob = Math.sin(t * 0.006 + side) * (3 + intensity * 8);
    const len = 32 + Math.sin(t * 0.004 + side*2) * 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = '#9aa6c4';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    // upper
    ctx.beginPath();
    ctx.moveTo(0, 50); ctx.lineTo(wob*0.3, 50 + len);
    ctx.stroke();
    // joint
    ctx.fillStyle = '#ffcd3c';
    ctx.beginPath(); ctx.arc(wob*0.3, 50 + len, 4, 0, Math.PI*2); ctx.fill();
    // lower
    ctx.beginPath();
    ctx.moveTo(wob*0.3, 50 + len); ctx.lineTo(wob*0.6 - side*4, 50 + len*2);
    ctx.stroke();
    // foot
    ctx.strokeStyle = '#ffcd3c';
    ctx.lineWidth = 3;
    const fx = wob*0.6 - side*4;
    const fy = 50 + len*2;
    for(let i=-1;i<=1;i++){
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + i*9, fy + 7);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawWing(x, y, t, intensity, side){
    const flap = Math.sin(t * 0.012 + side) * (0.4 + intensity * 1.2);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(flap * side);
    // wing plate
    const grad = ctx.createLinearGradient(0, -30, 0, 30);
    grad.addColorStop(0, '#dde4ff');
    grad.addColorStop(1, '#3b3868');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(side*40, -20, side*55, 5);
    ctx.quadraticCurveTo(side*30, 25, 0, 18);
    ctx.closePath();
    ctx.fill();
    // feather lines
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

  function drawTail(x, y, t, intensity){
    ctx.save();
    ctx.translate(x, y);
    const tilt = Math.sin(t * 0.003) * 0.2;
    ctx.rotate(tilt - 0.3);
    const colors = ['#ff5dd6', '#ffd57f', '#7fe9ff', '#7cff9a'];
    for(let i=0;i<4;i++){
      ctx.save();
      ctx.rotate(-0.3 + i * 0.18 + intensity * 0.1 * Math.sin(t*0.01 + i));
      ctx.fillStyle = colors[i];
      ctx.beginPath();
      ctx.ellipse(-22, 0, 24, 6, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawHead(x, y, tilt, t, intensity, idx, scaleUnit){
    const s = scaleUnit;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt * 0.5);

    // head sphere
    const grad = ctx.createRadialGradient(-8, -10, 4, 0, 0, 36);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, '#dde4ff');
    grad.addColorStop(1, '#4a4880');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, Math.PI*2);
    ctx.fill();

    // comb (red)
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
    // antenna LED (pulses with intensity)
    const pulse = 0.6 + Math.sin(t * 0.02) * 0.4;
    ctx.fillStyle = `hsl(${(t*0.2)%360}, 100%, ${50 + pulse*20}%)`;
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 14 + intensity * 30;
    ctx.beginPath();
    ctx.arc(0, -62, 4 + intensity*2, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // beak
    ctx.fillStyle = '#ffb340';
    ctx.beginPath();
    ctx.moveTo(28, 2);
    ctx.lineTo(50 + Math.sin(t*0.02)*2, 6);
    ctx.lineTo(28, 12);
    ctx.closePath();
    ctx.fill();
    // beak lower
    ctx.fillStyle = '#e08a20';
    ctx.beginPath();
    ctx.moveTo(28, 8);
    ctx.lineTo(46, 12);
    ctx.lineTo(28, 15);
    ctx.closePath();
    ctx.fill();

    // ---- EYES (the show stealer) ----
    drawEye( 12, -4, t, intensity, idx);
    drawEye(-16, -2, t, intensity, idx + 1);

    // glitch slices
    if(state.glitch > 0.2){
      const slices = 3 + Math.floor(state.glitch * 4);
      for(let i=0;i<slices;i++){
        const yy = (Math.random() - 0.5) * 60;
        const hh = 2 + Math.random() * 6;
        const offX = (Math.random() - 0.5) * 30 * state.glitch;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `hsla(${Math.random()*360}, 100%, 60%, 0.6)`;
        ctx.fillRect(-40 + offX, yy, 80, hh);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  function drawEye(ex, ey, t, intensity, seed){
    ctx.save();
    ctx.translate(ex, ey);

    // sclera
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI*2);
    ctx.fill();

    // when calm: pupil follows mouse
    const calm = 1 - intensity;
    const targetX = (state.mouse.x - 0.5) * 6 * calm;
    const targetY = (state.mouse.y - 0.5) * 6 * calm;

    // when wild: pupil spins fast
    const spin = t * 0.02 * intensity * (seed % 2 ? 1 : -1);
    const radius = intensity * 4;
    const px = targetX + Math.cos(spin) * radius;
    const py = targetY + Math.sin(spin) * radius;

    // pupil
    ctx.fillStyle = '#0a0710';
    ctx.beginPath();
    ctx.arc(px, py, 4 - intensity * 1.5, 0, Math.PI*2);
    ctx.fill();

    // psychedelic iris ring when high intensity
    if(intensity > 0.3){
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const rings = 4;
      for(let i=0;i<rings;i++){
        const hue = (t * 0.5 + i * 90 + seed*30) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, 60%, ${0.25 + intensity*0.3})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, 3 + i*1.4 + Math.sin(t*0.01 + i)*0.6, 0, Math.PI*2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // highlight
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.beginPath();
    ctx.arc(-2, -3, 1.6, 0, Math.PI*2);
    ctx.fill();

    ctx.restore();
  }

  // ---------- main render ----------
  function render(t){
    state.time = t * 0.001;

    // smooth mouse
    state.mouse.x += (state.targetMouse.x - state.mouse.x) * 0.08;
    state.mouse.y += (state.targetMouse.y - state.mouse.y) * 0.08;

    // decay
    state.shake *= 0.92;
    state.pulse *= 0.94;
    state.glitch *= 0.93;
    state.panic *= 0.9;

    ctx.clearRect(0, 0, state.w, state.h);

    if(!state.enabled) return;

    // ambient
    if(Math.random() < 0.4 + state.intensity * 0.6) spawnAmbient();

    // update + draw particles (under chicken)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for(let i = state.particles.length - 1; i >= 0; i--){
      const p = state.particles[i];
      p.x += p.vx + (state.mouse.x - 0.5) * 0.3 * state.intensity;
      p.y += p.vy;
      p.life -= p.decay;
      if(p.life <= 0 || p.y < -20){ state.particles.splice(i, 1); continue; }
      ctx.fillStyle = `hsla(${p.hue}, 100%, 65%, ${p.life * 0.7})`;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.restore();

    // chicken
    drawChicken(t);

    // feathers (over chicken)
    ctx.save();
    for(let i = state.feathers.length - 1; i >= 0; i--){
      const f = state.feathers[i];
      f.x += f.vx; f.y += f.vy;
      f.vy += 0.08;
      f.vx *= 0.99;
      f.a += f.va;
      f.life -= f.decay;
      if(f.life <= 0 || f.y > state.h + 40){ state.feathers.splice(i,1); continue; }
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.a);
      ctx.globalAlpha = f.life;
      ctx.fillStyle = `hsl(${f.hue}, 90%, 70%)`;
      ctx.beginPath();
      ctx.ellipse(0, 0, f.r, f.r*0.35, 0, 0, Math.PI*2);
      ctx.fill();
      // quill
      ctx.strokeStyle = 'rgba(0,0,0,.4)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-f.r, 0); ctx.lineTo(f.r, 0);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // sparks
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for(let i = state.sparks.length - 1; i >= 0; i--){
      const s = state.sparks[i];
      s.x += s.vx; s.y += s.vy;
      s.vx *= 0.92; s.vy *= 0.92;
      s.life -= s.decay;
      if(s.life <= 0){ state.sparks.splice(i,1); continue; }
      ctx.fillStyle = `hsla(${s.hue}, 100%, 70%, ${s.life})`;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.4, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  window.Chicken = {
    render,
    resize,
    enable(){ state.enabled = true; },
    disable(){ state.enabled = false; },
    setIntensity(v){ state.intensity = Math.max(0, Math.min(1, v)); },
    setMouse(x, y){ state.targetMouse.x = x; state.targetMouse.y = y; },
    shake(v){ state.shake = Math.min(1, state.shake + (v ?? 0.4)); },
    glitch(v){ state.glitch = Math.min(1, state.glitch + (v ?? 0.5)); },
    panic(v){ state.panic = Math.min(1, state.panic + (v ?? 0.7)); },
    burstFeathers(n){
      n = n || 20;
      const cx = state.w * 0.5, cy = state.h * 0.55;
      for(let i=0;i<n;i++) spawnFeather(cx + (Math.random()-0.5)*60, cy + (Math.random()-0.5)*40);
    },
    sparkAt(x, y){ spawnSpark(x, y); },
  };
})();
