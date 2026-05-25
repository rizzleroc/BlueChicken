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
camera.position.set(14, 10, 22);
camera.lookAt(0, 1.5, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.5, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.maxPolarAngle = Math.PI / 2.05;  // don't dip below the ground
controls.minDistance = 6;
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

// ---- Restore prior session, then place remaining eggs --------------------

const PUBLIC_CHARS = CHARACTERS.filter((c) => !c.secret);
const SECRET = CHARACTERS.find((c) => c.secret);
let solisRevealed = false;

// Read any persisted state from a prior session (hatched ids, discoveries,
// flags). After this call, world.hatched is populated; we use it to decide
// whether each character should appear as an egg or be respawned directly.
const snap = world.loadSnapshot();

PUBLIC_CHARS.forEach((c, i) => {
  const ang = (i / PUBLIC_CHARS.length) * Math.PI * 2;
  const r = 10;
  if (world.hatched && world.hatched[c.id]) {
    // Previously hatched — respawn at a random spot inside the home ring with
    // their persisted joy/mood. Do this after preload finishes so sprites land.
    const restorePos = new THREE.Vector3(Math.cos(ang) * r * 0.6, 0, Math.sin(ang) * r * 0.6);
    const actor = world._spawnActor(c, restorePos);
    const saved = world._loadedActors && world._loadedActors[c.id];
    if (saved) {
      if (typeof saved.joy === "number") actor.joy = saved.joy;
      if (saved.mood) actor.mood = saved.mood;
    }
    refreshRosterFor(actor);
  } else {
    const y = c.flying ? 8 : c.floating ? 2 : 0.55;
    world.placeEgg(c, new THREE.Vector3(Math.cos(ang) * r, y, Math.sin(ang) * r));
  }
});
// If Solis was previously revealed, bring her back too.
if (snap && snap.hatched && (snap.hatched[SECRET.id] || snap.flags?.solisRevealed)) {
  solisRevealed = true;
  if (world.hatched[SECRET.id]) {
    world._spawnActor(SECRET, new THREE.Vector3(0, 0, 0));
  } else {
    world.placeEgg(SECRET, new THREE.Vector3(0, 2.5, 0));
  }
}

// ---- Roster ---------------------------------------------------------------

function buildRoster() {
  const roster = document.getElementById("roster");
  roster.innerHTML = "";
  for (const c of CHARACTERS) {
    if (c.secret && !solisRevealed) continue;
    const slot = document.createElement("div");
    slot.className = "slot locked";
    slot.dataset.id = c.id;
    slot.title = c.name + " — not yet hatched";
    // Use the painterly portrait when available; falls back to a color swatch if
    // the asset is missing or fails to load (e.g. while a new run is being generated).
    if (c.portrait) {
      const img = document.createElement("img");
      img.className = "slot-portrait";
      img.src = c.portrait;
      img.alt = c.name;
      img.onerror = () => {
        img.remove();
        const swatch = document.createElement("div");
        swatch.className = "slot-swatch";
        swatch.style.background = "#" + c.palette.body.toString(16).padStart(6, "0");
        slot.insertBefore(swatch, slot.firstChild);
      };
      slot.appendChild(img);
    } else {
      const swatch = document.createElement("div");
      swatch.className = "slot-swatch";
      swatch.style.background = "#" + c.palette.body.toString(16).padStart(6, "0");
      slot.appendChild(swatch);
    }
    const nm = document.createElement("div");
    nm.className = "slot-name";
    nm.textContent = c.name;
    slot.appendChild(nm);
    roster.appendChild(slot);
  }
}
buildRoster();

function refreshRosterFor(actor) {
  const slot = document.querySelector(`.slot[data-id="${actor.id}"]`);
  if (!slot) return;
  slot.classList.remove("locked");
  slot.title = actor.name + " — click to focus; pip fires " + actor.def.specialLabel;
  slot.onclick = (ev) => {
    ev.stopPropagation();
    world.focusActor(actor);
  };
  // Pip button for quick special-fire.
  if (!slot.querySelector(".pip")) {
    const pip = document.createElement("span");
    pip.className = "pip";
    pip.textContent = "!";
    pip.title = actor.def.specialLabel;
    pip.onclick = (ev) => {
      ev.stopPropagation();
      if (!world.useSpecial(actor)) world.toast(actor.name + " is still gathering themselves…");
    };
    slot.appendChild(pip);
  }
}

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

canvas.addEventListener("pointermove", (ev) => {
  if (!drag) return;
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

document.getElementById("inspector-close").onclick = () => world.closeInspector();

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
const welcomeArt = document.getElementById("welcome-art");

// Try to use the generated title image as the splash backdrop. Probe by loading
// it; if it fails we keep the existing radial-gradient fallback baked into CSS.
(function trySplash() {
  const probe = new Image();
  probe.onload = () => { welcomeArt.style.backgroundImage = `url('${probe.src}')`; };
  probe.src = "docs/title.png";
})();

const dismiss = () => {
  welcome.classList.add("hide");
  // Welcome dismiss is the first user gesture — safe to bring up AudioContext now.
  audio.init();
};
document.getElementById("welcome-go").onclick = dismiss;

// Audio mute / unmute toggle in the HUD.
const audioBtn = document.getElementById("audio-toggle");
function updateAudioBtn() {
  audioBtn.textContent = audio.muted ? "🔇" : "🔊";
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

// Hide the controls hint after 9 seconds.
setTimeout(() => document.getElementById("controls-hint").classList.add("fade"), 9000);

// ---- Joy / hatched pill ---------------------------------------------------

function updateJoyPill() {
  const total = CHARACTERS.length;
  const hatched = world.actors.length;
  document.getElementById("joy-label").textContent = hatched + " / " + total + " hatched";
}

// ---- Game loop ------------------------------------------------------------

let last = performance.now();
function frame(now) {
  const dt = Math.min(50, now - last);
  last = now;
  controls.update();
  world.tick(dt);
  updateJoyPill();
  if (!solisRevealed && world.actors.length >= PUBLIC_CHARS.length) checkSolisGate();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
