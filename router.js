// router.js
// -----------------------------------------------------------------------------
// Top-level shell. Two responsibilities:
//   1. Toggle which iframe is visible (V1 Cluckbot main view <-> 3D Realm).
//   2. Bridge state between the two apps. V1 writes its pet to
//      localStorage("cluckbot.v1"); we poll its eggsLaid count and, when it
//      goes up, signal the Realm via "bluechicken/egg-pipeline/v1" so the
//      Realm spawns the next prize-hatchling egg.
//
// We chose iframes (rather than mounting both apps in the same document) so
// V1's globals (Pet, Chicken, Brain, ...) don't collide with the Realm's
// module-scoped state. localStorage is shared across same-origin iframes, so
// it's the cheapest IPC available.

(() => {
  const btnMain  = document.getElementById("btn-main");
  const btnRealm = document.getElementById("btn-realm");
  const frameMain  = document.getElementById("frame-main");
  const frameRealm = document.getElementById("frame-realm");
  const eggNotice  = document.getElementById("egg-notice");
  const eggNoticeText = document.getElementById("egg-notice-text");
  const eggNoticeGo   = document.getElementById("egg-notice-go");

  // ---- View toggle --------------------------------------------------------
  function showView(name) {
    if (name === "realm") {
      document.body.classList.add("show-realm");
      btnMain.classList.remove("active");
      btnRealm.classList.add("active");
    } else {
      document.body.classList.remove("show-realm");
      btnMain.classList.add("active");
      btnRealm.classList.remove("active");
    }
  }
  btnMain.onclick  = () => showView("main");
  btnRealm.onclick = () => showView("realm");

  // ---- V1 → Realm egg pipeline -------------------------------------------
  // V1 increments pet.eggsLaid whenever Cluckbot lays an egg (see
  // main/js/pet.js). We track how many we've already piped into the Realm
  // in localStorage under PIPE_KEY; whenever V1's count gets ahead, we
  // write a signal at SIGNAL_KEY that the Realm watches.
  const V1_KEY     = "cluckbot.v1";
  const PIPE_KEY   = "bluechicken/egg-pipeline/v1";  // { piped: <count> }
  const SIGNAL_KEY = "bluechicken/egg-pipeline/signal"; // { ts, delta }

  function readV1Eggs() {
    try {
      const raw = localStorage.getItem(V1_KEY);
      if (!raw) return 0;
      const pet = JSON.parse(raw);
      return pet && typeof pet.eggsLaid === "number" ? pet.eggsLaid : 0;
    } catch (_) { return 0; }
  }
  function readPiped() {
    try {
      const raw = localStorage.getItem(PIPE_KEY);
      if (!raw) return 0;
      return JSON.parse(raw).piped || 0;
    } catch (_) { return 0; }
  }
  function writePiped(n) {
    localStorage.setItem(PIPE_KEY, JSON.stringify({ piped: n }));
  }
  function signalRealm(delta) {
    localStorage.setItem(SIGNAL_KEY, JSON.stringify({ ts: Date.now(), delta }));
  }

  function flashNotice(text) {
    eggNoticeText.textContent = text;
    eggNotice.classList.add("show");
    clearTimeout(flashNotice._t);
    flashNotice._t = setTimeout(() => eggNotice.classList.remove("show"), 6500);
  }
  eggNoticeGo.onclick = () => {
    eggNotice.classList.remove("show");
    showView("realm");
  };

  // Poll every 2s. V1 only lays roughly once per real-time hour at its base
  // rate, so this is plenty responsive.
  function pollPipeline() {
    const eggs  = readV1Eggs();
    const piped = readPiped();
    const delta = eggs - piped;
    if (delta > 0) {
      signalRealm(delta);
      writePiped(eggs);
      flashNotice(
        delta === 1
          ? "Blue laid an egg — it's in the Realm."
          : `Blue laid ${delta} eggs — they're in the Realm.`
      );
    }
  }
  setInterval(pollPipeline, 2000);
  // First read on boot — if V1 already laid while the page was closed, we
  // still want the Realm to receive them. Don't flash the notice for the
  // initial reconciliation (that'd feel spammy on every reload).
  (function initialReconcile() {
    const eggs  = readV1Eggs();
    const piped = readPiped();
    if (eggs > piped) {
      signalRealm(eggs - piped);
      writePiped(eggs);
    }
  })();

  // ---- Realm → Barnyard: graduate pipeline -------------------------------
  // The realm writes graduated hatchlings to "bluechicken/graduates" once
  // they've sustained joy ≥ 0.9 for 30s. We poll the ledger, render each
  // graduate as a portrait in the flock strip (over the barnyard view),
  // and flash a green "X has grown up" notice on every new arrival.
  const GRAD_KEY = "bluechicken/graduates";
  const SEEN_KEY = "bluechicken/graduates/shell-seen";
  const flockLayer = document.getElementById("flock-layer");
  const gradNotice = document.getElementById("grad-notice");

  function readGraduates() {
    try {
      const raw = localStorage.getItem(GRAD_KEY);
      return raw ? (JSON.parse(raw) || []) : [];
    } catch (_) { return []; }
  }
  function readSeenIds() {
    try {
      const raw = localStorage.getItem(SEEN_KEY);
      return new Set(raw ? (JSON.parse(raw) || []) : []);
    } catch (_) { return new Set(); }
  }
  function writeSeenIds(set) {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(set))); } catch (_) {}
  }

  function flashGradNotice(name) {
    gradNotice.textContent = `${name} has grown up — joining Blue at the barnyard.`;
    gradNotice.classList.add("show");
    clearTimeout(flashGradNotice._t);
    flashGradNotice._t = setTimeout(() => gradNotice.classList.remove("show"), 6500);
  }

  // ---- Wandering-flock AI ------------------------------------------------
  // Each graduate gets a sprite that drifts the barnyard, hops, pops emoji
  // thought-bubbles, and walks toward each other to socialize. Needs decay
  // over time and mood updates ring the sprite with a colored outline.
  const NEEDS_DECAY = { hunger: 0.5, energy: 0.4, fun: 0.35, social: 0.3 }; // per second
  const MOOD_EMOTES = {
    happy:   ["♡", "✦", "✿", "♪"],
    playful: ["♪", "✦", "★", "♬"],
    hungry:  ["🌾", "✦", "·"],
    tired:   ["☾", "z", "·"],
    sad:     ["·", "·", "♢"],
  };
  const flockSprites = new Map(); // id -> { el, x, y, needs, mood, ... }

  function spawnFlockSprite(g, fresh) {
    if (flockSprites.has(g.id)) return;
    const img = document.createElement("img");
    img.className = "flock-member" + (fresh ? " fresh" : "");
    img.dataset.id = g.id;
    img.alt = g.name || g.id;
    img.title = `${g.name || g.id} — ${g.role || "graduate"}`;
    img.src = g.portrait
      ? new URL(g.portrait, location.href.replace(/[^\/]+$/, "")).href
      : "";
    flockLayer.appendChild(img);
    const W = window.innerWidth, H = window.innerHeight;
    const s = {
      g, el: img,
      x: 80 + Math.random() * (W - 160),
      y: 140 + Math.random() * (H - 340),
      target: null, lastEmoteAt: 0, lastHopAt: 0,
      needs: { hunger: 70 + Math.random() * 30, energy: 70 + Math.random() * 30,
               fun: 60 + Math.random() * 30, social: 60 + Math.random() * 30 },
      mood: "happy",
    };
    img.addEventListener("click", () => onPlayerInteract(s));
    flockSprites.set(g.id, s);
    place(s);
  }

  function place(s) {
    s.el.style.transform = `translate(${s.x - 28}px, ${s.y - 28}px)`;
  }

  function moodFrom(needs) {
    if (needs.hunger < 25) return "hungry";
    if (needs.energy < 25) return "tired";
    if (needs.fun < 25 || needs.social < 25) return "sad";
    if (needs.fun > 70 && needs.energy > 50) return "playful";
    return "happy";
  }
  function setMood(s, mood) {
    if (s.mood === mood) return;
    s.mood = mood;
    s.el.classList.remove("mood-happy", "mood-hungry", "mood-sad", "mood-tired", "mood-playful");
    s.el.classList.add("mood-" + mood);
  }

  function emote(s, glyph) {
    const e = document.createElement("div");
    e.className = "flock-emote";
    e.textContent = glyph;
    e.style.left = `${s.x}px`;
    e.style.top  = `${s.y - 36}px`;
    flockLayer.appendChild(e);
    setTimeout(() => e.remove(), 2000);
    s.lastEmoteAt = performance.now();
  }
  function hop(s) {
    s.el.animate(
      [{ transform: `translate(${s.x - 28}px, ${s.y - 28}px)` },
       { transform: `translate(${s.x - 28}px, ${s.y - 28 - 20}px)` },
       { transform: `translate(${s.x - 28}px, ${s.y - 28}px)` }],
      { duration: 380, easing: "ease-out" }
    );
    s.lastHopAt = performance.now();
  }
  function onPlayerInteract(s) {
    s.needs.social = Math.min(100, s.needs.social + 40);
    s.needs.fun    = Math.min(100, s.needs.fun + 25);
    setMood(s, moodFrom(s.needs));
    emote(s, "♡");
    hop(s);
  }
  function pickTarget(s) {
    const W = window.innerWidth, H = window.innerHeight;
    const need = Object.entries(s.needs).sort((a, b) => a[1] - b[1])[0];
    const [worstName] = need;
    if (worstName === "social" && flockSprites.size > 1) {
      const others = Array.from(flockSprites.values()).filter((o) => o !== s);
      const peer = others[Math.floor(Math.random() * others.length)];
      s.target = { x: peer.x, y: peer.y, kind: "social", peer };
    } else {
      s.target = {
        x: 80 + Math.random() * (W - 160),
        y: 140 + Math.random() * (H - 340),
        kind: worstName,
      };
    }
  }
  function tick(now) {
    const dt = Math.min(64, now - (tick._last || now));
    tick._last = now;
    const dts = dt / 1000;
    for (const s of flockSprites.values()) {
      for (const k in NEEDS_DECAY) s.needs[k] = Math.max(0, s.needs[k] - NEEDS_DECAY[k] * dts);
      setMood(s, moodFrom(s.needs));
      if (!s.target) pickTarget(s);
      const dx = s.target.x - s.x, dy = s.target.y - s.y;
      const dist = Math.hypot(dx, dy);
      const speed = 0.06;
      if (dist > 4) {
        s.x += (dx / dist) * speed * dt;
        s.y += (dy / dist) * speed * dt;
      } else {
        if (s.target.kind === "social" && s.target.peer) {
          s.needs.social = Math.min(100, s.needs.social + 30);
          s.target.peer.needs.social = Math.min(100, s.target.peer.needs.social + 30);
          emote(s, "♡"); emote(s.target.peer, "♡");
          hop(s); hop(s.target.peer);
        } else if (s.target.kind === "hunger") {
          s.needs.hunger = Math.min(100, s.needs.hunger + 40); emote(s, "🌾");
        } else if (s.target.kind === "energy") {
          s.needs.energy = Math.min(100, s.needs.energy + 50); emote(s, "☾");
        } else if (s.target.kind === "fun") {
          s.needs.fun = Math.min(100, s.needs.fun + 40); emote(s, "♪"); hop(s);
        }
        s.target = null;
      }
      if (s.mood === "playful" && now - s.lastHopAt > 4000 && Math.random() < 0.005) hop(s);
      if (now - s.lastEmoteAt > 4500 && Math.random() < 0.004) {
        const set = MOOD_EMOTES[s.mood] || MOOD_EMOTES.happy;
        emote(s, set[Math.floor(Math.random() * set.length)]);
      }
      place(s);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function syncFlock() {
    const graduates = readGraduates();
    const seen = readSeenIds();
    let dirty = false;
    for (const g of graduates) {
      const fresh = !seen.has(g.id);
      if (fresh) {
        flashGradNotice(g.name || g.id);
        seen.add(g.id);
        dirty = true;
      }
      spawnFlockSprite(g, fresh);
    }
    if (dirty) writeSeenIds(seen);
  }
  syncFlock();
  setInterval(syncFlock, 2000);
})();
