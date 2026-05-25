// main.js
// -----------------------------------------------------------------------------
// Boot the world, lay out the eggs in a pleasing arrangement, build the roster,
// wire up tap-to-hatch / drag / pet, and run the per-frame tick. Solis is held
// back until the other eight are at high joy — she's the surprise.

(function () {
  "use strict";

  const world = new window.World();
  const STAGE = document.getElementById("stage");
  const WORLD_SVG = document.getElementById("world");
  const ACTOR_LAYER = document.getElementById("actor-layer");

  // The 8 visible eggs sit on a gentle curve along the ground. Solis is hidden
  // initially — she only appears once the others are content.
  const PUBLIC_CHARS = window.CHARACTERS.filter((c) => !c.secret);
  const SECRET = window.CHARACTERS.find((c) => c.secret);
  let solisRevealed = false;

  // ---- Layout ---------------------------------------------------------------

  function eggPositions(n) {
    // Evenly distribute across the ground, alternating slightly above/below.
    const pad = 160;
    const usable = 1600 - pad * 2;
    const positions = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const x = pad + t * usable;
      const yOff = Math.sin(i * 1.7) * 14;
      // Aurora's egg floats up in the sky.
      const id = PUBLIC_CHARS[i].id;
      const y = id === "aurora" ? 280 : id === "bubble" ? 720 : 740 + yOff;
      positions.push({ x, y });
    }
    return positions;
  }

  // ---- Build eggs & roster --------------------------------------------------

  const positions = eggPositions(PUBLIC_CHARS.length);
  PUBLIC_CHARS.forEach((c, i) => {
    const p = positions[i];
    world.placeEgg(c, p.x, p.y);
  });

  function buildRoster() {
    const roster = document.getElementById("roster");
    roster.innerHTML = "";
    // Order: keep the canonical order of CHARACTERS.
    for (const c of window.CHARACTERS) {
      if (c.secret && !solisRevealed) continue;
      const slot = document.createElement("div");
      slot.className = "slot locked";
      slot.dataset.id = c.id;
      slot.innerHTML = `<svg viewBox="-30 -30 60 60">${c.eggSvg()}</svg>`;
      slot.title = c.name + " — not yet hatched";
      roster.appendChild(slot);
    }
  }
  buildRoster();

  function refreshRosterFor(actor) {
    const slot = document.querySelector(`.slot[data-id="${actor.id}"]`);
    if (!slot) return;
    slot.classList.remove("locked");
    slot.title = actor.name + " — click to focus, tap pip for " + actor.def.specialLabel;
    slot.innerHTML = `<svg viewBox="-50 -50 100 100">${actor.def.bodySvg.call(actor.def)}</svg>` +
                     `<span class="pip">!</span>`;
    slot.onclick = (ev) => {
      ev.stopPropagation();
      world.focusActor(actor);
    };
    // Pip = quick fire special.
    const pip = slot.querySelector(".pip");
    pip.onclick = (ev) => {
      ev.stopPropagation();
      if (!world.useSpecial(actor)) world.toast(actor.name + " is still gathering themselves...");
    };
  }

  // ---- Input: tap, drag, pet -------------------------------------------------

  // We use pointer events on the world SVG and dispatch based on what was hit.
  let drag = null; // { actor, dx, dy, moved }

  WORLD_SVG.addEventListener("pointerdown", (ev) => {
    const eggG = ev.target.closest(".egg");
    const actorG = ev.target.closest(".actor");
    const bubbleG = ev.target.closest(".bubble");

    if (bubbleG) return; // bubble has its own click handler

    if (eggG) {
      const id = eggG.dataset.char;
      const actor = world.tapEgg(id);
      if (actor) {
        refreshRosterFor(actor);
        checkSolisGate();
      }
      return;
    }

    if (actorG) {
      const id = actorG.dataset.id;
      const actor = world.actors.find((a) => a.id === id);
      if (!actor) return;
      const v = world.clientToView(ev.clientX, ev.clientY);
      drag = { actor, dx: v.x - actor.x, dy: v.y - actor.y, moved: false, downAt: performance.now() };
      actorG.classList.add("grabbing");
      WORLD_SVG.setPointerCapture(ev.pointerId);
    }
  });

  WORLD_SVG.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const v = world.clientToView(ev.clientX, ev.clientY);
    const nx = v.x - drag.dx;
    const ny = v.y - drag.dy;
    const dx = nx - drag.actor.x;
    const dy = ny - drag.actor.y;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    drag.actor.x = Math.max(40, Math.min(1560, nx));
    // y is constrained by per-character logic in tick, but we let drag bend it.
    if (drag.actor.id === "aurora") {
      drag.actor.y = Math.max(80, Math.min(500, ny));
    } else if (drag.actor.id === "bubble") {
      drag.actor.y = Math.max(500, Math.min(820, ny));
    }
  });

  function endDrag(ev) {
    if (!drag) return;
    drag.actor.el.classList.remove("grabbing");
    if (!drag.moved && performance.now() - drag.downAt < 400) {
      // It was a tap, not a drag → pet.
      world.petActor(drag.actor);
      world.focusActor(drag.actor);
    }
    drag = null;
  }
  WORLD_SVG.addEventListener("pointerup", endDrag);
  WORLD_SVG.addEventListener("pointercancel", endDrag);

  // ---- Solis gate -----------------------------------------------------------

  function checkSolisGate() {
    if (solisRevealed) return;
    // Need all 8 hatched and joy >= 0.7 each.
    const hatched = world.actors.filter((a) => !a.def.secret);
    if (hatched.length < PUBLIC_CHARS.length) return;
    if (!hatched.every((a) => a.joy >= 0.7)) return;
    revealSolis();
  }

  function revealSolis() {
    solisRevealed = true;
    // Place Solis's egg dead center, slightly above the ground, with a sun glow.
    world.placeEgg(SECRET, 800, 580);
    buildRoster();
    refreshActiveRosterSlots();
    world.toast("Something stirs. The First Egg is waking.");
  }

  function refreshActiveRosterSlots() {
    // After buildRoster rebuilds, re-attach handlers for already-hatched actors.
    for (const a of world.actors) refreshRosterFor(a);
  }

  // ---- Inspector close ------------------------------------------------------

  document.getElementById("inspector-close").onclick = () => world.closeInspector();

  // ---- Welcome dismiss ------------------------------------------------------

  const welcome = document.getElementById("welcome");
  const dismiss = () => welcome.classList.add("hide");
  document.getElementById("welcome-go").onclick = dismiss;
  welcome.addEventListener("click", (ev) => {
    if (ev.target === welcome) dismiss();
  });

  // ---- Joy counter (HUD) ----------------------------------------------------

  function updateJoyPill() {
    const total = window.CHARACTERS.length;
    const hatched = world.actors.length;
    document.getElementById("joy-label").textContent = hatched + " / " + total + " hatched";
  }

  // ---- Game loop ------------------------------------------------------------

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(50, now - last);
    last = now;
    world.tick(dt);
    updateJoyPill();
    // Solis gate is checked occasionally (joy creeps up over time).
    if (!solisRevealed && world.actors.length >= PUBLIC_CHARS.length) checkSolisGate();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Expose for debugging in the browser console.
  window.__world = world;
})();
