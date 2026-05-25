// main3d.js
// -----------------------------------------------------------------------------
// Boots three.js + OrbitControls, wires raycaster picking (tap egg → hatch,
// tap actor → pet+focus, tap memory bubble → pop), builds the roster, runs the
// game loop. Solis hatches once the other 8 reach joy >= 0.7.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CHARACTERS } from "./characters3d.js";
import { World } from "./world3d.js";

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
window.__world = world;

// ---- Eggs in a circle around the center ----------------------------------

const PUBLIC_CHARS = CHARACTERS.filter((c) => !c.secret);
const SECRET = CHARACTERS.find((c) => c.secret);
let solisRevealed = false;

PUBLIC_CHARS.forEach((c, i) => {
  const ang = (i / PUBLIC_CHARS.length) * Math.PI * 2;
  const r = 10;
  const y = c.flying ? 8 : c.floating ? 2 : 0.55;
  world.placeEgg(c, new THREE.Vector3(Math.cos(ang) * r, y, Math.sin(ang) * r));
});

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
    // Color swatch placeholder until they hatch; replaced with mini render on hatch.
    const swatch = document.createElement("div");
    swatch.className = "slot-swatch";
    swatch.style.background = "#" + c.palette.body.toString(16).padStart(6, "0");
    slot.appendChild(swatch);
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
      refreshRosterFor(newActor);
      checkSolisGate();
    }
  } else if (drag.kind === "actor" && !drag.moved && wasShort) {
    const actor = world.actors.find((a) => a.mesh === drag.obj);
    if (actor) {
      world.petActor(actor);
      world.focusActor(actor);
    }
  } else if (drag.kind === "bubble" && !drag.moved) {
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

// ---- Welcome dismiss ------------------------------------------------------

const welcome = document.getElementById("welcome");
const dismiss = () => welcome.classList.add("hide");
document.getElementById("welcome-go").onclick = dismiss;

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
