// The world the chicken lives in: sky, sun/moon, mountains, ground, clouds,
// weather. All procedural canvas drawing. Reacts to the pet's mood and the
// current in-game time of day.
(function(){
  'use strict';

  const canvas = document.getElementById('bg');   // we paint over the bg shader
  // NOTE: world is drawn ABOVE the shader but BELOW the chicken. We use a
  // dedicated offscreen layer composed before the chicken.
  // For simplicity we draw directly on the fg canvas's ctx, before chicken.
  // The chicken renderer calls World.draw() at the right moment.

  const state = {
    // 0..1, where 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset
    timeOfDay: 0.4,
    // 0..1: 0 = sunny, 1 = stormy. driven by pet mood.
    weather: 0.0,
    // shake from mood
    moodShake: 0,
    clouds: [],
    stars: [],
    raindrops: [],
    fireflies: [],
    flowers: [],
    initted: false,
  };

  function init(w, h){
    if(state.initted) return;
    state.initted = true;
    // sprinkle clouds
    for(let i = 0; i < 6; i++){
      state.clouds.push({
        x: Math.random() * w,
        y: 40 + Math.random() * 180,
        scale: 0.6 + Math.random() * 1.4,
        speed: 0.15 + Math.random() * 0.4,
        puffSeed: Math.random() * 1000,
      });
    }
    // stars (positions in normalized 0..1 so they survive resize)
    for(let i = 0; i < 90; i++){
      state.stars.push({
        x: Math.random(),
        y: Math.random() * 0.6,
        twinkle: Math.random() * Math.PI * 2,
        size: 0.4 + Math.random() * 1.2,
      });
    }
    // flowers on the ground
    for(let i = 0; i < 12; i++){
      state.flowers.push({
        x: Math.random(),
        hue: Math.random() * 360,
        type: Math.floor(Math.random() * 3),
      });
    }
  }

  // Sample sky color at a given vertical position (0=top, 1=horizon) for a
  // given time of day.
  function skyColor(tod, y, mood){
    // palettes: night, dawn, noon, dusk
    const palettes = {
      midnight: [[8, 4, 28], [22, 12, 48], [40, 20, 70]],
      dawn:     [[60, 30, 90], [220, 110, 140], [255, 200, 160]],
      noon:     [[120, 180, 240], [180, 220, 245], [230, 240, 250]],
      dusk:     [[40, 25, 70], [200, 80, 110], [255, 150, 90]],
    };
    function lerp3(a, b, t){
      return [ a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t, a[2] + (b[2]-a[2])*t ];
    }
    function sample(palette, y){
      if(y < 0.5) return lerp3(palette[0], palette[1], y * 2);
      return lerp3(palette[1], palette[2], (y - 0.5) * 2);
    }
    // pick two phases to blend between
    let p1, p2, mix;
    if(tod < 0.2){      p1='midnight'; p2='dawn';   mix = tod / 0.2; }
    else if(tod < 0.35){p1='dawn';     p2='noon';   mix = (tod-0.2)/0.15; }
    else if(tod < 0.65){p1='noon';     p2='noon';   mix = 0; }
    else if(tod < 0.8){ p1='noon';     p2='dusk';   mix = (tod-0.65)/0.15; }
    else if(tod < 0.95){p1='dusk';     p2='midnight'; mix = (tod-0.8)/0.15; }
    else {              p1='midnight'; p2='midnight'; mix = 0; }
    const c1 = sample(palettes[p1], y);
    const c2 = sample(palettes[p2], y);
    let r = c1[0]*(1-mix) + c2[0]*mix;
    let g = c1[1]*(1-mix) + c2[1]*mix;
    let b = c1[2]*(1-mix) + c2[2]*mix;
    // mood: storms desaturate + darken
    const m = mood || 0;
    r = r * (1 - m * 0.5);
    g = g * (1 - m * 0.4);
    b = b * (1 - m * 0.2) + m * 30;
    return `rgb(${r|0}, ${g|0}, ${b|0})`;
  }

  function draw(ctx, t, vw, vh, opts){
    opts = opts || {};
    init(vw, vh);
    const tod = state.timeOfDay;
    const mood = state.weather;
    const isNight = tod < 0.22 || tod > 0.82;

    // ---- SKY (vertical gradient) ----
    const sky = ctx.createLinearGradient(0, 0, 0, vh * 0.8);
    sky.addColorStop(0,   skyColor(tod, 0,    mood));
    sky.addColorStop(0.5, skyColor(tod, 0.5,  mood));
    sky.addColorStop(1,   skyColor(tod, 1,    mood));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, vw, vh * 0.8);

    // ---- STARS (visible at night) ----
    if(isNight){
      const starAlpha = isNight ? Math.min(1, Math.abs(tod < 0.5 ? 0.22 - tod : tod - 0.82) * 8) : 0;
      ctx.save();
      for(const s of state.stars){
        const tw = (Math.sin(t * 0.002 + s.twinkle) + 1) * 0.5;
        ctx.fillStyle = `rgba(255, 240, 220, ${starAlpha * (0.4 + tw * 0.6)})`;
        ctx.beginPath();
        ctx.arc(s.x * vw, s.y * vh, s.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // ---- SUN / MOON arc across the sky ----
    // arc from (-0.1, horizon) at tod=0.25 to (1.1, horizon) at tod=0.75
    drawCelestialBody(ctx, t, vw, vh, tod, mood, isNight);

    // ---- DISTANT MOUNTAINS (3 layers, parallax-like) ----
    drawMountains(ctx, vw, vh, tod, mood);

    // ---- CLOUDS (drift across) ----
    for(const c of state.clouds){
      c.x += c.speed * (1 + mood * 0.5);
      if(c.x > vw + 200) c.x = -200;
      drawCloud(ctx, c, vh, tod, mood);
    }

    // ---- GROUND ----
    drawGround(ctx, vw, vh, tod, mood);

    // ---- FLOWERS on the ground ----
    for(const f of state.flowers){
      drawFlower(ctx, f.x * vw, vh * 0.86 + (f.x * 31 % 13), f.hue, f.type, tod);
    }

    // ---- RAIN (when weather > 0.5) ----
    if(mood > 0.3){
      spawnRain(vw, vh, mood);
      ctx.save();
      ctx.strokeStyle = `rgba(160, 180, 220, ${mood * 0.6})`;
      ctx.lineWidth = 1;
      for(let i = state.raindrops.length - 1; i >= 0; i--){
        const r = state.raindrops[i];
        r.x += r.vx; r.y += r.vy;
        if(r.y > vh){ state.raindrops.splice(i, 1); continue; }
        ctx.beginPath();
        ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + r.vx * 2, r.y + r.vy * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // ---- FIREFLIES at night ----
    if(isNight && Math.random() < 0.05) state.fireflies.push({
      x: Math.random() * vw,
      y: vh * 0.6 + Math.random() * vh * 0.2,
      phase: Math.random() * Math.PI * 2,
      life: 1,
    });
    ctx.save();
    for(let i = state.fireflies.length - 1; i >= 0; i--){
      const f = state.fireflies[i];
      f.x += Math.sin(t * 0.001 + f.phase) * 0.3;
      f.y += Math.cos(t * 0.0009 + f.phase) * 0.2;
      f.life -= 0.004;
      if(f.life <= 0){ state.fireflies.splice(i, 1); continue; }
      ctx.fillStyle = `rgba(255, 230, 130, ${f.life * 0.85})`;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(f.x, f.y, 1.4, 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    // ---- mood darkening overlay ----
    if(mood > 0.1){
      ctx.fillStyle = `rgba(20, 10, 30, ${mood * 0.4})`;
      ctx.fillRect(0, 0, vw, vh);
    }
  }

  function drawCelestialBody(ctx, t, vw, vh, tod, mood, isNight){
    // sun arc: tod 0.25 -> sunrise (left), 0.5 -> noon (top), 0.75 -> sunset (right)
    // moon arc: tod 0.75 -> moonrise, 0.0 -> midnight, 0.25 -> moonset
    let bodyTod, isMoon;
    if(tod >= 0.22 && tod <= 0.78){
      bodyTod = (tod - 0.22) / 0.56;
      isMoon = false;
    } else {
      bodyTod = ((tod < 0.22 ? tod + 1 : tod) - 0.78) / 0.44;
      isMoon = true;
    }
    bodyTod = Math.max(0, Math.min(1, bodyTod));
    const bx = vw * (-0.05 + bodyTod * 1.1);
    const by = vh * 0.7 - Math.sin(bodyTod * Math.PI) * vh * 0.6;
    const r = isMoon ? 28 : 36;

    ctx.save();
    if(isMoon){
      // moon glow
      const halo = ctx.createRadialGradient(bx, by, r * 0.4, bx, by, r * 3);
      halo.addColorStop(0, 'rgba(220, 220, 250, 0.45)');
      halo.addColorStop(1, 'rgba(220, 220, 250, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(bx, by, r * 3, 0, Math.PI*2); ctx.fill();
      // moon body
      const moonGrad = ctx.createRadialGradient(bx - 8, by - 8, 4, bx, by, r);
      moonGrad.addColorStop(0, '#fffae0');
      moonGrad.addColorStop(1, '#cfc8e0');
      ctx.fillStyle = moonGrad;
      ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI*2); ctx.fill();
      // craters
      ctx.fillStyle = 'rgba(160, 150, 180, 0.35)';
      [[-8, -4, 4], [6, 3, 3], [3, -10, 2], [-5, 8, 2.5]].forEach(([dx, dy, rr]) => {
        ctx.beginPath(); ctx.arc(bx + dx, by + dy, rr, 0, Math.PI*2); ctx.fill();
      });
    } else {
      const intensity = 1 - mood * 0.6;
      const sunGrad = ctx.createRadialGradient(bx, by, 0, bx, by, r * 4);
      sunGrad.addColorStop(0, `rgba(255, 240, 180, ${intensity})`);
      sunGrad.addColorStop(0.3, `rgba(255, 200, 100, ${intensity * 0.6})`);
      sunGrad.addColorStop(1, 'rgba(255, 200, 100, 0)');
      ctx.fillStyle = sunGrad;
      ctx.beginPath(); ctx.arc(bx, by, r * 4, 0, Math.PI*2); ctx.fill();
      // sun body
      const sg = ctx.createRadialGradient(bx - 6, by - 6, 4, bx, by, r);
      sg.addColorStop(0, '#fffae0');
      sg.addColorStop(1, '#ffc94d');
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  function drawMountains(ctx, vw, vh, tod, mood){
    const layers = [
      { y: 0.65, color: shade(tod, 60, 40, 80, mood), amp: 50,  freq: 0.012 },
      { y: 0.72, color: shade(tod, 40, 28, 60, mood), amp: 70,  freq: 0.008 },
      { y: 0.78, color: shade(tod, 25, 18, 42, mood), amp: 40,  freq: 0.014 },
    ];
    for(const L of layers){
      ctx.fillStyle = L.color;
      ctx.beginPath();
      ctx.moveTo(0, vh * L.y);
      for(let x = 0; x <= vw + 10; x += 8){
        const y = vh * L.y - (
          Math.sin(x * L.freq) * L.amp +
          Math.sin(x * L.freq * 2.4 + 1) * L.amp * 0.5 +
          Math.sin(x * L.freq * 0.7 + 2) * L.amp * 0.3
        );
        ctx.lineTo(x, y);
      }
      ctx.lineTo(vw, vh);
      ctx.lineTo(0, vh);
      ctx.closePath();
      ctx.fill();
    }
  }

  function shade(tod, r, g, b, mood){
    // mountains tint with time of day
    const isNight = tod < 0.22 || tod > 0.82;
    const k = isNight ? 0.45 : (tod < 0.35 || tod > 0.7 ? 0.7 : 1.0);
    r = r * k * (1 - mood * 0.3);
    g = g * k * (1 - mood * 0.3);
    b = b * k * (1 - mood * 0.2) + mood * 20;
    return `rgb(${r|0}, ${g|0}, ${b|0})`;
  }

  function drawCloud(ctx, c, vh, tod, mood){
    const y = c.y;
    const sc = c.scale;
    const baseAlpha = 0.85 - mood * 0.2;
    ctx.save();
    ctx.translate(c.x, y);
    ctx.scale(sc, sc);
    // body
    const cloudColor = tod < 0.22 || tod > 0.82 ? 'rgba(60,55,90,' + baseAlpha + ')' :
                       tod < 0.35 || tod > 0.7   ? 'rgba(255,180,170,' + baseAlpha + ')' :
                                                   'rgba(255,255,255,' + baseAlpha + ')';
    ctx.fillStyle = cloudColor;
    // a few overlapping circles
    const puffs = [[0, 0, 28], [22, -6, 22], [-22, -4, 22], [10, -16, 18], [-12, -14, 18]];
    for(const [dx, dy, r] of puffs){
      ctx.beginPath();
      ctx.arc(dx, dy, r, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawGround(ctx, vw, vh, tod, mood){
    // grass mound
    const grassY = vh * 0.83;
    const grassColors = {
      day:   ['#7cc97f', '#3b8d4f', '#1f5230'],
      dusk:  ['#8a7a55', '#5c4c30', '#2e2510'],
      night: ['#1f2840', '#10182a', '#080d18'],
      dawn:  ['#a8a8b8', '#6b6c87', '#363854'],
    };
    let palette = grassColors.day;
    if(tod < 0.22 || tod > 0.82) palette = grassColors.night;
    else if(tod < 0.35) palette = grassColors.dawn;
    else if(tod > 0.7) palette = grassColors.dusk;

    const g = ctx.createLinearGradient(0, grassY, 0, vh);
    g.addColorStop(0, palette[0]);
    g.addColorStop(0.4, palette[1]);
    g.addColorStop(1, palette[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, grassY, vw, vh - grassY);

    // a few grass blades
    ctx.strokeStyle = palette[2];
    ctx.lineWidth = 1;
    for(let i = 0; i < vw; i += 4){
      const h = 3 + ((i * 91) % 7);
      ctx.beginPath();
      ctx.moveTo(i, grassY); ctx.lineTo(i + 1, grassY - h);
      ctx.stroke();
    }
  }

  function drawFlower(ctx, x, y, hue, type, tod){
    const isNight = tod < 0.22 || tod > 0.82;
    ctx.save();
    ctx.translate(x, y);
    // stem
    ctx.strokeStyle = isNight ? '#1a2030' : '#2c5f3a';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, 12); ctx.lineTo(0, -6);
    ctx.stroke();
    // petals
    const petalColor = isNight ? `hsl(${hue}, 30%, 35%)` : `hsl(${hue}, 75%, 65%)`;
    ctx.fillStyle = petalColor;
    if(type === 0){
      // daisy-ish
      for(let i = 0; i < 6; i++){
        ctx.save();
        ctx.rotate(i * Math.PI / 3);
        ctx.beginPath();
        ctx.ellipse(0, -6, 2, 4, 0, 0, Math.PI*2);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = '#ffcd3c';
      ctx.beginPath(); ctx.arc(0, -6, 1.5, 0, Math.PI*2); ctx.fill();
    } else if(type === 1){
      // tulip-ish
      ctx.beginPath();
      ctx.moveTo(0, -10); ctx.quadraticCurveTo(4, -8, 3, -4);
      ctx.quadraticCurveTo(0, -6, -3, -4);
      ctx.quadraticCurveTo(-4, -8, 0, -10);
      ctx.fill();
    } else {
      // mushroom
      ctx.fillStyle = isNight ? '#5a4a70' : '#ff6b80';
      ctx.beginPath(); ctx.arc(0, -4, 4, Math.PI, 0); ctx.fill();
      ctx.fillStyle = isNight ? '#3a3050' : '#fff';
      ctx.fillRect(-1.5, -4, 3, 8);
    }
    ctx.restore();
  }

  function spawnRain(vw, vh, mood){
    const targetCount = Math.floor(mood * 200);
    while(state.raindrops.length < targetCount){
      state.raindrops.push({
        x: Math.random() * (vw + 100) - 50,
        y: -Math.random() * 100,
        vx: -1 - mood * 1.5,
        vy: 6 + mood * 6 + Math.random() * 3,
      });
    }
  }

  // ----- API -----
  window.World = {
    draw,
    setTimeOfDay(t){ state.timeOfDay = ((t % 1) + 1) % 1; },
    timeOfDay(){ return state.timeOfDay; },
    setWeather(w){ state.weather = Math.max(0, Math.min(1, w)); },
    weather(){ return state.weather; },
  };
})();
