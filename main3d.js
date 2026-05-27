// main3d.js
// -----------------------------------------------------------------------------
// Boots three.js + OrbitControls, wires raycaster picking (tap egg → hatch,
// tap actor → pet+focus, tap memory bubble → pop), builds the roster, runs the
// game loop. Solis hatches once the other 8 reach joy >= 0.7.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CHARACTERS } from "./characters3d.js";
import { World } from "./world3d.js";
import { audio } from "./audio.js";
import { ACCELERATORS, ACCELERATOR_BY_ID, beginPurchase, consumeRedirect, applyAccelerator } from "./payments.js";
import { Care, PRIZE_THRESHOLDS } from "./care.js";

// Blue Chicken's Tamagotchi-style care state. Distinct localStorage key from
// the world snapshot so resetting the prize-animal progression doesn't wipe
// Blue's wellbeing (or vice versa).
const care = new Care();
window.__care = care;

// ---- Renderer / Scene / Camera --------------------------------------------

const canvas = document.getElementById("webgl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
// Closer default than before — the previous 14/10/22 placed the camera so far
// the ring of eggs at radius 10 read as little ground dots. This frames the
// whole ring of unhatched eggs in view, with the ground glowing under each.
camera.position.set(8, 7, 16);
camera.lookAt(0, 1.0, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.maxPolarAngle = Math.PI / 2.05;  // don't dip below the ground
controls.minDistance = 4;
controls.maxDistance = 50;
controls.update();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- World ----------------------------------------------------------------

const world = new World({ renderer, scene, camera });
world.audio = audio;
// Hand the world a reference to OrbitControls so its setView() can animate
// the orbit target — without this, controls.update() snaps lookAt back each
// frame and the camera tween fights itself.
world._orbit = controls;
window.__world = world;

// Preload painted portrait textures (and any GLBs if they exist). Missing
// files are silently fine — the procedural mesh is used as fallback. Once
// the textures land, any actor we already spawned (from a restored session)
// gets rebuilt as a sprite so it doesn't stay stuck in the procedural fallback.
world.preloadModels(CHARACTERS).then(() => {
  for (const actor of world.actors) {
    if (actor.mesh && !actor.mesh.userData.isSpriteActor) {
      world.rebuildActor(actor);
    }
  }
});

// ---- Restore + place Blue's egg (other 8 are prize-gated) ----------------

const PUBLIC_CHARS = CHARACTERS.filter((c) => !c.secret);
const PRIZE_CHARS = PUBLIC_CHARS.filter((c) => !c.isGateway);
const BLUE = PUBLIC_CHARS.find((c) => c.isGateway);
const SECRET = CHARACTERS.find((c) => c.secret);
const CHAR_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
let solisRevealed = false;

const snap = world.loadSnapshot();

// Helper: compute a spot on the home ring for a character at index i.
// Blue gets the center; prize animals fan out around her at equal angles.
function prizePos(i, totalPrizes) {
  const ang = (i / totalPrizes) * Math.PI * 2;
  const r = 10;
  return [Math.cos(ang) * r, Math.sin(ang) * r];
}

// Always: Blue's egg/actor first. She's at the center of the ring (0, *, 0).
if (world.hatched && world.hatched[BLUE.id]) {
  const actor = world._spawnActor(BLUE, new THREE.Vector3(0, 0, 0));
  const saved = world._loadedActors && world._loadedActors[BLUE.id];
  if (saved) {
    if (typeof saved.joy === "number") actor.joy = saved.joy;
    if (saved.mood) actor.mood = saved.mood;
  }
  refreshRosterFor(actor);
} else {
  world.placeEgg(BLUE, new THREE.Vector3(0, 0.55, 0));
}

// Prize animals: only place their egg if they were previously unlocked (via
// past bond progression) — or hatched. New players start with Blue ONLY; the
// prize roster expands as bond rises.
PRIZE_CHARS.forEach((c, i) => {
  const [x, z] = prizePos(i, PRIZE_CHARS.length);
  if (world.hatched && world.hatched[c.id]) {
    const restorePos = new THREE.Vector3(x * 0.6, 0, z * 0.6);
    const actor = world._spawnActor(c, restorePos);
    const saved = world._loadedActors && world._loadedActors[c.id];
    if (saved && typeof saved.joy === "number") actor.joy = saved.joy;
    refreshRosterFor(actor);
  } else if (care.s.unlocked[c.id]) {
    // Was unlocked via bond in a prior session but not yet hatched — place egg.
    const y = c.flying ? 8 : c.floating ? 2 : 0.55;
    world.placeEgg(c, new THREE.Vector3(x, y, z));
  }
  // else: still locked, no egg in world yet. Will drop in via dropPrizeEgg().
});

if (snap && snap.hatched && (snap.hatched[SECRET.id] || snap.flags?.solisRevealed)) {
  solisRevealed = true;
  if (world.hatched[SECRET.id]) {
    world._spawnActor(SECRET, new THREE.Vector3(0, 0, 0));
  } else {
    world.placeEgg(SECRET, new THREE.Vector3(0, 2.5, 0));
  }
}

// Drop a prize-animal egg into the world. Called when bond crosses a
// threshold (in the game loop). Animates the egg falling in from above so
// the player notices.
function dropPrizeEgg(charId) {
  const c = CHAR_BY_ID[charId];
  if (!c) return;
  if (world.eggs[charId] || world.actors.find((a) => a.id === charId)) return;
  const i = PRIZE_CHARS.indexOf(c);
  const [x, z] = prizePos(i, PRIZE_CHARS.length);
  const y = c.flying ? 8 : c.floating ? 2 : 0.55;
  world.placeEgg(c, new THREE.Vector3(x, y, z));
  world.toast(`${c.name}'s egg appeared — Blue's care brought it.`);
}

// ---- V1 → Realm egg pipeline --------------------------------------------
// The top-level router (router.js, only present when the Realm is loaded
// inside the iframe shell) signals "Cluckbot laid an egg" by bumping a
// localStorage key. We watch the key and, on each delta, drop the next
// prize hatchling in line. Standalone (when realm.html is loaded directly)
// the key never moves, and this is dormant.
const PIPELINE_SIGNAL_KEY = "bluechicken/egg-pipeline/signal";
const PIPELINE_CONSUMED_KEY = "bluechicken/egg-pipeline/consumed";
let _pipelineLastTs = 0;
function consumeOnePipelineEgg() {
  // Pick the next prize hatchling that hasn't yet been unlocked.
  const next = PRIZE_THRESHOLDS.find((t) => !care.s.unlocked[t.id]);
  if (!next) return false;
  care.s.unlocked[next.id] = true;
  care._save && care._save();
  dropPrizeEgg(next.id);
  // Also notify via care so the codex/listeners pick it up.
  if (typeof care._notify === "function") care._notify();
  return true;
}
function pollEggPipeline() {
  let raw;
  try { raw = localStorage.getItem(PIPELINE_SIGNAL_KEY); } catch (_) { return; }
  if (!raw) return;
  let signal;
  try { signal = JSON.parse(raw); } catch (_) { return; }
  if (!signal || !signal.ts || signal.ts === _pipelineLastTs) return;
  _pipelineLastTs = signal.ts;
  const delta = Math.max(1, Math.min(8, signal.delta || 1));
  let consumed = 0;
  try { consumed = JSON.parse(localStorage.getItem(PIPELINE_CONSUMED_KEY) || "0"); } catch (_) {}
  let dropped = 0;
  for (let i = 0; i < delta; i++) {
    if (consumeOnePipelineEgg()) dropped++;
  }
  try { localStorage.setItem(PIPELINE_CONSUMED_KEY, JSON.stringify(consumed + dropped)); } catch (_) {}
  // Force-refresh visibility so the new egg respects the current view mode.
  world._applyViewVisibility();
}
// Poll once on boot (catches eggs piped while the realm wasn't loaded), and
// then every 2s thereafter.
pollEggPipeline();
setInterval(pollEggPipeline, 2000);

// ---- Roster ---------------------------------------------------------------

function buildRoster() { /* V1 PRD: no roster strip; codex replaces it */ }
buildRoster();

function refreshRosterFor(actor) { /* no-op in V1 PRD layout */ }

// ---- Raycaster picking ----------------------------------------------------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let drag = null;

function setPointer(ev) {
  pointer.x = (ev.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(ev.clientY / window.innerHeight) * 2 + 1;
}

function pickAtPointer() {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(scene.children, true);
  for (const h of hits) {
    // Walk up to find a useful userData ancestor.
    let n = h.object;
    while (n) {
      if (n.userData.kind === "egg") return { kind: "egg", obj: n, point: h.point };
      if (n.userData.kind === "actor") return { kind: "actor", obj: n, point: h.point };
      if (n.userData.isBubble) return { kind: "bubble", obj: n, point: h.point };
      if (n.userData.eggRef) return { kind: "egg", obj: n.userData.eggRef, point: h.point };
      if (n.userData.actorRef) return { kind: "actor", obj: n.userData.actorRef, point: h.point };
      n = n.parent;
    }
  }
  return null;
}

canvas.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0) return; // left only
  setPointer(ev);
  const hit = pickAtPointer();
  if (!hit) return;
  // Tapping eggs/actors should override orbit controls' drag behavior for this gesture.
  controls.enabled = false;
  drag = {
    kind: hit.kind,
    obj: hit.obj,
    startX: ev.clientX, startY: ev.clientY,
    downAt: performance.now(),
    moved: false,
  };
  ev.preventDefault();
});

// Hover cursor — make eggs/actors discoverable: when the pointer crosses one,
// the cursor turns into a pointer so the user reads "this is clickable."
canvas.addEventListener("pointermove", (ev) => {
  if (!drag) {
    setPointer(ev);
    const hit = pickAtPointer();
    canvas.style.cursor = hit ? "pointer" : "default";
    return;
  }
  const dx = ev.clientX - drag.startX;
  const dy = ev.clientY - drag.startY;
  if (Math.hypot(dx, dy) > 6) drag.moved = true;
  if (drag.kind === "actor" && drag.moved) {
    // Drag the actor along the ground plane.
    setPointer(ev);
    raycaster.setFromCamera(pointer, camera);
    // Intersect a horizontal plane at the actor's current y.
    const actor = world.actors.find((a) => a.mesh === drag.obj);
    if (!actor) return;
    const planeY = actor.def.flying ? 6 : actor.def.floating ? 1.5 : 0.6;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
    const point = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, point);
    if (point && Number.isFinite(point.x)) {
      actor.mesh.position.x = Math.max(-26, Math.min(26, point.x));
      actor.mesh.position.z = Math.max(-26, Math.min(26, point.z));
    }
  }
});

canvas.addEventListener("pointerup", (ev) => {
  if (!drag) { controls.enabled = true; return; }
  const wasShort = performance.now() - drag.downAt < 400;
  if (drag.kind === "egg" && !drag.moved) {
    const charId = drag.obj.userData.charId;
    const newActor = world.tapEgg(charId);
    if (newActor) {
      audio.hatch();
      refreshRosterFor(newActor);
      showReveal(newActor.def);
      checkSolisGate();
    } else {
      audio.tap();
    }
  } else if (drag.kind === "actor" && !drag.moved && wasShort) {
    const actor = world.actors.find((a) => a.mesh === drag.obj);
    if (actor) {
      audio.pet();
      world.petActor(actor);
      world.focusActor(actor);
    }
  } else if (drag.kind === "bubble" && !drag.moved) {
    audio.pop();
    world.popBubble(drag.obj);
  }
  drag = null;
  controls.enabled = true;
});
canvas.addEventListener("pointercancel", () => { drag = null; controls.enabled = true; });

// ---- Solis gate -----------------------------------------------------------

function checkSolisGate() {
  if (solisRevealed) return;
  const hatched = world.actors.filter((a) => !a.def.secret);
  if (hatched.length < PUBLIC_CHARS.length) return;
  if (!hatched.every((a) => a.joy >= 0.7)) return;
  revealSolis();
}

function revealSolis() {
  solisRevealed = true;
  world.placeEgg(SECRET, new THREE.Vector3(0, 2.5, 0));
  buildRoster();
  for (const a of world.actors) refreshRosterFor(a);
  world.toast("Something stirs at the center of the world. The First Egg is waking.");
}

// ---- Inspector close ------------------------------------------------------

// Inspector removed in V1 PRD layout; codex replaces it.

// ---- Discovery codex ------------------------------------------------------

const codex = document.getElementById("codex");
const codexPortrait = document.getElementById("codex-portrait");
const codexName = document.getElementById("codex-name");
const codexRole = document.getElementById("codex-role");
const codexStory = document.getElementById("codex-story");
const codexDiscoveries = document.getElementById("codex-discoveries");
const codexThumbs = document.getElementById("codex-thumbs");
let codexActiveId = null;

function openCodex() {
  audio.init();
  // Default to focused actor, else the most recently hatched, else first hatched.
  const hatched = world.actors.slice();
  const chosen =
    (world.focus && hatched.find((a) => a.id === world.focus.id)) ||
    hatched[hatched.length - 1] ||
    null;
  populateCodex(chosen ? chosen.def : CHARACTERS[0]);
  codex.hidden = false;
}
function closeCodex() { codex.hidden = true; }
document.getElementById("codex-toggle").onclick = openCodex;
document.getElementById("codex-close").onclick = closeCodex;
codex.addEventListener("click", (ev) => { if (ev.target === codex) closeCodex(); });
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !codex.hidden) closeCodex();
});

function populateCodex(charDef) {
  codexActiveId = charDef.id;
  codexPortrait.src = charDef.portrait || "";
  codexPortrait.alt = charDef.name;
  codexName.textContent = charDef.name;
  codexRole.textContent = charDef.role;
  codexStory.textContent = charDef.story;
  // Discoveries — fall back to a placeholder line when none yet.
  const lines = world.discoveries[charDef.id] || [];
  codexDiscoveries.innerHTML = "";
  if (lines.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = charDef.secret
      ? "Awaiting awakening…"
      : world.actors.find((a) => a.id === charDef.id)
        ? "Nothing yet — wander with them and see what happens."
        : "Not yet hatched.";
    codexDiscoveries.appendChild(li);
  } else {
    // The discoveries array stores newest-first; the codex reads oldest-first
    // like a journal, so reverse a shallow copy.
    for (const line of lines.slice().reverse()) {
      const li = document.createElement("li");
      li.textContent = line;
      codexDiscoveries.appendChild(li);
    }
  }
  // Bottom thumb row — every character in canonical order. Locked entries
  // are sepia and unclickable until hatched.
  codexThumbs.innerHTML = "";
  const hatchedIds = new Set(world.actors.map((a) => a.id));
  for (const c of CHARACTERS) {
    if (c.secret && !solisRevealed) continue;
    const img = document.createElement("img");
    img.className = "codex-thumb";
    img.src = c.portrait || "";
    img.alt = c.name;
    img.title = c.name;
    if (c.id === codexActiveId) img.classList.add("active");
    if (!hatchedIds.has(c.id)) img.classList.add("locked");
    else img.onclick = () => populateCodex(c);
    codexThumbs.appendChild(img);
  }
}

// ---- Welcome dismiss + splash --------------------------------------------

const welcome = document.getElementById("welcome");

const dismiss = () => {
  welcome.hidden = true;
  // Welcome dismiss is the first user gesture — safe to bring up AudioContext now.
  audio.init();
};
document.getElementById("welcome-go").onclick = dismiss;

// Audio mute / unmute toggle in the HUD.
const audioBtn = document.getElementById("audio-toggle");
function updateAudioBtn() {
  audioBtn.textContent = audio.muted ? "SOUND: OFF" : "SOUND: ON";
  audioBtn.title = audio.muted ? "Unmute" : "Mute";
}
audioBtn.onclick = () => {
  audio.init();
  audio.setMuted(!audio.muted);
  updateAudioBtn();
};
updateAudioBtn();

// ---- Hatch reveal modal --------------------------------------------------

const reveal = document.getElementById("reveal");
const revealPortrait = document.getElementById("reveal-portrait");
const revealName = document.getElementById("reveal-name");
const revealRole = document.getElementById("reveal-role");
const revealStory = document.getElementById("reveal-story");
const revealGo = document.getElementById("reveal-go");

let revealQueue = [];
let revealActive = false;

function showReveal(charDef) {
  revealQueue.push(charDef);
  if (!revealActive) playNextReveal();
}
function playNextReveal() {
  const charDef = revealQueue.shift();
  if (!charDef) { revealActive = false; return; }
  revealActive = true;
  audio.reveal();
  // Restart the entry animation each time.
  reveal.hidden = false;
  reveal.style.animation = "none";
  void reveal.offsetWidth;
  reveal.style.animation = "";
  // If no portrait is available, swap in a colored disc so the modal still works.
  if (charDef.portrait) {
    revealPortrait.src = charDef.portrait;
    revealPortrait.style.background = "#1a1530";
  } else {
    revealPortrait.removeAttribute("src");
    revealPortrait.style.background = "#" + charDef.palette.body.toString(16).padStart(6, "0");
  }
  revealName.textContent = charDef.name;
  revealRole.textContent = charDef.role;
  revealStory.textContent = charDef.story;
}
revealGo.onclick = () => {
  reveal.hidden = true;
  playNextReveal();
};

// ---- Accelerator shop -----------------------------------------------------

const shop = document.getElementById("shop");
const shopGrid = document.getElementById("shop-grid");
const paystub = document.getElementById("paystub");
const paystubTitle = document.getElementById("paystub-title");
const paystubBody = document.getElementById("paystub-body");
const paystubAmount = document.getElementById("paystub-amount");
const paystubConfirm = document.getElementById("paystub-confirm");
let pendingPurchase = null;

function renderShop() {
  shopGrid.innerHTML = "";
  for (const item of ACCELERATORS) {
    const card = document.createElement("div");
    card.className = "shop-item";
    const have = world.accelerators[item.id] || 0;
    card.innerHTML = `
      <div class="shop-item-row">
        <div class="shop-icon">${item.icon}</div>
        <div class="shop-name">${item.name}</div>
        <div class="shop-count">${have ? "owned: " + have : "&nbsp;"}</div>
      </div>
      <div class="shop-desc">${item.blurb}</div>
      <div class="shop-actions">
        <button class="buy-btn">Buy ${item.qty} · $${item.priceUsd.toFixed(2)}</button>
        <button class="use-btn" ${have > 0 ? "" : "disabled"}>Use</button>
      </div>
    `;
    card.querySelector(".buy-btn").onclick = () => initiatePurchase(item);
    card.querySelector(".use-btn").onclick = () => useAccelerator(item);
    shopGrid.appendChild(card);
  }
}

function openShop() {
  audio.init();
  renderShop();
  shop.hidden = false;
}
function closeShop() { shop.hidden = true; }
document.getElementById("shop-toggle").onclick = openShop;
document.getElementById("shop-close").onclick = closeShop;
shop.addEventListener("click", (ev) => { if (ev.target === shop) closeShop(); });

function initiatePurchase(item) {
  const mode = beginPurchase(item);
  if (mode === "stripe") return; // browser is already navigating
  // Mock confirmation flow.
  pendingPurchase = item;
  paystubTitle.textContent = `Pretend-Buy: ${item.name}`;
  paystubBody.textContent = `${item.qty} × ${item.name} — ${item.blurb}`;
  paystubAmount.textContent = item.priceUsd.toFixed(2);
  paystub.hidden = false;
}
// V1 PRD modals use a CANCEL ghost button instead of a × close icon, so the
// old #paystub-close ID may not exist in HTML — guard both bindings.
const _paystubDismiss = () => { paystub.hidden = true; pendingPurchase = null; };
const _paystubClose = document.getElementById("paystub-close");
const _paystubCancel = document.getElementById("paystub-cancel");
if (_paystubClose)  _paystubClose.onclick  = _paystubDismiss;
if (_paystubCancel) _paystubCancel.onclick = _paystubDismiss;
paystub.addEventListener("click", (ev) => {
  if (ev.target === paystub) { paystub.hidden = true; pendingPurchase = null; }
});
paystubConfirm.onclick = () => {
  if (!pendingPurchase) { paystub.hidden = true; return; }
  world.accelerators[pendingPurchase.id] = (world.accelerators[pendingPurchase.id] || 0) + pendingPurchase.qty;
  world._persist();
  world.toast(`+${pendingPurchase.qty} ${pendingPurchase.name}.`);
  paystub.hidden = true;
  pendingPurchase = null;
  renderShop();
};

function useAccelerator(item) {
  const summonSolis = () => {
    if (solisRevealed) return false;
    solisRevealed = true;
    world.flagSeen("solisRevealed");
    if (!world.eggs[SECRET.id] && !world.actors.find((a) => a.id === SECRET.id)) {
      world.placeEgg(SECRET, new THREE.Vector3(0, 2.5, 0));
    }
    buildRoster();
    for (const a of world.actors) refreshRosterFor(a);
    world.toast("Solis stirs — earlier than expected.");
    return true;
  };
  const applied = applyAccelerator(world, item.id, { summonSolis });
  if (applied) {
    world.toast(`Used ${item.name}.`);
    renderShop();
  } else {
    world.toast("Nothing to apply right now.");
  }
}

// Stripe redirect: if we just came back from a real Payment Link, the URL has
// ?paid=<id>&qty=<n>. Grant it now (before the welcome dismiss).
const granted = consumeRedirect(world);
if (granted) {
  world.toast(`+${granted.qty} ${granted.item.name} purchased.`);
}

// ---- Tester / dev panel ---------------------------------------------------

const devpanel = document.getElementById("devpanel");
const devToggleBtn = document.getElementById("dev-toggle");
const devAvailable =
  (typeof location !== "undefined" && new URLSearchParams(location.search).has("dev")) ||
  (typeof localStorage !== "undefined" && localStorage.getItem("bc-dev") === "1");

if (devAvailable) {
  devToggleBtn.hidden = false;
}

function setDev(enabled) {
  devpanel.hidden = !enabled;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("bc-dev", enabled ? "1" : "0");
  }
}
devToggleBtn.onclick = () => setDev(devpanel.hidden);
document.getElementById("devpanel-close").onclick = () => setDev(false);

// Tilde / backtick key toggles the dev panel from anywhere (and surfaces the
// HUD button on first press).
document.addEventListener("keydown", (ev) => {
  if (ev.key === "`" || ev.key === "~") {
    devToggleBtn.hidden = false;
    setDev(devpanel.hidden);
  }
});

let fastTime = false;
const origTimeFlag = (typeof window !== "undefined") ? { } : {};

devpanel.addEventListener("click", (ev) => {
  const dev = ev.target.dataset.dev;
  const eventId = ev.target.dataset.event;
  if (dev) {
    switch (dev) {
      case "skipphase": world.skipTimePhase(); break;
      case "cycle": world.timeIdx = 3; world.timeT = 0; world._applyTimeBlend(0); break;
      case "fasttime": fastTime = !fastTime; ev.target.textContent = fastTime ? "Toggle 1× time (on)" : "Toggle 10× time"; break;
      case "hatchone": {
        const id = Object.keys(world.eggs)[0];
        if (id) {
          const a = world.tapEgg(id) || (function () {
            // Force-hatch
            const e = world.eggs[id]; if (!e) return null;
            e.taps = 5; return world.tapEgg(id);
          })();
          if (a) { refreshRosterFor(a); showReveal(a.def); checkSolisGate(); }
        }
        break;
      }
      case "hatchall": {
        const ids = Object.keys(world.eggs);
        for (const id of ids) {
          const e = world.eggs[id]; if (!e) continue;
          e.taps = 5;
          const a = world.tapEgg(id);
          if (a) { refreshRosterFor(a); checkSolisGate(); }
        }
        world.toast("All eggs hatched.");
        break;
      }
      case "joyall": world.joyBurst(1); world.toast("Joy maxed."); break;
      case "solis": {
        if (!solisRevealed) {
          solisRevealed = true;
          world.flagSeen("solisRevealed");
          world.placeEgg(SECRET, new THREE.Vector3(0, 2.5, 0));
          buildRoster();
          for (const a of world.actors) refreshRosterFor(a);
          world.toast("Solis summoned (dev).");
        }
        break;
      }
      case "freeacc": {
        for (const acc of ACCELERATORS) world.accelerators[acc.id] = (world.accelerators[acc.id] || 0) + 5;
        world._persist();
        world.toast("+5 of each accelerator (dev).");
        break;
      }
      case "opacc": openShop(); break;
      case "reset": world.hardReset(); break;
    }
  } else if (eventId) {
    // Fire the named event via the director if a matching one exists.
    const ev2 = world.events.scheduled.find((e) => e.id === eventId);
    if (ev2) { world.events._fire(ev2); }
    else if (eventId === "auroraBorealis") world.events._fire(world.events.scheduled.find((e) => e.id === "auroraBorealis"));
  }
});

// ---- View switch (Care / Valley) -----------------------------------------
// CARE = close-up Tamagotchi view of Blue, with the barn/coop dressing and
// the action bar surfaced. VALLEY = pulled-back overview of all hatchlings
// with the world stats panel surfaced.

const viewCareBtn   = document.getElementById("view-care");
const viewValleyBtn = document.getElementById("view-valley");

function setBodyView(mode) {
  document.body.classList.toggle("view-care",   mode === "care");
  document.body.classList.toggle("view-valley", mode === "valley");
  viewCareBtn.classList.toggle("active",   mode === "care");
  viewValleyBtn.classList.toggle("active", mode === "valley");
  viewCareBtn.setAttribute("aria-selected",   mode === "care"   ? "true" : "false");
  viewValleyBtn.setAttribute("aria-selected", mode === "valley" ? "true" : "false");
}

function switchView(mode) {
  setBodyView(mode);
  world.setView(mode);
  // Re-target orbit limits per view so the user can't accidentally drag out
  // of the cozy framing in care view.
  if (mode === "care") {
    controls.minDistance = 4;
    controls.maxDistance = 14;
    // Entering care = you came back; Blue walks over to greet you.
    world.attendToBlue(10000);
  } else {
    controls.minDistance = 4;
    controls.maxDistance = 50;
  }
}

viewCareBtn.onclick   = () => { audio.tap(); switchView("care"); };
viewValleyBtn.onclick = () => { audio.tap(); switchView("valley"); };

// Boot in care view — it's the entry / hatching experience.
setBodyView("care");
world.setView("care", { instant: true });

// Hide the controls hint after 9 seconds.

// ---- Joy / hatched pill ---------------------------------------------------

function updateJoyPill() {
  // V1 PRD: #joy-label is gone — coin balance + #stat-hatched now show the
  // count, populated by updateCareHUD each frame. Kept as a no-op so callers
  // outside this file (none today) don't break.
}

// ---- Blue Chicken care HUD (V1 PRD layout) -------------------------------
// Care UI is split across the V1 grid: bars live in the LEFT panel (#careNeeds),
// action buttons in the BOTTOM action bar (#careActions). Topbar shows the
// pet's name + vibe + age. Right panel shows world stats (hatched/next/time/event).

const careNeedsPanel = document.getElementById("careNeeds");
const careActionsPanel = document.getElementById("careActions");
const petNameEl   = document.getElementById("petName");
const petStageEl  = document.getElementById("petStage");
const petAgeEl    = document.getElementById("petAge");
const petVibeEl   = document.getElementById("petVibe");
const coinCountEl = document.getElementById("coinCount");
const statHatchedEl = document.getElementById("stat-hatched");
const statNextEl    = document.getElementById("stat-next");
const statTimeEl    = document.getElementById("stat-time");
const statEventEl   = document.getElementById("stat-event");

const careBars = {
  hunger:      document.getElementById("bar-hunger"),
  energy:      document.getElementById("bar-energy"),
  happiness:   document.getElementById("bar-happiness"),
  cleanliness: document.getElementById("bar-cleanliness"),
  sanity:      document.getElementById("bar-sanity"),
  bond:        document.getElementById("bar-bond"),
};

// Format an age like "12s" / "3m" / "1h 4m" — V1 style.
function fmtAge(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  return h + "h " + (m % 60) + "m";
}

function updateCareHUD() {
  const blue = world.actors.find((a) => a.id === BLUE.id);
  if (!blue) {
    // Pre-hatch: show "egg" stage, no needs panel / action bar.
    careNeedsPanel.hidden = true;
    careActionsPanel.hidden = true;
    petStageEl.textContent = "egg";
    petAgeEl.textContent = "0s";
    petVibeEl.textContent = world.eggs[BLUE.id] ? "Tap her egg six times." : "She's somewhere out here…";
  } else {
    careNeedsPanel.hidden = false;
    careActionsPanel.hidden = false;
    const s = care.s;
    careBars.hunger.style.width      = s.hunger + "%";
    careBars.energy.style.width      = s.energy + "%";
    careBars.happiness.style.width   = s.happiness + "%";
    careBars.cleanliness.style.width = s.cleanliness + "%";
    careBars.sanity.style.width      = s.sanity + "%";
    careBars.bond.style.width        = s.bond + "%";
    petVibeEl.textContent = care.vibe();
    // Age since Blue was hatched (her actor's born timestamp).
    petAgeEl.textContent = fmtAge(performance.now() - blue.born);
    // Stage: chick → teen → adult based on age (matches V1's life-stage idea).
    const aSec = (performance.now() - blue.born) / 1000;
    petStageEl.textContent = aSec < 60 ? "chick" : aSec < 600 ? "teen" : "adult";
    // Disable invalid actions (sleeping = no feed/play; low energy = no play).
    const btn = (k) => document.querySelector(`.action[data-care="${k}"]`);
    if (btn("feed"))  btn("feed").disabled  = s.isSleeping;
    if (btn("play"))  btn("play").disabled  = s.isSleeping || s.energy < 10;
    const sleepBtn = btn("sleep");
    if (sleepBtn) {
      const glyph = sleepBtn.querySelector(".action-glyph");
      const name  = sleepBtn.querySelector(".action-name");
      if (glyph) glyph.textContent = s.isSleeping ? "☼" : "☾";
      if (name)  name.textContent  = s.isSleeping ? "WAKE" : "SLEEP";
    }
  }

  // Right panel: world stats — always populated.
  const total = CHARACTERS.length;
  const hatched = world.actors.length;
  coinCountEl.textContent = hatched + " / " + total;
  statHatchedEl.textContent = hatched + " / " + total;
  const nextPrize = PRIZE_THRESHOLDS.find((t) => !care.s.unlocked[t.id]);
  statNextEl.textContent = nextPrize
    ? `${Math.floor(care.s.bond)}/${nextPrize.bond}`
    : (blue ? "ALL UNLOCKED" : "—");
  statTimeEl.textContent = (world.timeName && world.timeName().toUpperCase()) || "—";
  // Event label updated by EventDirector via world.setEventLabel — we mirror
  // it from #event-label OR from world.events.active.
  statEventEl.textContent = (world.events && world.events.active && world.events.active.label)
    ? world.events.active.label.toUpperCase()
    : "QUIET";
}

// Wire the 5 care buttons. Each invokes Care + plays a soft audio cue.
document.querySelectorAll(".action[data-care]").forEach((btn) => {
  btn.onclick = () => {
    const k = btn.dataset.care;
    let fired = false;
    switch (k) {
      case "feed":  fired = care.feed();  if (fired) audio.tap(); break;
      case "play":  fired = care.play();  if (fired) audio.pet(); break;
      case "pet":   fired = care.pet();   if (fired) audio.pet(); break;
      case "clean": fired = care.clean(); if (fired) audio.pop(); break;
      case "sleep": fired = care.sleep(); break;
    }
    if (fired) {
      // Brief actor reaction: pet/play/feed should jiggle Blue.
      const blue = world.actors.find((a) => a.id === BLUE.id);
      if (blue && k !== "sleep") world.petActor(blue);
      // Tell Blue you're here — extends her "visiting" window so she walks
      // back to the camera if she'd been off playing with a toy.
      world.attendToBlue(8000);
    }
  };
});

// ---- Game loop ------------------------------------------------------------

let last = performance.now();
function frame(now) {
  const dt = Math.min(50, now - last);
  last = now;
  controls.update();
  world._animateCamera(dt);
  // Tester-mode 10× time: feed the world a multiplied dt. Day/night and event
  // scheduler both consume dt, so a single multiplier accelerates everything.
  world.tick(fastTime ? dt * 10 : dt);
  // Blue's care ticks too — needs decay (or sleep regen) over real time.
  care.tick(fastTime ? dt * 10 : dt);
  // Roll any newly-unlocked prize animals into the world as eggs.
  const newlyDropped = care.newlyUnlocked();
  for (const t of newlyDropped) dropPrizeEgg(t.id);
  // If a new prize-egg appeared and we're in care view, keep it hidden until
  // the player switches to the valley view — preserves the cozy close-up.
  if (newlyDropped.length) world._applyViewVisibility();
  updateJoyPill();
  updateCareHUD();
  if (!solisRevealed && world.actors.length >= PUBLIC_CHARS.length) checkSolisGate();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
