// world.js
// -----------------------------------------------------------------------------
// The "world" is the singleton that owns:
//   - the time-of-day & weather state and DOM that reflects it
//   - the actor list (positions, velocity, mood, joy)
//   - the rendering helpers that characters' specials call into
//
// main.js handles input (taps, drag, roster clicks) and the per-frame tick.

(function (root) {
  "use strict";

  // ----- Constants ----------------------------------------------------------

  const TIMES   = ["dawn", "day", "dusk", "night"];
  const TIME_DURATION_MS = 90_000; // a full cycle is ~6 minutes; long enough to feel like a world
  const WEATHERS = ["calm", "breezy", "rainy", "starry"];

  const VIEW_W = 1600;
  const VIEW_H = 900;
  const GROUND_Y = 760; // characters walk on this line (their .y)

  const SVG_NS = "http://www.w3.org/2000/svg";

  // ----- Utilities ----------------------------------------------------------

  const svg = (tag, attrs = {}) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  };

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // The stage uses an SVG viewBox of 1600x900. Pointer events arrive in CSS
  // pixels. This converts client (x,y) to viewBox coordinates.
  function clientToView(el, clientX, clientY) {
    const rect = el.getBoundingClientRect();
    const sx = VIEW_W / rect.width;
    const sy = VIEW_H / rect.height;
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  }

  // ----- World --------------------------------------------------------------

  class World {
    constructor() {
      this.stage = document.getElementById("stage");
      this.skySvg = document.getElementById("sky");
      this.worldSvg = document.getElementById("world");
      this.celestial = document.getElementById("celestial");
      this.starsG = document.getElementById("stars");
      this.constG = document.getElementById("constellations");
      this.trailLayer = document.getElementById("trail-layer");
      this.effectLayer = document.getElementById("effect-layer");
      this.actorLayer = document.getElementById("actor-layer");
      this.weatherCanvas = document.getElementById("weather");
      this.wctx = this.weatherCanvas.getContext("2d");

      this.timeIdx = 1; // start at day
      this.timeT = 0;
      this.weather = "calm";
      this.weatherT = 0;
      this.weatherParticles = [];

      this.actors = []; // active hatched characters
      this.eggs = {};   // character-id -> { el, taps, charDef }
      this.discoveries = {}; // character-id -> string[]

      // Inspector state
      this.focus = null;
      this.inspector = document.getElementById("inspector");
      this.toastEl = document.getElementById("toast");

      this._resizeWeather = this._resizeWeather.bind(this);
      window.addEventListener("resize", this._resizeWeather);
      this._resizeWeather();

      this._initStars();
      this._applyTimeClass();
      this._drawCelestial();
    }

    // ---------------------------------------------------------------- timing

    // Called every frame from the game loop. dt is in ms.
    tick(dt) {
      this.timeT += dt;
      if (this.timeT >= TIME_DURATION_MS) {
        this.timeT = 0;
        this.timeIdx = (this.timeIdx + 1) % TIMES.length;
        this._applyTimeClass();
        this._maybeShiftWeather();
      }
      this._drawCelestial();

      // Actors wander; specials may add behavior hooks.
      for (const a of this.actors) {
        this._tickActor(a, dt);
      }

      this._tickWeather(dt);
    }

    _applyTimeClass() {
      TIMES.forEach((t) => this.stage.classList.remove("time-" + t));
      this.stage.classList.add("time-" + TIMES[this.timeIdx]);
      const ti = document.getElementById("time-icon");
      const tl = document.getElementById("time-label");
      const map = { dawn: ["☼", "Dawn"], day: ["☀", "Day"], dusk: ["☾", "Dusk"], night: ["✦", "Night"] };
      const [icon, label] = map[TIMES[this.timeIdx]];
      ti.textContent = icon;
      tl.textContent = label;
    }

    cycleTime() {
      this.timeIdx = (this.timeIdx + 1) % TIMES.length;
      this.timeT = 0;
      this._applyTimeClass();
      this._maybeShiftWeather();
    }

    // ---------------------------------------------------------------- sky

    _initStars() {
      // ~80 fixed background stars. They only show in dawn/night via opacity.
      for (let i = 0; i < 80; i++) {
        const c = svg("circle", {
          cx: rand(40, VIEW_W - 40),
          cy: rand(20, 500),
          r: rand(0.6, 1.6).toFixed(2),
          fill: "#fff8e0",
          opacity: 0,
        });
        this.starsG.appendChild(c);
      }
    }

    _drawCelestial() {
      // The sun and moon ride an arc determined by timeT during day/dusk/dawn (sun)
      // and night (moon). We just keep both on screen and fade them.
      const t = (this.timeIdx + this.timeT / TIME_DURATION_MS); // 0..4 over the cycle
      this.celestial.innerHTML = "";
      // sun visible during dawn (0..1), day (1..2), dusk (2..3); peak at day midpoint
      const sunPhase = t < 3 ? t : -1;
      if (sunPhase >= 0) {
        const a = (sunPhase / 3) * Math.PI; // 0..π across the sky
        const sx = 100 + Math.cos(Math.PI - a) * 700 + 700;
        const sy = 520 - Math.sin(a) * 380;
        const op = sunPhase < 0.5 ? sunPhase * 2 : sunPhase > 2.5 ? (3 - sunPhase) * 2 : 1;
        this.celestial.appendChild(svg("circle", { cx: sx, cy: sy, r: 90, fill: "url(#sun-glow)", opacity: op * 0.7 }));
        this.celestial.appendChild(svg("circle", { cx: sx, cy: sy, r: 34, fill: "#fff1b0", opacity: op }));
      }
      // moon visible during dusk (2..3), night (3..4), dawn (0..1)
      let moonPhase = -1;
      if (t >= 2 && t < 4) moonPhase = t - 2; // 0..2
      else if (t < 1) moonPhase = t + 2;      // 2..3 (wrapping)
      if (moonPhase >= 0) {
        const a = (moonPhase / 2) * Math.PI;
        const mx = 100 + Math.cos(Math.PI - a) * 700 + 700;
        const my = 540 - Math.sin(a) * 360;
        const op = moonPhase < 0.4 ? moonPhase * 2.5 : moonPhase > 1.6 ? (2 - moonPhase) * 2.5 : 1;
        this.celestial.appendChild(svg("circle", { cx: mx, cy: my, r: 60, fill: "url(#moon-glow)", opacity: op * 0.7 }));
        this.celestial.appendChild(svg("circle", { cx: mx, cy: my, r: 26, fill: "#f5f7ff", opacity: op }));
      }

      // Stars opacity: bright at night, fading at dawn/dusk, hidden in day.
      const tname = TIMES[this.timeIdx];
      const starOpacity = tname === "night" ? 1 : tname === "dusk" || tname === "dawn" ? 0.4 : 0;
      this.starsG.style.opacity = starOpacity;
    }

    // ---------------------------------------------------------------- weather

    _maybeShiftWeather() {
      // Roll a new weather every time of day with bias to "calm".
      const roll = Math.random();
      const tname = TIMES[this.timeIdx];
      let next = "calm";
      if (tname === "night" && roll > 0.6) next = "starry";
      else if (roll > 0.8) next = "rainy";
      else if (roll > 0.55) next = "breezy";
      this.setWeather(next);
    }

    setWeather(name) {
      this.weather = name;
      this.weatherParticles.length = 0;
      const map = { calm: ["·", "Calm"], breezy: ["≈", "Breezy"], rainy: ["☂", "Rainy"], starry: ["✦", "Starry"] };
      const [i, l] = map[name];
      document.getElementById("weather-icon").textContent = i;
      document.getElementById("weather-label").textContent = l;
    }

    _resizeWeather() {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth, h = window.innerHeight;
      this.weatherCanvas.width = w * dpr;
      this.weatherCanvas.height = h * dpr;
      this.weatherCanvas.style.width = w + "px";
      this.weatherCanvas.style.height = h + "px";
      this.wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    _tickWeather(dt) {
      const w = window.innerWidth, h = window.innerHeight;
      const ctx = this.wctx;
      ctx.clearRect(0, 0, w, h);

      const spawnRate = this.weather === "rainy" ? 0.7 : this.weather === "breezy" ? 0.2 : this.weather === "starry" ? 0.05 : 0;
      if (Math.random() < spawnRate) {
        if (this.weather === "rainy") {
          this.weatherParticles.push({ type: "rain", x: rand(0, w), y: -10, vx: -0.6, vy: 8 + rand(0, 4) });
        } else if (this.weather === "breezy") {
          this.weatherParticles.push({ type: "leaf", x: -10, y: rand(80, h - 220), vx: 1.6 + rand(0, 1.2), vy: rand(-0.3, 0.3), r: rand(2, 4) });
        } else if (this.weather === "starry") {
          this.weatherParticles.push({ type: "twink", x: rand(0, w), y: rand(20, h * 0.55), life: 0, ttl: 90 + rand(0, 90), r: rand(0.6, 1.4) });
        }
      }

      for (let i = this.weatherParticles.length - 1; i >= 0; i--) {
        const p = this.weatherParticles[i];
        p.x += (p.vx || 0) * (dt / 16);
        p.y += (p.vy || 0) * (dt / 16);
        if (p.type === "rain") {
          ctx.strokeStyle = "rgba(180,210,240,0.55)";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - 2, p.y + 8);
          ctx.stroke();
          if (p.y > h - 120) this.weatherParticles.splice(i, 1);
        } else if (p.type === "leaf") {
          ctx.fillStyle = "rgba(180,200,140,0.7)";
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.r * 2, p.r, Math.sin(p.x * 0.02), 0, Math.PI * 2);
          ctx.fill();
          if (p.x > w + 20) this.weatherParticles.splice(i, 1);
        } else if (p.type === "twink") {
          p.life += dt / 16;
          const a = Math.sin((p.life / p.ttl) * Math.PI);
          ctx.fillStyle = "rgba(255,250,210," + a.toFixed(2) + ")";
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
          if (p.life > p.ttl) this.weatherParticles.splice(i, 1);
        }
      }
    }

    // ---------------------------------------------------------------- eggs

    placeEgg(charDef, x, y) {
      // Build the egg DOM and add it to the world.
      const wrap = svg("g", { class: "egg", transform: `translate(${x},${y})`, "data-char": charDef.id });
      wrap.innerHTML = charDef.eggSvg();
      this.worldSvg.querySelector("#actor-layer").appendChild(wrap);
      this.eggs[charDef.id] = { el: wrap, taps: 0, charDef, x, y };
      return wrap;
    }

    tapEgg(charId) {
      const e = this.eggs[charId];
      if (!e) return null;
      e.taps++;
      e.el.classList.remove("wiggle");
      // restart the animation cleanly
      void e.el.getBoundingClientRect();
      e.el.classList.add("wiggle");
      if (e.taps >= 1) e.el.classList.add("crack-1");
      if (e.taps >= 3) e.el.classList.add("crack-2");
      if (e.taps >= 5) e.el.classList.add("crack-3");
      if (e.taps >= 6) return this.hatchEgg(charId);
      return null;
    }

    hatchEgg(charId) {
      const e = this.eggs[charId];
      if (!e) return null;
      const { x, y, charDef } = e;

      // Burst effect at the egg. Outer carries the translate; inner does the animation.
      const burst = svg("g", { class: "hatch-burst", transform: `translate(${x},${y})` });
      const burstInner = svg("g", { class: "hatch-burst-inner" });
      burstInner.appendChild(svg("circle", { cx: 0, cy: 0, r: 30, fill: "#fff8d0", opacity: 0.8 }));
      burst.appendChild(burstInner);
      this.effectLayer.appendChild(burst);
      setTimeout(() => burst.remove(), 1000);

      e.el.remove();
      delete this.eggs[charId];

      const actor = this._spawnActor(charDef, x, y);
      this.toast(charDef.name + " has hatched.");
      this.discover(charDef.id, "Hatched at " + TIMES[this.timeIdx] + ".");
      return actor;
    }

    // ---------------------------------------------------------------- actors

    _spawnActor(charDef, x, y) {
      const tplPalette = Object.assign({}, charDef.palette);
      const actor = {
        id: charDef.id,
        name: charDef.name,
        def: charDef,
        x, y,
        vx: rand(-0.4, 0.4),
        dir: 1,
        joy: 0.4,
        mood: "curious",
        lastSpecial: 0,
        born: performance.now(),
        tplPalette,
        el: null,
      };
      this._buildActorDom(actor);
      this.actors.push(actor);
      return actor;
    }

    _buildActorDom(actor) {
      const g = svg("g", { class: "actor", "data-id": actor.id, transform: `translate(${actor.x},${actor.y})` });
      g.innerHTML = actor.def.bodySvg.call(actor.def);
      // For garden turtle: re-attach existing flora when rebuilt.
      this.actorLayer.appendChild(g);
      if (actor.el) actor.el.remove();
      actor.el = g;
    }

    _tickActor(actor, dt) {
      // Idle wander: drift back and forth, turn at edges.
      const range = 1600;
      actor.x += actor.vx * (dt / 16);
      if (actor.x < 80)  { actor.vx = Math.abs(actor.vx); actor.dir = 1; }
      if (actor.x > range - 80) { actor.vx = -Math.abs(actor.vx); actor.dir = -1; }
      // Aurora floats in the sky region.
      if (actor.id === "aurora") {
        actor.y = 240 + Math.sin(performance.now() * 0.0008) * 30;
      } else if (actor.id === "bubble") {
        actor.y = 720 + Math.sin(performance.now() * 0.0014 + actor.x * 0.01) * 18;
      } else {
        actor.y = GROUND_Y - 8;
      }
      const flip = actor.dir < 0 ? -1 : 1;
      actor.el.setAttribute("transform", `translate(${actor.x.toFixed(1)},${actor.y.toFixed(1)}) scale(${flip},1)`);

      // Joy ticks up while alive; slightly faster in preferred time of day.
      const pref = actor.def.prefersTime;
      const tname = TIMES[this.timeIdx];
      const joyRate = (pref === "any" || pref === tname) ? 0.00004 : 0.00002;
      actor.joy = clamp(actor.joy + dt * joyRate, 0, 1);

      // Per-character per-tick hook (e.g. Magma footprints, Mossback growth).
      if (typeof actor.def.onMove === "function") actor.def.onMove(this, actor);

      // Mossback grows plants slowly on her shell.
      if (actor.id === "mossback" && Math.random() < 0.0008) this.plantOnTurtle(actor);

      // Whisper teleports occasionally at night.
      if (actor.id === "whisper" && tname === "night" && Math.random() < 0.0006) {
        this.teleportActor(actor, null);
      }

      // Update inspector if focused.
      if (this.focus && this.focus.id === actor.id) this._refreshInspector();
    }

    canUseSpecial(actor) {
      return performance.now() - actor.lastSpecial >= actor.def.specialCooldownMs;
    }

    useSpecial(actor) {
      if (!this.canUseSpecial(actor)) return false;
      actor.lastSpecial = performance.now();
      actor.joy = clamp(actor.joy + 0.2, 0, 1);
      actor.def.special.call(actor.def, this, actor);
      this._refreshInspector();
      return true;
    }

    // ---------------------------------------------------------------- effects

    drawConstellation() {
      // Pick 5-7 random points in the night sky, connect them, fade out.
      const n = 5 + Math.floor(Math.random() * 3);
      const cx = rand(200, VIEW_W - 200);
      const cy = rand(60, 320);
      const pts = [];
      for (let i = 0; i < n; i++) pts.push([cx + rand(-180, 180), cy + rand(-90, 90)]);
      let d = "M" + pts.map((p) => p.join(" ")).join(" L");
      const g = svg("g", { class: "constellation" });
      g.appendChild(svg("path", { d, fill: "none" }));
      for (const [px, py] of pts) g.appendChild(svg("circle", { cx: px, cy: py, r: 2.4 }));
      this.constG.appendChild(g);
      setTimeout(() => g.remove(), 6500);
    }

    castRainbow(x, y) {
      // Arc from above the fox, fanning out in 7 prismatic strokes.
      const colors = ["#ff5959", "#ffa844", "#ffe35c", "#7be07b", "#5cc3ff", "#7e7bff", "#c87bff"];
      for (let i = 0; i < colors.length; i++) {
        const off = i * 4;
        const path = svg("path", {
          class: "rainbow-arc",
          d: `M ${x - 220 - off} ${y + 30} Q ${x} ${y - 360 - off} ${x + 220 + off} ${y + 30}`,
          stroke: colors[i],
        });
        this.effectLayer.appendChild(path);
        setTimeout(() => path.remove(), 4200);
      }
    }

    plantOnTurtle(actor) {
      const garden = actor.el.querySelector(".garden");
      if (!garden) return;
      const x = rand(-20, 20);
      const blade = svg("g", { transform: `translate(${x.toFixed(1)},0)` });
      const inner = svg("g", { class: "flower-inner" });
      const isFlower = Math.random() < 0.45;
      inner.appendChild(svg("rect", { x: -0.6, y: -10, width: 1.2, height: 10, fill: "#3a5c1e" }));
      if (isFlower) {
        const petals = ["#ffb3d9", "#ffe26a", "#b8a2ff", "#ffac6b", "#a0e8c3"];
        const col = petals[Math.floor(Math.random() * petals.length)];
        inner.appendChild(svg("circle", { cx: 0, cy: -12, r: 3.2, fill: col }));
        inner.appendChild(svg("circle", { cx: 0, cy: -12, r: 1, fill: "#fff8b0" }));
      } else {
        inner.appendChild(svg("path", { d: "M0 -10 Q-3 -14 0 -16 Q3 -14 0 -10", fill: "#7ec06b" }));
      }
      blade.appendChild(inner);
      garden.appendChild(blade);
    }

    teleportActor(actor, riddle) {
      // Vanish, leave a riddle (optional), reappear elsewhere.
      const oldX = actor.x, oldY = actor.y;
      if (riddle) {
        const text = svg("text", { class: "riddle", x: oldX, y: oldY - 30, "text-anchor": "middle" });
        text.textContent = '"' + riddle + '"';
        this.effectLayer.appendChild(text);
        setTimeout(() => text.remove(), 5200);
      }
      // Smoke puff
      for (let i = 0; i < 8; i++) {
        const puff = svg("circle", {
          cx: oldX + rand(-10, 10),
          cy: oldY + rand(-20, 0),
          r: rand(6, 12),
          fill: "#3a2a55",
          opacity: 0.5,
        });
        this.effectLayer.appendChild(puff);
        puff.animate(
          [{ opacity: 0.5, transform: "translate(0,0)" }, { opacity: 0, transform: "translate(0,-30px)" }],
          { duration: 1200, fill: "forwards" }
        );
        setTimeout(() => puff.remove(), 1300);
      }
      actor.x = rand(140, VIEW_W - 140);
      actor.el.style.opacity = 0;
      setTimeout(() => { actor.el.style.opacity = 1; }, 240);
    }

    rainAt(x, y) {
      // Spawn raindrops below Pip's pocket cloud for a couple of seconds.
      const start = performance.now();
      const interval = setInterval(() => {
        const drop = svg("rect", {
          class: "raindrop",
          x: x + rand(-20, 20),
          y: y + 4,
          width: 1.5,
          height: 8,
          fill: "#7fb6ff",
          opacity: 0.8,
        });
        this.effectLayer.appendChild(drop);
        setTimeout(() => drop.remove(), 1300);
        if (performance.now() - start > 1800) clearInterval(interval);
      }, 60);
      // Grow a flower at the ground under the rain.
      setTimeout(() => this._growFlower(x), 1600);
    }

    _growFlower(x) {
      const fx = clamp(x, 60, VIEW_W - 60);
      const fy = GROUND_Y + 14;
      const g = svg("g", { transform: `translate(${fx},${fy})` });
      const inner = svg("g", { class: "flower-inner" });
      const petals = ["#ffd1e8", "#ffe26a", "#bba2ff", "#ffac6b", "#a0e8c3"];
      const col = petals[Math.floor(Math.random() * petals.length)];
      inner.appendChild(svg("rect", { x: -0.8, y: -14, width: 1.6, height: 14, fill: "#3a5c1e" }));
      inner.appendChild(svg("circle", { cx: 0, cy: -16, r: 4, fill: col }));
      inner.appendChild(svg("circle", { cx: 0, cy: -16, r: 1.4, fill: "#fff8b0" }));
      g.appendChild(inner);
      this.trailLayer.appendChild(g);
    }

    releaseBubble(x, y, memoryText) {
      const g = svg("g", { class: "bubble", transform: `translate(${x},${y})`, "data-memory": memoryText });
      const inner = svg("g", { class: "bubble-inner" });
      inner.appendChild(svg("circle", { cx: 0, cy: 0, r: 14, fill: "rgba(190,230,255,0.35)", stroke: "rgba(255,255,255,0.8)", "stroke-width": 1.5 }));
      inner.appendChild(svg("circle", { cx: -4, cy: -4, r: 3, fill: "rgba(255,255,255,0.6)" }));
      g.appendChild(inner);
      this.effectLayer.appendChild(g);
      // Pop handler. Anchor the memory text to the actual click position,
      // since the bubble rises continuously and its outer transform doesn't reflect that.
      g.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const view = this.clientToView(ev.clientX, ev.clientY);
        const t = svg("text", { class: "memory", x: view.x, y: view.y, "text-anchor": "middle", fill: "#fff", "font-size": 14, "font-style": "italic" });
        t.textContent = "— " + memoryText;
        this.effectLayer.appendChild(t);
        setTimeout(() => t.remove(), 3100);
        g.classList.add("pop");
        setTimeout(() => g.remove(), 320);
        this.toast("You remember: " + memoryText);
      });
      setTimeout(() => g.remove(), 8200);
    }

    burnAndRebuild(actor) {
      // Spawn flames, then rebuild the actor's SVG with the new palette.
      for (let i = 0; i < 10; i++) {
        const sc = rand(0.8, 1.4);
        const flame = svg("g", {
          class: "flame",
          transform: `translate(${actor.x + rand(-14, 14)},${actor.y}) scale(${sc})`,
        });
        const flameInner = svg("g", { class: "flame-inner" });
        flameInner.appendChild(svg("path", {
          d: "M0 0 Q -8 -10 0 -22 Q 8 -10 0 0 Z",
          fill: ["#ff7a3d", "#ff4d6e", "#ffd23d"][i % 3],
        }));
        flame.appendChild(flameInner);
        this.effectLayer.appendChild(flame);
        setTimeout(() => flame.remove(), 2000);
      }
      // Patch the palette on the def and rebuild.
      actor.def.palette = actor.tplPalette;
      this._buildActorDom(actor);
    }

    dashActor(actor, dist) {
      actor.dir = Math.random() < 0.5 ? -1 : 1;
      actor.vx = actor.dir * 8;
      // Drop a thick row of footprints.
      const startX = actor.x;
      for (let i = 0; i < 12; i++) {
        setTimeout(() => this.spawnFootprint(actor.x, actor.y + 22, "#ff5a20"), i * 40);
      }
      setTimeout(() => { actor.vx = actor.dir * rand(0.3, 0.8); }, 900);
    }

    spawnFootprint(x, y, color) {
      const fp = svg("ellipse", { class: "footprint", cx: x, cy: y, rx: 4, ry: 2, fill: color, opacity: 0.85 });
      this.trailLayer.appendChild(fp);
      setTimeout(() => fp.remove(), 6200);
    }

    // ---------------------------------------------------------------- petting

    petActor(actor) {
      actor.el.classList.remove("petted");
      void actor.el.getBoundingClientRect();
      actor.el.classList.add("petted");
      actor.joy = clamp(actor.joy + 0.08, 0, 1);
      this._refreshInspector();
    }

    // ---------------------------------------------------------------- HUD

    toast(message) {
      this.toastEl.textContent = message;
      this.toastEl.classList.add("show");
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => this.toastEl.classList.remove("show"), 3200);
    }

    discover(charId, line) {
      const arr = (this.discoveries[charId] = this.discoveries[charId] || []);
      // De-dup consecutive identical lines.
      if (arr[0] !== line) arr.unshift(line);
      if (arr.length > 12) arr.length = 12;
      if (this.focus && this.focus.id === charId) this._refreshInspector();
    }

    focusActor(actor) {
      this.focus = actor;
      this._refreshInspector();
      this.inspector.hidden = false;
      // Visual highlight on roster.
      document.querySelectorAll(".slot").forEach((s) => s.classList.remove("active"));
      const slot = document.querySelector(`.slot[data-id="${actor.id}"]`);
      if (slot) slot.classList.add("active");
    }

    closeInspector() {
      this.focus = null;
      this.inspector.hidden = true;
      document.querySelectorAll(".slot").forEach((s) => s.classList.remove("active"));
    }

    _refreshInspector() {
      if (!this.focus) return;
      const a = this.focus;
      document.getElementById("insp-name").textContent = a.name;
      document.getElementById("insp-role").textContent = a.def.role;
      document.getElementById("insp-story").textContent = a.def.story;
      document.getElementById("insp-mood").textContent = this._moodFor(a);
      document.getElementById("insp-joy").style.width = (a.joy * 100).toFixed(0) + "%";
      const btn = document.getElementById("insp-special");
      btn.textContent = a.def.specialLabel;
      btn.classList.toggle("cooling", !this.canUseSpecial(a));
      btn.onclick = () => this.useSpecial(a);
      const ul = document.getElementById("insp-discoveries");
      ul.innerHTML = "";
      const lines = this.discoveries[a.id] || [];
      for (const line of lines) {
        const li = document.createElement("li");
        li.textContent = line;
        ul.appendChild(li);
      }
    }

    _moodFor(actor) {
      const tname = TIMES[this.timeIdx];
      const pref = actor.def.prefersTime;
      if (actor.joy > 0.85) return "radiant";
      if (actor.joy < 0.2) return "quiet";
      if (pref === tname) return "in their element";
      if (pref === "night" && tname === "day") return "sleepy";
      if (pref === "day" && tname === "night") return "drowsy";
      return "content";
    }

    // ---------------------------------------------------------------- coord helpers

    clientToView(cx, cy) {
      return clientToView(this.worldSvg, cx, cy);
    }
  }

  root.WORLD_CONSTANTS = { VIEW_W, VIEW_H, GROUND_Y, TIMES };
  root.World = World;
})(window);
