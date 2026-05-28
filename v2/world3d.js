// world3d.js
// -----------------------------------------------------------------------------
// The 3D world. Owns the scene, lights, terrain, day/night, weather, actors
// and the helpers that characters' specials and events call into.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EventDirector } from "./events.js";

const TIMES = ["dawn", "day", "dusk", "night"];
const TIME_DURATION_MS = 90_000;
const GROUND_RADIUS = 28;

function rand(a, b) { return a + Math.random() * (b - a); }

function std(color, extra = {}) {
  return new THREE.MeshStandardMaterial(Object.assign({
    color, roughness: 0.85, metalness: 0.0, flatShading: true,
  }, extra));
}

export class World {
  constructor({ renderer, scene, camera }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    // Sky background colors per time-of-day. The sun light direction tracks t.
    // Modern cute palette — bright pastel midday, cream dawn, warm dusk,
    // deep but starlit night. Day reads as a friendly Teletubby/Sims meadow.
    this.skyColors = {
      dawn:  new THREE.Color(0xffd4c0),
      day:   new THREE.Color(0xa6d8ff),
      dusk:  new THREE.Color(0xffb3c1),
      night: new THREE.Color(0x1a2050),
    };
    this.fogColors = {
      dawn:  new THREE.Color(0xfde0d0),
      day:   new THREE.Color(0xe2f0ff),
      dusk:  new THREE.Color(0xffd0d4),
      night: new THREE.Color(0x1a234a),
    };
    this.ambientColors = {
      dawn:  new THREE.Color(0xffe4d0),
      day:   new THREE.Color(0xfff8f0),
      dusk:  new THREE.Color(0xffd0c0),
      night: new THREE.Color(0x7898c4),
    };
    this.sunColors = {
      dawn:  new THREE.Color(0xffe6c0),
      day:   new THREE.Color(0xfffae0),
      dusk:  new THREE.Color(0xffbd80),
      night: new THREE.Color(0xc8d4ff),
    };

    this.timeIdx = 1;
    this.timeT = 0;
    this.weather = "clear";

    this.scene.background = this.skyColors.day.clone();
    this.scene.fog = new THREE.Fog(this.fogColors.day.getHex(), 32, 80);

    this._buildLights();
    this._buildSkyDome();
    this._buildCelestial();   // visible sun + moon + pink-tinted clouds
    this._buildMountainRing(); // pastel rolling hills (modern cute)
    this._buildCenterMountain();// glowing-peaked pyramid in the distance
    this._buildGround();
    this._buildFenceRing();    // friendly white picket fence around the pen
    this._scatterScenery();
    this._buildStars();
    this._buildBarn();        // cozy farm dressing visible in CARE view

    this.actors = [];
    this.eggs = {};         // id -> { mesh, taps, charDef }
    this.discoveries = {};  // id -> string[]
    this.bubbles = [];      // memory bubbles (for click pick)
    this.flags = {};        // event flags (e.g. ufo seen)
    this.hatched = {};      // id -> true; rehydrated from localStorage on boot
    this.accelerators = {   // accelerator inventory; tester mode + shop top these up
      sunbeam: 0, hatch_charm: 0, joy_spark: 0, solis_beacon: 0,
    };

    // localStorage key. Bump if the snapshot shape ever breaks back-compat.
    // v2: bumped because v1 saves from earlier iterations could leave a user
    // with only one hatched chick and no eggs visible — fresh slate every
    // time we materially change egg behavior so the world re-presents itself.
    this._saveKey = "bluechicken/hatchling-world/v2";

    this.updaters = []; // per-frame callbacks registered by events

    // Asset caches. modelCache is GLBs (Tripo path), spriteCache is the
    // portrait textures we use to render characters as painted billboards in
    // the 3D scene (Don't-Starve / Paper-Mario style cutouts). Whichever is
    // available is preferred over the procedural buildBody() fallback —
    // _buildActorMesh decides at spawn time.
    this.modelCache = {};
    this.spriteCache = {};
    this.gltfLoader = new GLTFLoader();
    this.textureLoader = new THREE.TextureLoader();

    this.events = new EventDirector(this);

    // DOM hooks
    this.toastEl = document.getElementById("floatMsg");  // V1 PRD: was #toast
    this.eventLabel = document.getElementById("event-label");
    this.timeIcon = document.getElementById("time-icon");
    this.timeLabel = document.getElementById("time-label");
    this.weatherIcon = document.getElementById("weather-icon");
    this.weatherLabel = document.getElementById("weather-label");
    this.joyLabel = document.getElementById("joy-label");
    this.inspector = document.getElementById("inspector");
    this.focus = null;
  }

  // ---- scene scaffolding --------------------------------------------------

  _buildLights() {
    this.ambient = new THREE.AmbientLight(this.ambientColors.day.getHex(), 0.65);
    this.scene.add(this.ambient);

    // hemisphere gives a soft sky/ground bounce
    this.hemi = new THREE.HemisphereLight(0xa9d4ff, 0x49603f, 0.4);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(this.sunColors.day.getHex(), 1.4);
    this.sun.position.set(20, 30, 10);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = 40;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 100;
    this.scene.add(this.sun);
  }

  // Inverted sphere with a per-vertex gradient. We store the vertical "height
  // ratio" per vertex once at boot in this._skyT (NOT in the color attribute,
  // which is going to be repeatedly overwritten with actual colors each frame),
  // then in _applyTimeBlend we sample sky-top/horizon colors and lerp by t
  // into the color attribute.
  _buildSkyDome() {
    const geom = new THREE.SphereGeometry(120, 32, 16);
    const n = geom.attributes.position.count;
    const colors = new Float32Array(n * 3);
    this._skyT = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const y = geom.attributes.position.getY(i);
      const t = THREE.MathUtils.clamp((y + 120) / 240, 0, 1); // 0 horizon, 1 zenith
      this._skyT[i] = t;
      colors[i * 3 + 0] = t;
      colors[i * 3 + 1] = t;
      colors[i * 3 + 2] = t;
    }
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.skyDome = new THREE.Mesh(geom, mat);
    this.skyDome.renderOrder = -1;
    this.scene.add(this.skyDome);
    this.skyTop = new THREE.Color(0x6aa9e3);
    this.skyBottom = new THREE.Color(0xc8e6f7);
  }

  // Visible sun + moon + a handful of fluffy clouds drawn procedurally. These
  // ride above the sky dome so they composite in front of the gradient. The
  // tick loop tracks the sun/moon to the same arc that drives the directional
  // light, so the lit-up disc visually agrees with where the shadows fall.
  _buildCelestial() {
    // Procedural sun texture: bright yellow disc + radial glow.
    const sunTex = this._makeDiscTexture(512, ["#fffbcc", "#ffe98a", "#ffb84a", "rgba(255,184,74,0)"]);
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunTex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.sunSprite.scale.setScalar(18);
    this.scene.add(this.sunSprite);

    // Procedural moon: pale-cream disc + softer halo.
    const moonTex = this._makeDiscTexture(384, ["#fbf6e8", "#dfe4f4", "#9aaad0", "rgba(154,170,208,0)"]);
    this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: moonTex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.moonSprite.scale.setScalar(10);
    this.scene.add(this.moonSprite);

    // Cloud sprites — 5 fluffy clouds scattered around the sky dome. Static
    // positions so the eye finds the same shapes each session.
    const cloudTex = this._makeCloudTexture();
    this.clouds = [];
    const cloudPlacements = [
      { x: -30, y: 28, z: -38, scale: 14 },
      { x:  35, y: 30, z: -42, scale: 18 },
      { x: -45, y: 24, z:  30, scale: 12 },
      { x:  40, y: 26, z:  20, scale: 16 },
      { x:   0, y: 32, z: -55, scale: 22 },
    ];
    for (const p of cloudPlacements) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: cloudTex, transparent: true, depthWrite: false, opacity: 0.85,
      }));
      sprite.position.set(p.x, p.y, p.z);
      sprite.scale.setScalar(p.scale);
      sprite.userData.baseX = p.x;
      sprite.userData.drift = rand(0.02, 0.06);
      this.scene.add(sprite);
      this.clouds.push(sprite);
    }
  }

  // Radial-gradient disc, used for sun + moon. `colors` is an array of
  // colorstops; we space them evenly over the radius.
  _makeDiscTexture(size, colors) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    colors.forEach((col, i) => grad.addColorStop(i / (colors.length - 1), col));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // Bright pillowy clouds — cream-white core blending into a soft baby-pink
  // edge. Reads as the kind of cloud a Teletubby would skip across.
  _makeCloudTexture() {
    const size = 512;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const blobs = [
      [256, 270, 90, 1.0],
      [180, 260, 70, 0.85],
      [330, 260, 80, 0.85],
      [220, 230, 55, 0.7],
      [300, 220, 60, 0.7],
      [260, 215, 50, 0.6],
    ];
    for (const [x, y, r, alpha] of blobs) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0,    `rgba(255,255,255,${alpha})`);
      g.addColorStop(0.55, `rgba(255,232,236,${alpha * 0.7})`);
      g.addColorStop(1,    "rgba(255,220,228,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // V1 PRD: dark purple mountain silhouettes form the horizon ring around
  // the play area. 14 triangle billboards at radius ~32, varied heights,
  // facing inward. Mountains read as a distant horizon rather than a fence.
  _buildMountainRing() {
    const tex = this._makeMountainTexture();
    const RADIUS = 32;
    const COUNT = 14;
    for (let i = 0; i < COUNT; i++) {
      const ang = (i / COUNT) * Math.PI * 2;
      const x = Math.cos(ang) * RADIUS;
      const z = Math.sin(ang) * RADIUS;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false, alphaTest: 0.05,
      }));
      sprite.center.set(0.5, 0);
      // Varied widths/heights so the ring doesn't feel uniform.
      const h = 7 + Math.random() * 5;
      const w = h * (1.4 + Math.random() * 0.6);
      sprite.scale.set(w, h, 1);
      sprite.position.set(x, 0, z);
      this.scene.add(sprite);
    }
  }

  // A taller mountain pyramid stands behind the action with a tiny glowing
  // peak — same V1 trick that draws the eye to the centre of the scene.
  _buildCenterMountain() {
    const tex = this._makeMountainTexture(true);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, alphaTest: 0.05,
    }));
    sprite.center.set(0.5, 0);
    sprite.scale.set(28, 16, 1);
    // Behind the egg ring (z negative = into screen from camera default).
    sprite.position.set(0, 0, -28);
    this.scene.add(sprite);
    // Tiny warm glow at the peak — point light + small additive sprite.
    const peakLight = new THREE.PointLight(0xffe28a, 0.7, 12, 2);
    peakLight.position.set(0, 14, -28);
    this.scene.add(peakLight);
    const peakSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._makeDiscTexture(128, ["#fffbcc", "#ffe98a", "rgba(255,184,74,0)"]),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    peakSprite.scale.setScalar(1.5);
    peakSprite.position.set(0, 14, -28);
    this.scene.add(peakSprite);
  }

  // Cozy farm dressing for the CARE view — a wooden coop behind Blue, a few
  // hay bales, a low fence, a warm lantern. All parented to a single group
  // so setView() can show/hide it in one toggle.
  _buildBarn() {
    const barn = new THREE.Group();
    barn.name = "barn";

    // Wooden plank colors (warm reds/browns) that read in dawn AND night.
    const plankMat = new THREE.MeshStandardMaterial({ color: 0x8a3a2e, roughness: 0.85 });
    const darkPlank = new THREE.MeshStandardMaterial({ color: 0x5a241c, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a1612, roughness: 0.85 });
    const hayMat = new THREE.MeshStandardMaterial({ color: 0xd9a850, roughness: 1 });
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x4a6b3a, roughness: 1 });

    // --- The coop: a small barn behind Blue (negative Z) ---
    const coop = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(5.5, 3.2, 3.6), plankMat);
    body.position.y = 1.6;
    body.castShadow = true; body.receiveShadow = true;
    coop.add(body);
    // Pitched roof (two slanted boxes meeting at a ridge).
    const roofL = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.18, 3.9), roofMat);
    roofL.position.set(-1.0, 3.6, 0);
    roofL.rotation.z = Math.PI * 0.18;
    coop.add(roofL);
    const roofR = roofL.clone();
    roofR.position.x = 1.0;
    roofR.rotation.z = -Math.PI * 0.18;
    coop.add(roofR);
    // Door (dark plank rectangle on the front face).
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.8, 0.08), darkPlank);
    door.position.set(0, 0.9, 1.82);
    coop.add(door);
    // Round window above the door — bright yellow disc (interior lamp glow).
    const windowGeom = new THREE.CircleGeometry(0.36, 24);
    const windowMat = new THREE.MeshBasicMaterial({ color: 0xffd57f, side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
    const win = new THREE.Mesh(windowGeom, windowMat);
    win.position.set(0, 2.4, 1.83);
    coop.add(win);
    // Soft point light inside the window, glow at the door.
    const lamp = new THREE.PointLight(0xffd29a, 0.9, 10, 1.6);
    lamp.position.set(0, 2.4, 1.4);
    coop.add(lamp);

    coop.position.set(0, 0, -5.4);
    barn.add(coop);

    // --- Hay bales, scattered to either side of Blue ---
    const bale = (x, z, rot) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.1, 16), hayMat);
      m.rotation.z = Math.PI / 2;
      m.rotation.y = rot;
      m.position.set(x, 0.6, z);
      m.castShadow = true; m.receiveShadow = true;
      return m;
    };
    barn.add(bale(-3.4, -2.6, 0.2));
    barn.add(bale(-4.2, -1.4, -0.4));
    barn.add(bale(3.6,  -2.4, 0.6));
    barn.add(bale(3.0,  2.6,  -0.3));

    // --- Picket fence: short low posts ringing the front of the scene ---
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0xe7d7b5, roughness: 0.9 });
    for (let i = -3; i <= 3; i++) {
      if (Math.abs(i) <= 1) continue; // gap for camera-facing view of Blue
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.95, 0.15), fenceMat);
      post.position.set(i * 0.9, 0.45, 4.2);
      post.castShadow = true;
      barn.add(post);
    }
    // Two horizontal fence rails connecting the posts.
    const rail = (y, x0, x1) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0), 0.08, 0.08), fenceMat);
      m.position.set((x0 + x1) / 2, y, 4.2);
      return m;
    };
    barn.add(rail(0.65, -2.7, -1.8));
    barn.add(rail(0.40, -2.7, -1.8));
    barn.add(rail(0.65,  1.8,  2.7));
    barn.add(rail(0.40,  1.8,  2.7));

    // --- Soft grass tuft circle around Blue's standing spot ---
    const tuftGeom = new THREE.ConeGeometry(0.14, 0.55, 4);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const r = 2.4 + Math.random() * 1.2;
      const tuft = new THREE.Mesh(tuftGeom, grassMat);
      tuft.position.set(Math.cos(a) * r, 0.28, Math.sin(a) * r);
      tuft.rotation.y = Math.random() * Math.PI;
      tuft.scale.y = 0.7 + Math.random() * 0.6;
      barn.add(tuft);
    }

    // --- Feed bowl in front of Blue (visual hook for "FEED") ---
    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.32, 0.18, 16),
      new THREE.MeshStandardMaterial({ color: 0x6c4a2a, roughness: 0.7 }),
    );
    bowl.position.set(1.4, 0.09, 2.2);
    bowl.castShadow = true; bowl.receiveShadow = true;
    barn.add(bowl);
    const seed = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.36, 0.04, 16),
      new THREE.MeshStandardMaterial({ color: 0xe8c068, roughness: 1 }),
    );
    seed.position.set(1.4, 0.20, 2.2);
    barn.add(seed);

    this.scene.add(barn);
    this.barn = barn;
    // Toys Blue can interact with when nobody's watching her. Each entry is
    // a world position + the kind of interaction (peck = head bob, hop = jump
    // on it). The behavior loop in _tickBlue cycles through these when she's
    // in the "playing" state.
    this.toys = [
      { pos: new THREE.Vector3(1.4, 0.0, 2.2),   kind: "peck",  label: "bowl" },
      { pos: new THREE.Vector3(-3.4, 0.0, -2.6), kind: "hop",   label: "bale" },
      { pos: new THREE.Vector3(-4.2, 0.0, -1.4), kind: "hop",   label: "bale" },
      { pos: new THREE.Vector3(3.6,  0.0, -2.4), kind: "hop",   label: "bale" },
      { pos: new THREE.Vector3(3.0,  0.0,  2.6), kind: "hop",   label: "bale" },
      { pos: new THREE.Vector3(0.0,  0.0, -3.6), kind: "preen", label: "coop" },
    ];
    // The "visit spot" — where Blue stands when she's facing the camera in
    // care view. Slightly in front of center so the camera reads her face on.
    this.visitSpot = new THREE.Vector3(0, 0, 2.5);
  }

  // ------------------------------------------------------------------
  // View modes: "care" (close on Blue, barn dressing visible, prize
  // creatures + their eggs hidden) and "valley" (pulled back, all prize
  // creatures + eggs visible, barn group hidden so the wider valley reads).
  // The frame loop lerps the camera toward this._cameraTarget every tick.
  // ------------------------------------------------------------------
  // ------------------------------------------------------------------
  // V1 inventory → realm props. Every item Cluckbot owns in V1's shop
  // appears as a physical object in the barn (yarn ball, mirror, robot
  // worm, henhouse, fence, disco ball, ...). setInventory is called by
  // main3d.js whenever the V1 inventory localStorage key changes.
  // ------------------------------------------------------------------
  setInventory(itemIds) {
    if (!Array.isArray(itemIds)) itemIds = [];
    if (!this._propGroup) {
      this._propGroup = new THREE.Group();
      this._propGroup.name = "barn-props";
      this.scene.add(this._propGroup);
      // Props belong to the barn aesthetic, so respect view visibility.
      this._propGroup.visible = (this.view === "care");
    }
    // Clear existing props — simpler than diffing, runs at most a few times.
    while (this._propGroup.children.length) {
      const c = this._propGroup.children[0];
      this._propGroup.remove(c);
      c.traverse?.((n) => { if (n.geometry) n.geometry.dispose(); });
    }
    // Each item slots into a fixed barn position so layout stays stable.
    // The full set of V1 shop items + where they go in the coop.
    const SLOTS = {
      lamp:      { pos: [-2.2, 1.6, -3.8], build: () => this._propLamp() },
      dish:      { pos: [-1.0, 0.0,  2.6], build: () => this._propWaterDish() },
      feeder:    { pos: [ 2.2, 0.0, -1.0], build: () => this._propAutoFeeder() },
      bed:       { pos: [ 0.0, 0.0, -4.5], build: () => this._propStrawBed() },
      perch:     { pos: [-1.8, 0.0, -4.0], build: () => this._propPerch() },
      dustbath:  { pos: [-2.6, 0.0,  1.4], build: () => this._propDustBath() },
      ball:      { pos: [ 1.0, 0.0,  0.8], build: () => this._propYarnBall() },
      mirror:    { pos: [ 2.6, 0.0, -3.4], build: () => this._propMirror() },
      worm:      { pos: [-1.2, 0.0,  0.6], build: () => this._propWorm() },
      coop:      { pos: [ 4.6, 0.0, -3.4], build: () => this._propMiniCoop() },
      henhouse:  { pos: [-4.8, 0.0, -3.8], build: () => this._propHenhouse() },
      fence:     { pos: [ 0.0, 0.0,  5.2], build: () => this._propExtraFence() },
      disco:     { pos: [ 0.0, 4.4, -3.0], build: () => this._propDiscoBall() },
      therapist: { pos: [ 3.4, 0.0,  3.4], build: () => this._propTherapist() },
    };
    // Build + place each owned prop, and expose it to Blue's toy loop so she
    // pecks at bowls / hops on bales / etc.
    const newToys = [
      // Built-in barn toys are always available
      { pos: new THREE.Vector3(1.4, 0.0, 2.2),   kind: "peck",  label: "bowl" },
      { pos: new THREE.Vector3(-3.4, 0.0, -2.6), kind: "hop",   label: "bale" },
      { pos: new THREE.Vector3(-4.2, 0.0, -1.4), kind: "hop",   label: "bale" },
      { pos: new THREE.Vector3(3.6,  0.0, -2.4), kind: "hop",   label: "bale" },
      { pos: new THREE.Vector3(3.0,  0.0,  2.6), kind: "hop",   label: "bale" },
      { pos: new THREE.Vector3(0.0,  0.0, -3.6), kind: "preen", label: "coop" },
    ];
    const TOY_KIND = {
      ball: "peck", worm: "peck", mirror: "preen", bed: "preen",
      perch: "hop", dustbath: "preen", dish: "peck", feeder: "peck",
      henhouse: "preen", coop: "preen", disco: "preen", therapist: "preen",
    };
    for (const id of itemIds) {
      const slot = SLOTS[id];
      if (!slot) continue;
      const mesh = slot.build();
      if (!mesh) continue;
      mesh.position.set(slot.pos[0], slot.pos[1], slot.pos[2]);
      mesh.userData.itemId = id;
      this._propGroup.add(mesh);
      // Add to the toy loop if this item has an interaction kind.
      const kind = TOY_KIND[id];
      if (kind) {
        newToys.push({ pos: new THREE.Vector3(slot.pos[0], 0, slot.pos[2]), kind, label: id });
      }
    }
    this.toys = newToys;
    this._inventory = itemIds.slice();
  }

  // Each prop builder returns a small THREE.Group sized for the barn.
  _propLamp() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 8),
      new THREE.MeshStandardMaterial({ color: 0x6b5d3e, roughness: 0.7 }));
    pole.position.y = -0.8; g.add(pole);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.32, 16, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xc8a04a, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide }));
    shade.position.y = 0.05; g.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xfff0b8, transparent: true, opacity: 0.9 }));
    bulb.position.y = -0.10; g.add(bulb);
    const light = new THREE.PointLight(0xffe0a0, 1.2, 8, 1.6);
    light.position.y = -0.10; g.add(light);
    return g;
  }
  _propWaterDish() {
    const g = new THREE.Group();
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.35, 0.18, 18),
      new THREE.MeshStandardMaterial({ color: 0x8d8da3, roughness: 0.5, metalness: 0.3 }));
    bowl.position.y = 0.09; g.add(bowl);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 18),
      new THREE.MeshStandardMaterial({ color: 0x6dc7f5, transparent: true, opacity: 0.78, roughness: 0.15 }));
    water.position.y = 0.20; g.add(water);
    return g;
  }
  _propAutoFeeder() {
    const g = new THREE.Group();
    const hopper = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.30, 0.6, 12),
      new THREE.MeshStandardMaterial({ color: 0x4a5a78, roughness: 0.4, metalness: 0.6 }));
    hopper.position.y = 0.4; g.add(hopper);
    const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.08, 16),
      new THREE.MeshStandardMaterial({ color: 0x6c4a2a, roughness: 0.7 }));
    tray.position.y = 0.04; g.add(tray);
    return g;
  }
  _propStrawBed() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xd9a850, roughness: 1 }));
    base.position.y = 0.09; g.add(base);
    // A few straw tufts pointing up.
    for (let i = 0; i < 10; i++) {
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 4),
        new THREE.MeshStandardMaterial({ color: 0xe9c270, roughness: 1 }));
      tuft.position.set((Math.random() - 0.5) * 1.4, 0.28, (Math.random() - 0.5) * 1.0);
      tuft.rotation.y = Math.random() * Math.PI;
      g.add(tuft);
    }
    return g;
  }
  _propPerch() {
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x8a5c3a, roughness: 0.85 }));
    post.position.y = 0.7; g.add(post);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 8),
      new THREE.MeshStandardMaterial({ color: 0x8a5c3a, roughness: 0.85 }));
    bar.rotation.z = Math.PI / 2; bar.position.y = 1.3; g.add(bar);
    return g;
  }
  _propDustBath() {
    const g = new THREE.Group();
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.5, 0.16, 18),
      new THREE.MeshStandardMaterial({ color: 0x9b8460, roughness: 0.95 }));
    dish.position.y = 0.08; g.add(dish);
    const dust = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.06, 18),
      new THREE.MeshStandardMaterial({ color: 0xc4a878, roughness: 1 }));
    dust.position.y = 0.18; g.add(dust);
    return g;
  }
  _propYarnBall() {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 14),
      new THREE.MeshStandardMaterial({ color: 0xff8fb8, roughness: 0.95 }));
    ball.position.y = 0.22; g.add(ball);
    return g;
  }
  _propMirror() {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xd4af6a, roughness: 0.4, metalness: 0.7 }));
    frame.position.y = 0.45; g.add(frame);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.56),
      new THREE.MeshBasicMaterial({ color: 0xd6e7f0, transparent: true, opacity: 0.85 }));
    glass.position.set(0, 0.45, 0.05); g.add(glass);
    return g;
  }
  _propWorm() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.5, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0xff8a52, roughness: 0.5, metalness: 0.3 }));
    body.rotation.z = Math.PI / 2; body.position.y = 0.1; g.add(body);
    // Eye dots so it reads as a robot worm.
    const eye = (x) => {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x0a0a18 }));
      e.position.set(x, 0.18, 0.07); g.add(e);
    };
    eye(0.27); eye(0.27 - 0.03);
    return g;
  }
  _propMiniCoop() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x8a3a2e, roughness: 0.85 }));
    body.position.y = 0.55; g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 1.4),
      new THREE.MeshStandardMaterial({ color: 0x3a1612, roughness: 0.85 }));
    roof.position.y = 1.15; roof.rotation.z = 0.08; g.add(roof);
    return g;
  }
  _propHenhouse() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.8, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x6b3424, roughness: 0.85 }));
    body.position.y = 0.9; g.add(body);
    const roofL = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, 1.9),
      new THREE.MeshStandardMaterial({ color: 0x2a100c, roughness: 0.85 }));
    roofL.position.set(-0.5, 2.0, 0); roofL.rotation.z = 0.32; g.add(roofL);
    const roofR = roofL.clone();
    roofR.position.x = 0.5; roofR.rotation.z = -0.32;
    g.add(roofR);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.1, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x3a1810, roughness: 0.9 }));
    door.position.set(0, 0.55, 0.92); g.add(door);
    const window = new THREE.Mesh(new THREE.CircleGeometry(0.18, 18),
      new THREE.MeshBasicMaterial({ color: 0xffd57f }));
    window.position.set(-0.7, 1.4, 0.91); g.add(window);
    return g;
  }
  _propExtraFence() {
    const g = new THREE.Group();
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0xe7d7b5, roughness: 0.9 });
    for (let i = -3; i <= 3; i++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), fenceMat);
      post.position.set(i * 0.7, 0.45, 0);
      g.add(post);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.08, 0.06), fenceMat);
    rail.position.y = 0.65; g.add(rail);
    const rail2 = rail.clone(); rail2.position.y = 0.35; g.add(rail2);
    return g;
  }
  _propDiscoBall() {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.35, 20, 16),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 1.0, envMapIntensity: 1.5 }));
    g.add(ball);
    // Spinning ring of point lights — colored hue picks a different shade
    // each frame so the floor gets the rainbow strobe.
    const light = new THREE.PointLight(0xff66ff, 0.9, 8, 1.4);
    g.add(light);
    g.userData.disco = { light };
    return g;
  }
  _propTherapist() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.45),
      new THREE.MeshStandardMaterial({ color: 0xcfc3e8, roughness: 0.4, metalness: 0.5 }));
    body.position.y = 0.45; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xc890ff, roughness: 0.3, metalness: 0.6 }));
    head.position.y = 1.05; g.add(head);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x7fe9ff }));
    eye.position.set(0, 1.06, 0.20); g.add(eye);
    return g;
  }

  setView(mode, opts = {}) {
    const changing = this.view !== mode;
    this.view = mode;
    const instant = !!opts.instant;
    if (changing || instant) {
      if (mode === "care") {
        // Close, slightly above eye-level, looking at the coop / Blue.
        this._cameraTarget = {
          pos:  new THREE.Vector3(0, 2.4, 7.5),
          look: new THREE.Vector3(0, 1.1, 0),
        };
      } else {
        // Wide valley overview — same vantage as the original boot frame.
        this._cameraTarget = {
          pos:  new THREE.Vector3(8, 7, 16),
          look: new THREE.Vector3(0, 1.0, 0),
        };
      }
      if (instant && this._cameraTarget) {
        this.camera.position.copy(this._cameraTarget.pos);
        if (this._orbit) this._orbit.target.copy(this._cameraTarget.look);
        else this.camera.lookAt(this._cameraTarget.look);
        this._cameraTarget = null;
      }
    }
    this._applyViewVisibility();
  }

  _applyViewVisibility() {
    const mode = this.view;
    // Barn only visible in care view.
    if (this.barn) this.barn.visible = (mode === "care");
    if (this._propGroup) this._propGroup.visible = (mode === "care");
    // Hide prize actors + their eggs in care view; restore in valley.
    const showPrize = (mode !== "care");
    for (const a of this.actors) {
      if (a.def.isGateway || a.def.secret) continue; // Blue + Solis always visible
      a.mesh.visible = showPrize;
    }
    for (const id in this.eggs) {
      const e = this.eggs[id];
      if (!e || !e.charDef) continue;
      if (e.charDef.isGateway || e.charDef.secret) continue;
      if (e.mesh) e.mesh.visible = showPrize;
    }
  }

  // Lerp the camera toward this._cameraTarget. Called every frame after
  // controls.update() so OrbitControls' tweak isn't overwritten when no
  // target is set (e.g. user is dragging). Returns true if the controls
  // target needs an update.
  _animateCamera(dt) {
    if (!this._cameraTarget) return;
    const k = 1 - Math.exp(-dt * 0.005); // exponential approach
    this.camera.position.lerp(this._cameraTarget.pos, k);
    // OrbitControls drives lookAt via .target — animate that instead of
    // calling lookAt directly, otherwise the next controls.update() snaps back.
    if (this._orbit) {
      this._orbit.target.lerp(this._cameraTarget.look, k);
    } else {
      this.camera.lookAt(this._cameraTarget.look);
    }
    // Snap + clear once we're close enough.
    if (this.camera.position.distanceTo(this._cameraTarget.pos) < 0.01) {
      this.camera.position.copy(this._cameraTarget.pos);
      if (this._orbit) this._orbit.target.copy(this._cameraTarget.look);
      this._cameraTarget = null;
    }
  }

  // Modern cute hills: sage-blue rolling silhouettes with a creamy snow cap.
  // Pyramid form for the centre mountain, rounded ridges for the ring mountains.
  _makeMountainTexture(isPyramid = false) {
    const W = 512, H = 384;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    // Two-stop gradient — soft pastel blue-green to deeper sage. Reads as a
    // friendly distant landscape rather than ominous mountain silhouettes.
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#aac7dc");
    grad.addColorStop(1, "#7ea8c4");
    ctx.fillStyle = grad;
    ctx.beginPath();
    if (isPyramid) {
      // Symmetric pyramid for the centre mountain
      ctx.moveTo(W / 2, 24);
      ctx.lineTo(W - 40, H);
      ctx.lineTo(40, H);
    } else {
      // Rounded ridge — random control points so each pass looks different
      ctx.moveTo(20, H);
      ctx.lineTo(20, H * 0.78);
      // 3 ridge peaks of slightly different heights
      const peaks = [
        [W * 0.22, H * (0.18 + Math.random() * 0.14)],
        [W * 0.5,  H * (0.06 + Math.random() * 0.12)],
        [W * 0.78, H * (0.22 + Math.random() * 0.16)],
      ];
      ctx.bezierCurveTo(W * 0.10, H * 0.55, peaks[0][0] - 30, peaks[0][1] + 30, peaks[0][0], peaks[0][1]);
      ctx.bezierCurveTo(peaks[0][0] + 50, peaks[0][1] + 50, peaks[1][0] - 50, peaks[1][1] + 50, peaks[1][0], peaks[1][1]);
      ctx.bezierCurveTo(peaks[1][0] + 50, peaks[1][1] + 50, peaks[2][0] - 30, peaks[2][1] + 30, peaks[2][0], peaks[2][1]);
      ctx.bezierCurveTo(W * 0.9, peaks[2][1] + 40, W - 20, H * 0.55, W - 20, H * 0.78);
      ctx.lineTo(W - 20, H);
    }
    ctx.closePath();
    ctx.fill();
    // Cream snow cap — a thin sliver across the top contour so the hill
    // feels lived-in rather than as a flat silhouette.
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "rgba(252, 246, 235, 0.85)";
    ctx.beginPath();
    if (isPyramid) {
      ctx.moveTo(W / 2, 24);
      ctx.lineTo(W / 2 + 60, 90);
      ctx.lineTo(W / 2 - 60, 90);
    } else {
      ctx.moveTo(40, H * 0.32);
      ctx.bezierCurveTo(W * 0.25, H * 0.10, W * 0.75, H * 0.10, W - 40, H * 0.32);
      ctx.bezierCurveTo(W * 0.75, H * 0.20, W * 0.25, H * 0.20, 40, H * 0.32);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  }

  // White picket fence ring — friendly farm-pen marker around the play area.
  // Cheaper than per-plank meshes: one tall thin plank with a pointed top,
  // duplicated around a circle with InstancedMesh-like position scatter.
  _buildFenceRing() {
    const RADIUS = 25;
    const COUNT = 56;
    const plankGeom = new THREE.BoxGeometry(0.16, 1.0, 0.06);
    const plankMat = new THREE.MeshStandardMaterial({
      color: 0xfaf3e0, roughness: 0.7, metalness: 0.02, flatShading: true,
    });
    const pointGeom = new THREE.ConeGeometry(0.12, 0.22, 4);
    const railGeom = new THREE.BoxGeometry(2.9, 0.08, 0.05);
    const railMat = plankMat;
    const group = new THREE.Group();
    for (let i = 0; i < COUNT; i++) {
      const ang = (i / COUNT) * Math.PI * 2;
      const x = Math.cos(ang) * RADIUS;
      const z = Math.sin(ang) * RADIUS;
      const plank = new THREE.Mesh(plankGeom, plankMat);
      plank.position.set(x, 0.5, z);
      plank.castShadow = true;
      plank.receiveShadow = true;
      const point = new THREE.Mesh(pointGeom, plankMat);
      point.position.set(x, 1.1, z);
      plank.rotation.y = -ang;
      point.rotation.y = -ang;
      group.add(plank, point);
      // Horizontal rail every 4th plank (links them visually without paying
      // for one rail per gap).
      if (i % 4 === 0) {
        const rail = new THREE.Mesh(railGeom, railMat);
        rail.position.set(x, 0.7, z);
        rail.rotation.y = -ang + Math.PI / 2;
        group.add(rail);
      }
    }
    this.fenceRing = group;
    this.scene.add(group);
  }

  // (Old _makeFenceTexture kept as a stub for callers, but unused now.)
  _makeFenceTexture() {
    const W = 384, H = 256;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    // posts: 4 evenly-spaced, each with a pointed top
    const postW = 24;
    const xs = [W * 0.13, W * 0.38, W * 0.62, W * 0.87];
    const postTop = 30;
    const postBottom = H - 8;
    const drawPost = (cx) => {
      // shadow
      ctx.fillStyle = "rgba(80, 60, 110, 0.32)";
      ctx.beginPath();
      ctx.moveTo(cx - postW/2 + 3, postTop + 6);
      ctx.lineTo(cx + 3, postTop - 12);
      ctx.lineTo(cx + postW/2 + 3, postTop + 6);
      ctx.lineTo(cx + postW/2 + 3, postBottom + 4);
      ctx.lineTo(cx - postW/2 + 3, postBottom + 4);
      ctx.closePath();
      ctx.fill();
      // post fill
      const grad = ctx.createLinearGradient(cx - postW/2, 0, cx + postW/2, 0);
      grad.addColorStop(0,   "#fffaf2");
      grad.addColorStop(0.6, "#ffffff");
      grad.addColorStop(1,   "#e8dfd0");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(cx - postW/2, postTop + 6);
      ctx.lineTo(cx, postTop - 12);
      ctx.lineTo(cx + postW/2, postTop + 6);
      ctx.lineTo(cx + postW/2, postBottom);
      ctx.lineTo(cx - postW/2, postBottom);
      ctx.closePath();
      ctx.fill();
      // dark outline
      ctx.strokeStyle = "rgba(80,60,110,0.4)";
      ctx.lineWidth = 2;
      ctx.stroke();
    };
    // rails behind posts (drawn first so posts sit on top)
    const drawRail = (y) => {
      ctx.fillStyle = "rgba(80, 60, 110, 0.32)";
      ctx.fillRect(0, y + 3, W, 16);
      const railGrad = ctx.createLinearGradient(0, y, 0, y + 16);
      railGrad.addColorStop(0, "#ffffff");
      railGrad.addColorStop(1, "#e8dfd0");
      ctx.fillStyle = railGrad;
      ctx.fillRect(0, y, W, 16);
      ctx.strokeStyle = "rgba(80,60,110,0.4)";
      ctx.lineWidth = 2;
      ctx.strokeRect(0, y, W, 16);
    };
    drawRail(60);
    drawRail(155);
    for (const x of xs) drawPost(x);
    // tiny pastel flower at the base, V1-style charm
    ctx.fillStyle = "#ffd1e8";
    ctx.beginPath(); ctx.arc(W * 0.5, postBottom - 4, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffe26a";
    ctx.beginPath(); ctx.arc(W * 0.5, postBottom - 4, 2, 0, Math.PI * 2); ctx.fill();

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  }

  _buildGround() {
    // Round disc of ground with subtle vertex noise for organic shape.
    const geom = new THREE.CircleGeometry(GROUND_RADIUS, 64);
    geom.rotateX(-Math.PI / 2);
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      const lump = Math.sin(x * 0.4) * Math.cos(z * 0.4) * 0.2 + Math.sin(r * 0.6) * 0.15;
      pos.setY(i, r < GROUND_RADIUS - 2 ? lump : -0.05);
    }
    geom.computeVertexNormals();

    // Procedural painted texture for the ground — a canvas covered in
    // overlapping splotches of varied greens, with occasional dirt and
    // wildflower-color patches. Generated once at boot.
    const tex = this._makePaintedGroundTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.95, metalness: 0.0,
    });
    this.ground = new THREE.Mesh(geom, mat);
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    // Pond — same kind of painted texture, blue palette, slightly glossy.
    const pondTex = this._makePaintedPondTexture();
    const pond = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 32),
      new THREE.MeshStandardMaterial({
        map: pondTex, roughness: 0.25, metalness: 0.15,
      })
    );
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(8, 0.02, -6);
    pond.receiveShadow = true;
    this.scene.add(pond);
  }

  // Modern cute ground: a cheerful pastel-green meadow with cream
  // dirt patches, candy-colored wildflower tufts, and short grass strokes.
  // The radial highlight sits a touch lighter than the rim so the pen reads
  // as a "soft hill" that lifts toward the centre — Teletubby-grass energy.
  _makePaintedGroundTexture() {
    const size = 1024;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    // Base wash — bright pastel green, slightly lighter in the centre.
    const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.6);
    grad.addColorStop(0, "#c8eea0");
    grad.addColorStop(1, "#8ec96b");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    // Soft cream "dirt" patches — wide, low-opacity blots so the meadow has
    // visual variety without going muddy.
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? "#f7eccd" : "#e8d8a8";
      const x = Math.random() * size, y = Math.random() * size;
      const r = 18 + Math.random() * 36;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // Bright grass tufts — pairs of thin upward strokes in fresh greens.
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.4;
    const grassColors = ["#6fc04a", "#8cd66a", "#4fa83a", "#a0e07a", "#5fb840"];
    for (let i = 0; i < 520; i++) {
      ctx.strokeStyle = grassColors[Math.floor(Math.random() * grassColors.length)];
      const bx = Math.random() * size, by = Math.random() * size;
      const h = 5 + Math.random() * 10;
      ctx.beginPath();
      ctx.moveTo(bx, by); ctx.lineTo(bx - 1, by - h);
      ctx.moveTo(bx, by); ctx.lineTo(bx + 1, by - h);
      ctx.stroke();
    }
    // Candy wildflower clusters — pastel petal rosettes in pink/yellow/blue.
    ctx.globalAlpha = 0.95;
    const flowers = ["#ffb6d6", "#ffe26a", "#a3c8ff", "#ffac6b", "#ffffff", "#ff8aae", "#c4a8ff"];
    for (let i = 0; i < 380; i++) {
      ctx.fillStyle = flowers[Math.floor(Math.random() * flowers.length)];
      const cx = Math.random() * size, cy = Math.random() * size;
      const r = 1.6 + Math.random() * 2.0;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      const petals = 4;
      for (let p = 0; p < petals; p++) {
        const a = (p / petals) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r * 1.5, cy + Math.sin(a) * r * 1.5, r * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  _makePaintedPondTexture() {
    const size = 512;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.5);
    grad.addColorStop(0, "#6fc5e7");
    grad.addColorStop(1, "#2c5f7d");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    // ripple highlights
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 24; i++) {
      ctx.beginPath();
      const x = Math.random() * size, y = Math.random() * size;
      const r = 16 + Math.random() * 48;
      ctx.ellipse(x, y, r, r * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _scatterScenery() {
    // Stable placements: chosen once and re-used whether we render procedural
    // fallbacks now (textures may not have loaded yet) or upgraded sprites
    // later via _upgradeScenery().
    this._treePlacements = [];
    this._rockPlacements = [];
    for (let i = 0; i < 18; i++) {
      const ang = (i / 18) * Math.PI * 2 + rand(-0.2, 0.2);
      const r = rand(GROUND_RADIUS * 0.55, GROUND_RADIUS - 1.5);
      this._treePlacements.push({
        x: Math.cos(ang) * r,
        z: Math.sin(ang) * r,
        scale: rand(0.85, 1.4),
        rot: rand(0, Math.PI * 2),
      });
    }
    for (let i = 0; i < 12; i++) {
      this._rockPlacements.push({
        x: rand(-22, 22), z: rand(-22, 22),
        scale: rand(0.45, 0.85),
      });
    }
    this._treeMeshes = [];
    this._rockMeshes = [];
    this._sceneryUpgradeNeeded = true;
    this._renderScenery(); // procedural fallback for first paint
  }

  _renderScenery() {
    // Remove any prior scenery (used by _upgradeScenery when swapping).
    for (const m of this._treeMeshes) this.scene.remove(m);
    for (const m of this._rockMeshes) this.scene.remove(m);
    this._treeMeshes = [];
    this._rockMeshes = [];

    const haveTree = !!this.treeTexture;
    const haveRock = !!this.rockTexture;

    for (const p of this._treePlacements) {
      if (haveTree) {
        // Painted-tree billboard sprite. Centered at feet (bottom) and scaled
        // so a typical tree reads about 4 world units tall.
        const mat = new THREE.SpriteMaterial({
          map: this.treeTexture, transparent: true, depthWrite: false, alphaTest: 0.05,
        });
        const tree = new THREE.Sprite(mat);
        tree.center.set(0.5, 0);
        tree.scale.setScalar(p.scale * 4.0);
        tree.position.set(p.x, 0, p.z);
        this.scene.add(tree);
        this._treeMeshes.push(tree);
      } else {
        // Procedural fallback: cylinder trunk + 3 stacked cones, used briefly
        // before the painted texture finishes loading.
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.0, 6), std(0x4a2f1a));
        trunk.position.y = 0.5; trunk.castShadow = true; tree.add(trunk);
        for (let s = 0; s < 3; s++) {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.95 - s * 0.18, 1.2 - s * 0.18, 8), std(0x355d2a));
          cone.position.y = 1.1 + s * 0.55; cone.castShadow = true; tree.add(cone);
        }
        tree.position.set(p.x, 0, p.z);
        tree.rotation.y = p.rot;
        tree.scale.setScalar(p.scale);
        this.scene.add(tree);
        this._treeMeshes.push(tree);
      }
    }
    for (const p of this._rockPlacements) {
      if (haveRock) {
        const mat = new THREE.SpriteMaterial({
          map: this.rockTexture, transparent: true, depthWrite: false, alphaTest: 0.05,
        });
        const rock = new THREE.Sprite(mat);
        rock.center.set(0.5, 0);
        rock.scale.setScalar(p.scale * 1.6);
        rock.position.set(p.x, 0, p.z);
        this.scene.add(rock);
        this._rockMeshes.push(rock);
      } else {
        const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(p.scale, 0), std(0x7a8088));
        rock.position.set(p.x, 0.2, p.z);
        rock.castShadow = true; rock.receiveShadow = true;
        this.scene.add(rock);
        this._rockMeshes.push(rock);
      }
    }
  }

  _upgradeScenery() {
    this._renderScenery();
    this._sceneryUpgradeNeeded = false;
  }

  _buildStars() {
    const N = 600;
    const positions = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 80;
      positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = Math.abs(r * Math.cos(phi)); // upper hemisphere only
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.25, sizeAttenuation: true, transparent: true, opacity: 0,
    });
    this.stars = new THREE.Points(geom, this.starMat);
    this.scene.add(this.stars);
  }

  // ---- time / weather -----------------------------------------------------

  timeName() { return TIMES[this.timeIdx]; }

  setWeather(name) {
    this.weather = name;
    const map = {
      clear:    ["·", "Clear"],
      breezy:   ["≈", "Breezy"],
      freezing: ["❄", "Freezing"],
      snowing:  ["❅", "Snowfall"],
      calm:     ["·", "Calm"],
    };
    const [i, l] = map[name] || ["·", "Clear"];
    if (this.weatherIcon)  this.weatherIcon.textContent  = i;
    if (this.weatherLabel) this.weatherLabel.textContent = l;
  }

  cycleTime() {
    this.timeT = TIME_DURATION_MS;
  }

  // ---- tester / accelerator helpers ---------------------------------------

  // Accelerator: instant-hatch one (or every) egg waiting in the world.
  // Returns the number of actors spawned. Called by tester mode AND by the
  // "Hatch Charm" accelerator from the shop.
  instantHatch(charId = null) {
    let spawned = 0;
    const ids = charId ? [charId] : Object.keys(this.eggs);
    for (const id of ids) {
      if (this.hatchEgg(id)) spawned++;
    }
    return spawned;
  }

  // Accelerator: skip forward in time. Useful both for testing the cycle and
  // for the "Sunbeam" purchase that fast-forwards one phase.
  skipTimePhase() {
    this.timeT = TIME_DURATION_MS; // _applyTimeBlend wraps on next tick
  }
  skipMinutes(mins) {
    // Each "minute" in-game is TIME_DURATION_MS/some-factor. Treat 1 IRL minute
    // as 1 in-world phase advance.
    this.timeT += mins * 60_000;
  }

  // Accelerator: bump joy on every hatched character.
  joyBurst(amount = 0.3) {
    for (const a of this.actors) a.joy = Math.min(1, a.joy + amount);
    this._persist();
    if (this.focus) this._refreshInspector();
  }

  // Reset everything persistent. Used by the dev panel.
  hardReset() {
    this.resetSave();
    location.reload();
  }

  // Broadcast a world event to every actor so they can react in character.
  // Each character's def may export reactTo(eventId, world, actor) — anything
  // is fair game: heading bias, joy bump, sprite tint, teleport, etc. Errors
  // are swallowed because one character's broken reaction shouldn't take the
  // event down.
  broadcastEvent(eventId) {
    for (const actor of this.actors) {
      const def = actor.def;
      if (typeof def.reactTo === "function") {
        try { def.reactTo(eventId, this, actor); }
        catch (e) { console.warn("reactTo failed for", actor.id, e); }
      }
    }
  }

  _applyTimeBlend(dt) {
    this.timeT += dt;
    if (this.timeT >= TIME_DURATION_MS) {
      this.timeT -= TIME_DURATION_MS;
      this.timeIdx = (this.timeIdx + 1) % TIMES.length;
      const map = { dawn: ["☼", "Dawn"], day: ["☀", "Day"], dusk: ["☾", "Dusk"], night: ["✦", "Night"] };
      const [icon, label] = map[this.timeName()];
      if (this.timeIcon)  this.timeIcon.textContent  = icon;
      if (this.timeLabel) this.timeLabel.textContent = label;
    }
    // Blend between current and next time-of-day color over the duration.
    const t = this.timeT / TIME_DURATION_MS;
    const cur = TIMES[this.timeIdx];
    const next = TIMES[(this.timeIdx + 1) % TIMES.length];
    this.scene.background.lerpColors(this.skyColors[cur], this.skyColors[next], t);
    this.scene.fog.color.lerpColors(this.fogColors[cur], this.fogColors[next], t);
    this.ambient.color.lerpColors(this.ambientColors[cur], this.ambientColors[next], t);
    this.sun.color.lerpColors(this.sunColors[cur], this.sunColors[next], t);
    // The dome zenith follows the sky background; the horizon picks up the
    // (lighter) fog tint so there's atmospheric perspective. Vertex colors
    // are interpolated per-vertex by `t` already baked into the buffer.
    this.skyTop.lerpColors(this.skyColors[cur], this.skyColors[next], t);
    this.skyBottom.lerpColors(this.fogColors[cur], this.fogColors[next], t);
    if (this.skyDome && this._skyT) {
      const col = this.skyDome.geometry.attributes.color;
      for (let i = 0; i < col.count; i++) {
        const tv = this._skyT[i];
        const r = this.skyBottom.r + (this.skyTop.r - this.skyBottom.r) * tv;
        const g = this.skyBottom.g + (this.skyTop.g - this.skyBottom.g) * tv;
        const b = this.skyBottom.b + (this.skyTop.b - this.skyBottom.b) * tv;
        col.setXYZ(i, r, g, b);
      }
      col.needsUpdate = true;
    }
    // Sun position rides an arc across the cycle. Lights + visible sprite
    // share the same arc — sunSprite is offset further out so it lives on
    // the sky-dome wall.
    const fullT = (this.timeIdx + t) / TIMES.length; // 0..1 over full cycle
    const ang = fullT * Math.PI * 2;
    this.sun.position.set(Math.cos(ang) * 30, Math.max(2, Math.sin(ang) * 30), Math.sin(ang) * 10);
    this.sun.intensity = Math.max(0.05, Math.sin(ang) * 1.6);

    // Visible sun + moon sprites — same arc, larger radius so they sit far in
    // the sky. The moon trails 180° behind the sun so we always have one or
    // the other clearly in view.
    if (this.sunSprite) {
      const sx = Math.cos(ang) * 70;
      const sy = Math.max(-10, Math.sin(ang) * 50);
      const sz = Math.sin(ang) * 20 - 40;
      this.sunSprite.position.set(sx, sy, sz);
      // Fade out below the horizon so we don't see it at night.
      this.sunSprite.material.opacity = Math.max(0, Math.min(1, (sy + 5) / 20));
    }
    if (this.moonSprite) {
      const mang = ang + Math.PI;
      const mx = Math.cos(mang) * 70;
      const my = Math.max(-10, Math.sin(mang) * 50);
      const mz = Math.sin(mang) * 20 - 40;
      this.moonSprite.position.set(mx, my, mz);
      this.moonSprite.material.opacity = Math.max(0, Math.min(1, (my + 5) / 20));
    }
    // Clouds drift slowly with wraparound. Driven by wall-clock so they keep
    // moving regardless of game time.
    if (this.clouds) {
      const now = performance.now() * 0.001;
      for (const c of this.clouds) {
        c.position.x = ((c.userData.baseX + now * c.userData.drift * 3 + 80) % 160) - 80;
      }
    }
    // Stars fade in at night, with a small twinkle (low-amp sinusoidal jitter
    // on the global material opacity — cheap and atmospheric without touching
    // per-vertex attributes).
    const isNight = cur === "night";
    const isDuskOrDawn = cur === "dusk" || cur === "dawn";
    const base = isNight ? 1 : isDuskOrDawn ? 0.4 : 0;
    const twinkle = (isNight ? 0.12 : 0.04) * Math.sin(performance.now() * 0.002);
    const target = Math.max(0, base + twinkle);
    this.starMat.opacity += (target - this.starMat.opacity) * 0.06;
    // Crickets bleed in at night, fade out by day.
    if (this.audio && typeof this.audio.setNightAmbient === "function") {
      const cricketLevel = isNight ? 1 : isDuskOrDawn ? 0.35 : 0;
      this.audio.setNightAmbient(cricketLevel);
    }
  }

  // ---- hatch burst -------------------------------------------------------

  // Painted radial-rays texture — generated once on first hatch and cached.
  _getBurstTexture() {
    if (this._burstTex) return this._burstTex;
    const size = 512;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const cx = size / 2, cy = size / 2;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
    grad.addColorStop(0.00, "rgba(255,250,220,1)");
    grad.addColorStop(0.18, "rgba(255,232,150,0.85)");
    grad.addColorStop(0.45, "rgba(255,200,80,0.35)");
    grad.addColorStop(1.00, "rgba(255,180,40,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    ctx.translate(cx, cy);
    for (let i = 0; i < 22; i++) {
      const ang = (i / 22) * Math.PI * 2 + (Math.random() - 0.5) * 0.06;
      const len = size * (0.32 + Math.random() * 0.16);
      const wid = 12 + Math.random() * 16;
      ctx.save();
      ctx.rotate(ang);
      const g2 = ctx.createLinearGradient(0, 0, len, 0);
      g2.addColorStop(0, "rgba(255,250,220,0.85)");
      g2.addColorStop(1, "rgba(255,210,120,0)");
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.moveTo(0, -wid / 2);
      ctx.quadraticCurveTo(len * 0.55, 0, len, 0);
      ctx.quadraticCurveTo(len * 0.55, 0, 0, wid / 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this._burstTex = tex;
    return tex;
  }

  // The hatch moment: painted-rays sprite expands + a brief warm point light
  // paints the surroundings + eggshell pieces arc out under gravity. The
  // shell colors are drawn from the character's palette so the moment feels
  // tied to the soul that just emerged.
  _hatchBurst(pos, palette) {
    const haloMat = new THREE.SpriteMaterial({
      map: this._getBurstTexture(),
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const halo = new THREE.Sprite(haloMat);
    halo.position.copy(pos);
    halo.scale.setScalar(0.5);
    this.scene.add(halo);

    const flash = new THREE.PointLight(0xffe5a0, 6, 14, 2);
    flash.position.copy(pos).add(new THREE.Vector3(0, 0.4, 0));
    this.scene.add(flash);

    const shells = [];
    const shellColors = [palette.body, palette.belly || palette.body, 0xfff4d8, 0xfff4d8];
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2 + rand(-0.1, 0.1);
      const speed = rand(2.6, 4.6);
      const vy = rand(2.6, 5.4);
      const piece = new THREE.Mesh(
        new THREE.CircleGeometry(rand(0.06, 0.12), 5),
        new THREE.MeshBasicMaterial({
          color: shellColors[i % shellColors.length],
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 1,
        })
      );
      piece.position.copy(pos);
      piece.userData.vx = Math.cos(ang) * speed;
      piece.userData.vz = Math.sin(ang) * speed;
      piece.userData.vy = vy;
      piece.userData.spin = rand(-8, 8);
      piece.userData.rotAxis = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
      this.scene.add(piece);
      shells.push(piece);
    }

    const tStart = performance.now();
    const dur = 1200;
    const gravity = 9.8;
    const step = () => {
      const now = performance.now();
      const dt = (now - tStart) / 1000;
      const t = Math.min(1, (now - tStart) / dur);
      halo.scale.setScalar(0.5 + t * 6);
      haloMat.opacity = 0.95 * (1 - t);
      haloMat.rotation = t * 0.35;
      flash.intensity = 6 * (1 - t) * (1 - t);
      for (const p of shells) {
        p.position.x = pos.x + p.userData.vx * dt;
        p.position.z = pos.z + p.userData.vz * dt;
        p.position.y = pos.y + p.userData.vy * dt - 0.5 * gravity * dt * dt;
        p.rotateOnAxis(p.userData.rotAxis, p.userData.spin * 0.016);
        if (p.position.y < 0.02) {
          p.position.y = 0.02;
          p.userData.vy *= -0.35; p.userData.vx *= 0.6; p.userData.vz *= 0.6;
        }
        p.material.opacity = 1 - t * 0.6;
      }
      if (t < 1) requestAnimationFrame(step);
      else {
        this.scene.remove(halo);
        this.scene.remove(flash);
        for (const p of shells) this.scene.remove(p);
      }
    };
    requestAnimationFrame(step);
  }

  // ---- asset preloading --------------------------------------------------

  // Kick off GLB + portrait-texture loads for every character. Both are
  // best-effort — missing files leave the corresponding cache empty and
  // _buildActorMesh falls back through GLB → sprite → procedural in that
  // priority. Returns a Promise that resolves once all loads have settled.
  preloadModels(charDefs) {
    const promises = [];
    const tried = [];
    for (const c of charDefs) {
      if (c.model) {
        tried.push(c.id);
        promises.push(this._loadGLB(c));
      }
      if (c.portrait) promises.push(this._loadSpriteTexture(c));
    }
    // Also load painted scenery textures used by _scatterScenery. We can't load
    // them during the constructor because TextureLoader is async — and we want
    // the scenery sprites to be ready by the time the user dismisses welcome.
    promises.push(this._loadSceneryTextures());
    return Promise.all(promises).then((r) => {
      // Diagnostic: report which Tripo GLBs landed vs fell back to procedural.
      const loaded = tried.filter((id) => this.modelCache[id]);
      const missing = tried.filter((id) => !this.modelCache[id]);
      if (typeof console !== "undefined") {
        console.log("[realm] GLBs loaded:", loaded.length ? loaded.join(", ") : "(none)");
        if (missing.length) console.log("[realm] procedural fallback for:", missing.join(", "));
      }
      this._modelStatus = { loaded, missing };
      return r;
    });
  }

  _loadSceneryTextures() {
    const loadOne = (key, url) => new Promise((resolve) => {
      this.textureLoader.load(
        url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          this[key] = tex;
          // If scenery has already been scattered procedurally, swap to sprite
          // versions now. (Order: _scatterScenery runs in the constructor with
          // procedural fallback, then textures land and we upgrade in place.)
          if (this._sceneryUpgradeNeeded) this._upgradeScenery();
          resolve();
        },
        undefined,
        () => resolve()
      );
    });
    return Promise.all([
      loadOne("treeTexture", "docs/scenery/tree.png"),
      loadOne("rockTexture", "docs/scenery/rock.png"),
    ]);
  }

  _loadGLB(c) {
    return new Promise((resolve) => {
      this.gltfLoader.load(
        c.model,
        (gltf) => {
          const root = gltf.scene;
          root.traverse((n) => {
            if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; }
          });
          const box = new THREE.Box3().setFromObject(root);
          const size = new THREE.Vector3(); box.getSize(size);
          const height = Math.max(size.y, 0.001);
          const targetHeight = c.modelTargetHeight || 1.4;
          root.scale.setScalar(targetHeight / height);
          const box2 = new THREE.Box3().setFromObject(root);
          const center = new THREE.Vector3(); box2.getCenter(center);
          root.position.x -= center.x;
          root.position.z -= center.z;
          root.position.y -= box2.min.y;
          this.modelCache[c.id] = root;
          resolve();
        },
        undefined,
        () => resolve()
      );
    });
  }

  _loadSpriteTexture(c) {
    return new Promise((resolve) => {
      this.textureLoader.load(
        c.portrait,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.anisotropy = 4;
          this.spriteCache[c.id] = tex;
          resolve();
        },
        undefined,
        () => resolve()
      );
    });
  }

  // ---- actors -------------------------------------------------------------

  placeEgg(charDef, position) {
    // Wrap the egg in a presentation group so we can attach a glowing pedestal
    // halo + a floating name label without those objects' user data competing
    // with raycast picking. Pickable surfaces (the egg ovoid + the halo disc)
    // all walk back to the wrap group via userData.eggRef.
    const wrap = new THREE.Group();
    wrap.position.copy(position);
    wrap.userData = { kind: "egg", charId: charDef.id };

    // Egg geometry from the character (a stylized ovoid + character-specific
    // decorations). Scale up — at the default OrbitControls distance, the
    // original 0.45-radius eggs looked like rounding errors on the ground.
    const eggArt = charDef.buildEgg();
    eggArt.scale.setScalar(1.8);
    eggArt.userData.eggRef = wrap;
    eggArt.traverse((c) => { if (c.isMesh) c.userData.eggRef = wrap; });
    wrap.add(eggArt);

    // Glowing pedestal halo — a flat disc on the ground, additive blended,
    // tinted to the character's accent. Reads as "I'm here, look here" from
    // any camera angle, and the colour hints at who's inside.
    const haloColor = (charDef.palette && (charDef.palette.accent || charDef.palette.body)) || 0xfff4d8;
    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 32),
      new THREE.MeshBasicMaterial({
        color: haloColor,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    halo.rotation.x = -Math.PI / 2;
    // Slightly above the painted ground texture so it isn't z-fought into
    // invisibility. Flying / floating eggs put the halo at y=0 since they
    // shouldn't carry a pedestal at altitude — keep it tied to the ground.
    halo.position.y = -position.y + 0.04;
    halo.userData.eggRef = wrap;
    wrap.add(halo);

    // Floating name label so the user reads "Aurora" / "Magma" / etc. and
    // knows there's something specific waiting in each egg. The label is a
    // canvas-rendered sprite — readable from any camera angle.
    const label = this._makeLabelSprite(charDef.name);
    label.position.y = 1.2;
    label.userData.eggRef = wrap;
    wrap.add(label);

    // Care view shows only Blue's egg + Solis's; prize eggs hide until valley.
    if (this.view === "care" && !charDef.isGateway && !charDef.secret) {
      wrap.visible = false;
    }
    this.scene.add(wrap);
    this.eggs[charDef.id] = {
      mesh: wrap, taps: 0, charDef,
      basePos: position.clone(), bobPhase: Math.random() * 10,
      eggArt, halo, label,
    };
    return wrap;
  }

  // Canvas-painted text sprite. Cached per text string so repeat names don't
  // re-rasterize. Used for the floating egg name labels.
  _makeLabelSprite(text) {
    this._labelCache = this._labelCache || {};
    let tex = this._labelCache[text];
    if (!tex) {
      const w = 384, h = 96;
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, w, h);
      // Painted-card backing so labels stay legible over any 3D backdrop.
      const radius = 18;
      ctx.fillStyle = "rgba(20, 14, 6, 0.55)";
      const pad = 16;
      this._roundRect(ctx, pad, pad, w - pad * 2, h - pad * 2, radius);
      ctx.fill();
      ctx.strokeStyle = "rgba(244, 201, 93, 0.7)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = "italic 40px Cochin, Iowan Old Style, Palatino, Georgia, serif";
      ctx.fillStyle = "#fff5d2";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, w / 2, h / 2 + 2);
      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      this._labelCache[text] = tex;
    }
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const s = new THREE.Sprite(mat);
    s.scale.set(2.4, 0.6, 1);
    return s;
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  tapEgg(charId) {
    const egg = this.eggs[charId];
    if (!egg) return null;
    egg.taps++;
    // wiggle
    egg.wiggleT = performance.now();
    if (egg.taps >= 6) return this.hatchEgg(charId);
    return null;
  }

  hatchEgg(charId) {
    const egg = this.eggs[charId];
    if (!egg) return null;
    const pos = egg.mesh.position.clone();
    this._hatchBurst(pos, egg.charDef.palette);

    this.scene.remove(egg.mesh);
    delete this.eggs[charId];

    const actor = this._spawnActor(egg.charDef, pos);
    this.toast(egg.charDef.name + " has hatched.");
    this.discover(egg.charDef.id, "Hatched at " + this.timeName() + ".");
    this.hatched[charId] = true;
    this._persist();
    return actor;
  }

  _spawnActor(charDef, position) {
    const mesh = this._buildActorMesh(charDef);
    mesh.position.copy(position);
    mesh.position.y = charDef.flying ? 6 : (charDef.floating ? 1.5 : 0.6);
    // Merge userData so we preserve flags set by the mesh builder (notably
    // isSpriteActor) — overwriting would lose them.
    Object.assign(mesh.userData, { kind: "actor", charId: charDef.id });
    mesh.traverse((c) => { if (c.isMesh || c.isSprite) c.userData.actorRef = mesh; });
    this.scene.add(mesh);
    const actor = {
      id: charDef.id,
      name: charDef.name,
      def: charDef,
      mesh,
      vx: rand(-0.4, 0.4),
      vz: rand(-0.4, 0.4),
      heading: rand(0, Math.PI * 2),
      joy: 0.4,
      mood: "curious",
      lastSpecial: 0,
      born: performance.now(),
      idlePhase: rand(0, Math.PI * 2),     // teletubby-style breathing offset
      lastEmote: 0,
      lastSocialAt: performance.now() + rand(4000, 12000), // Sims social cooldown
    };
    // Cache the base scale so the idle "breath" wiggle multiplies against it
    // rather than overwriting (procedural meshes are pre-scaled by 2× the
    // spriteScale; sprite-actors keep their own internal sprite.scale).
    actor.baseScale = mesh.scale.x;
    this._buildMoodPlumbob(actor);
    this.actors.push(actor);
    if (this.focus && this.focus.id === actor.id) this._refreshInspector();
    // Respect the current view mode — a prize actor hatching during care view
    // shouldn't pop into the close-up; it'll appear when the user switches.
    if (this.view === "care" && !charDef.isGateway && !charDef.secret) {
      mesh.visible = false;
    }
    return actor;
  }

  // Sims-style mood plumbob — a small floating diamond above the actor whose
  // color reflects their mood. Attached to the actor's mesh so it follows
  // every position change for free. Per-tick we update the color + bob.
  _buildMoodPlumbob(actor) {
    const group = new THREE.Group();
    group.name = "plumbob";
    const geom = new THREE.OctahedronGeometry(0.36, 0);
    geom.scale(1.0, 1.7, 1.0);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xa0ff5a,
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
      depthTest: false,           // Sims plumbobs always pop through
    });
    const diamond = new THREE.Mesh(geom, mat);
    diamond.name = "plumbobDiamond";
    diamond.renderOrder = 999;
    group.add(diamond);
    // Soft halo behind the diamond for the Sims glow.
    const haloMat = new THREE.SpriteMaterial({
      map: this._makeDiscTexture(128, ["#a0ff5a", "#a0ff5a", "rgba(160,255,90,0)"]),
      transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.setScalar(1.6);
    halo.name = "plumbobHalo";
    halo.renderOrder = 998;
    group.add(halo);
    // Position above the actor's head. The mesh is pre-scaled (procedural
    // meshes are 4–7× larger than their built geometry), so we put the plumbob
    // a generous distance above and counter-scale the whole group to keep it
    // a consistent world-space size on every character.
    const def = actor.def;
    const baseScale = actor.baseScale || 1.0;
    // World-space target offset above the actor's apparent crown.
    const worldOff = def.flying ? 4.0 : def.floating ? 3.0 : 3.2;
    group.position.y = worldOff / baseScale;
    group.scale.setScalar(1 / Math.max(0.001, baseScale));
    actor.mesh.add(group);
    actor.plumbob = group;
    actor.plumbobDiamond = diamond;
    actor.plumbobHalo = halo;
  }

  // Map a mood to a plumbob color. Joy is the primary driver; specific moods
  // can override (e.g. "scared" → red even if joy is high momentarily).
  _moodColor(actor) {
    if (actor.mood === "scared")  return 0xff5a6e;
    if (actor.mood === "cold")    return 0x9ad4ff;
    if (actor.mood === "radiant") return 0xa0ff5a;
    if (actor.joy > 0.75)         return 0x8df36c;
    if (actor.joy > 0.45)         return 0xffe26a;
    if (actor.joy > 0.20)         return 0xffac6b;
    return 0xff7a8c;
  }

  // Sims-style thought bubble: spawn a small canvas-rendered emoji sprite
  // above an actor's head, float it up, and fade it out. Idempotent (cheap
  // to call from any reactTo / petActor / social interaction).
  emoteActor(actor, emoji, durMs = 1600) {
    if (!actor || !actor.mesh) return;
    const now = performance.now();
    if (now - (actor.lastEmote || 0) < 250) return; // throttle
    actor.lastEmote = now;
    const tex = this._emojiTextureCache?.[emoji] || this._makeEmojiTexture(emoji);
    (this._emojiTextureCache ||= {})[emoji] = tex;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, depthTest: false, opacity: 1.0,
    }));
    sprite.renderOrder = 1000;
    const def = actor.def;
    const base = actor.baseScale || 1.0;
    const yStart = (def.flying ? 5.0 : def.floating ? 4.0 : 4.2) / base;
    const baseSize = 1.6 / base;
    sprite.scale.setScalar(baseSize);
    sprite.position.set(0, yStart, 0);
    actor.mesh.add(sprite);
    const tStart = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - tStart) / durMs);
      sprite.position.y = yStart + t * (0.8 / base);
      sprite.material.opacity = 1 - Math.pow(t, 2);
      sprite.scale.setScalar(baseSize * (1 + t * 0.33));
      if (t < 1) requestAnimationFrame(step);
      else actor.mesh.remove(sprite);
    };
    requestAnimationFrame(step);
  }

  _makeEmojiTexture(emoji) {
    const size = 128;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, size, size);
    // Background tint per emotion so the bubble reads at a glance even when
    // the emoji glyph itself doesn't render (some environments lack the
    // colored-emoji font). Falls back to soft white.
    const tints = {
      "💖": "#ffe1eb", "💗": "#ffe1eb", "❤️": "#ffe1eb",
      "🛸": "#e3eaff", "👋": "#ffeacc",
      "😨": "#ffd9d9", "🥶": "#dff0ff",
      "❄️": "#eaf6ff", "🌷": "#ffe3ef", "✨": "#fff8c8",
      "⭐": "#fff5b3", "🌑": "#d9d6f0", "🌈": "#ffd9eb",
      "💧": "#cfe7ff", "💭": "#f0f0f0", "🔥": "#ffd5b3",
    };
    const tint = tints[emoji] || "#ffffff";
    // Speech-bubble backdrop — tinted rounded rectangle with a downward tail.
    ctx.fillStyle = tint;
    ctx.strokeStyle = "rgba(60,40,30,0.45)";
    ctx.lineWidth = 3;
    const r = 22;
    ctx.beginPath();
    ctx.moveTo(r + 6, 6);
    ctx.lineTo(size - 6 - r, 6);
    ctx.quadraticCurveTo(size - 6, 6, size - 6, 6 + r);
    ctx.lineTo(size - 6, size - 18 - r);
    ctx.quadraticCurveTo(size - 6, size - 18, size - 6 - r, size - 18);
    ctx.lineTo(size / 2 + 8, size - 18);
    ctx.lineTo(size / 2, size - 4);
    ctx.lineTo(size / 2 - 8, size - 18);
    ctx.lineTo(6 + r, size - 18);
    ctx.quadraticCurveTo(6, size - 18, 6, size - 18 - r);
    ctx.lineTo(6, 6 + r);
    ctx.quadraticCurveTo(6, 6, 6 + r, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.font = "72px 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#111";
    ctx.fillText(emoji, size / 2, size / 2 - 6);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }

  rebuildActor(actor) {
    const oldPos = actor.mesh.position.clone();
    this.scene.remove(actor.mesh);
    const m = this._buildActorMesh(actor.def);
    m.position.copy(oldPos);
    Object.assign(m.userData, { kind: "actor", charId: actor.id });
    m.traverse((c) => { if (c.isMesh || c.isSprite) c.userData.actorRef = m; });
    this.scene.add(m);
    actor.mesh = m;
  }

  // Priority: GLB (Tripo model in /docs/models/ — best fidelity when present)
  // → procedural buildBody() (real 3D mesh with depth and silhouette)
  // → painted sprite billboard as final fallback. User feedback: "no more
  // cards showing should be using MCP to make 3D models" — the procedural
  // mesh is the closest thing we have to a 3D model while we wait on Tripo.
  _buildActorMesh(charDef) {
    const glb = this.modelCache[charDef.id];
    if (glb) {
      const cloned = glb.clone(true);
      cloned.traverse((n) => {
        if (n.isMesh && n.material) n.material = n.material.clone();
      });
      return cloned;
    }
    // Procedural 3D mesh — scale up so it reads at the default camera distance.
    // Per-character spriteScale was tuned for billboards; the procedural body
    // is roughly the right shape but smaller in units, so we apply a 2× boost
    // by default (overridden by charDef.proceduralScale if set).
    const proc = charDef.buildBody();
    // 2× the sprite-scale gives a chunky, readable silhouette at the default
    // OrbitControls distance. Aurora the whale ends up ~3.6 units wide,
    // Blue ~2.4 units tall — visibly 3D, not a pinprick.
    const scale = charDef.proceduralScale || (charDef.spriteScale || 2) * 2.0;
    proc.scale.setScalar(scale);
    return proc;
  }

  // Painted-cutout actor: a camera-facing Sprite using the character's
  // portrait, with a soft elliptical shadow blob beneath for ground walkers.
  // Sprite center is at the bottom-middle so positioning is in "feet" space —
  // the rest of the engine already targets y in those units.
  _buildSpriteActor(charDef, texture) {
    const g = new THREE.Group();
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.center.set(0.5, 0); // anchor at bottom-center (feet)
    // Per-character footprint. The portrait is 1024x1024 — a 2-unit base
    // height fits the procedural-mesh footprint nicely. Override per character
    // via spriteScale.
    const scale = charDef.spriteScale || 2.0;
    sprite.scale.set(scale, scale, scale);
    g.add(sprite);
    // Shadow blob for ground walkers only (flyers/floaters don't touch ground).
    if (!charDef.flying && !charDef.floating) {
      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(scale * 0.32, 24),
        new THREE.MeshBasicMaterial({
          color: 0x000000,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
        })
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.02;
      shadow.scale.set(1, 0.65, 1);
      g.add(shadow);
    }
    g.userData.isSpriteActor = true;
    return g;
  }

  findNearestActor(toVec3) {
    let best = null;
    let bestD = Infinity;
    for (const a of this.actors) {
      const d = a.mesh.position.distanceTo(toVec3);
      if (d < bestD) { best = a; bestD = d; }
    }
    return best;
  }

  // ---- tick ---------------------------------------------------------------

  tick(dt) {
    this._applyTimeBlend(dt);
    this.events.tick(performance.now());

    // Egg presentation: bob/spin/wiggle the inner eggArt (NOT the wrap so the
    // pedestal halo stays glued to the ground). Halo gently pulses; label
    // stays put. Cracks visualized as a per-tap scale-down on the egg.
    const now = performance.now();
    for (const id in this.eggs) {
      const e = this.eggs[id];
      const art = e.eggArt;
      if (art) {
        art.position.y = Math.sin(now * 0.002 + e.bobPhase) * 0.12;
        // Slow Y spin so the user's eye catches motion across the ring.
        art.rotation.y = now * 0.0007 + e.bobPhase;
        if (e.wiggleT) {
          const wt = (now - e.wiggleT) / 600;
          if (wt < 1) {
            art.rotation.z = Math.sin(wt * Math.PI * 4) * (0.4 * (1 - wt));
          } else {
            art.rotation.z = 0;
            e.wiggleT = 0;
          }
        }
        art.scale.setScalar(1.8 * (1 - e.taps * 0.04));
      }
      if (e.halo && e.halo.material) {
        e.halo.material.opacity = 0.45 + Math.sin(now * 0.0014 + e.bobPhase) * 0.18;
      }
    }

    // Actor wander.
    for (const a of this.actors) this._tickActor(a, dt);
    // Sims-style autonomous social interactions — picks pairs at random and
    // sends them toward each other for a brief hello.
    this._tickSocial(now);

    // Per-event updaters (snow particles, etc.)
    for (let i = this.updaters.length - 1; i >= 0; i--) {
      try { this.updaters[i](dt); } catch (err) { this.updaters.splice(i, 1); }
    }
  }

  // Periodically schedule a social interaction between two random actors.
  // When their cooldown is up, head them toward each other; when they collide,
  // both pulse and share a heart emoji. Bumps joy on both.
  _tickSocial(now) {
    if (this.actors.length < 2) return;
    for (const a of this.actors) {
      if (a._socialTarget) {
        const t = a._socialTarget;
        if (!this.actors.includes(t)) { a._socialTarget = null; continue; }
        const d = a.mesh.position.distanceTo(t.mesh.position);
        if (d < 1.8) {
          // Met! Both react.
          this.hopActor(a, 0.4, 350);
          this.hopActor(t, 0.4, 350);
          this.emoteActor(a, "💗", 1200);
          this.emoteActor(t, "💗", 1200);
          a.joy = Math.min(1, a.joy + 0.04);
          t.joy = Math.min(1, t.joy + 0.04);
          a._socialTarget = null;
          a.lastSocialAt = now + rand(15000, 35000);
          t.lastSocialAt = now + rand(15000, 35000);
        } else if (!a.def.flying && !a.def.floating) {
          a.heading = Math.atan2(
            t.mesh.position.z - a.mesh.position.z,
            t.mesh.position.x - a.mesh.position.x
          );
        }
        continue;
      }
      if (now < (a.lastSocialAt || 0)) continue;
      // Pick a peer: prefer ground walkers (flyers/floaters wander too high
      // to "meet"). Skip if a partner is already locked into a chat.
      const peers = this.actors.filter(p => p !== a && !p._socialTarget && !p.def.flying && !p.def.floating);
      if (peers.length === 0) { a.lastSocialAt = now + rand(8000, 18000); continue; }
      if (a.def.flying || a.def.floating) { a.lastSocialAt = now + rand(8000, 18000); continue; }
      const peer = peers[Math.floor(Math.random() * peers.length)];
      a._socialTarget = peer;
    }
  }

  _tickActor(actor, dt) {
    const def = actor.def;
    const m = actor.mesh;
    // Blue gets her own behavior state machine: visits the camera in CARE
    // view, plays with the coop toys (peck the bowl, hop on bales) when
    // left alone (VALLEY view, or after enough idle seconds in CARE).
    if (def.isGateway && this._tickBlue(actor, dt)) return;

    // Every other actor gets goal-directed behavior — needs decay over time
    // and pull them toward a goal that fixes the most-pressing need.
    this._decayNeeds(actor, dt);
    this._pickActorGoal(actor);
    const goalSpeed = this._steerToGoal(actor, dt);
    // Wander fall-through — used only when no goal selected this frame.
    const speed = goalSpeed != null ? goalSpeed
      : (def.id === "magma" && actor._dashUntil > performance.now() ? 8 : 1.2);
    if (goalSpeed == null) {
      // Pure wander
      actor.heading += rand(-0.02, 0.02);
      const radius = GROUND_RADIUS - 3;
      const distFromCenter = Math.hypot(m.position.x, m.position.z);
      if (distFromCenter > radius) {
        const desired = Math.atan2(-m.position.z, -m.position.x);
        actor.heading = desired + rand(-0.1, 0.1);
      }
      m.position.x += Math.cos(actor.heading) * speed * dt / 1000;
      m.position.z += Math.sin(actor.heading) * speed * dt / 1000;
    }

    // Y position by category. Sprite actors anchor at their feet (sprite
    // center is at the bottom), so the y here is "feet height"; for procedural
    // / GLB meshes it's the center of the mesh — slightly different baseline,
    // accounted for via spriteBaseOffset.
    const isSprite = m.userData && m.userData.isSpriteActor;
    if (def.flying) {
      m.position.y = (isSprite ? 5 : 6) + Math.sin(performance.now() * 0.0008 + actor.born * 0.0001) * 0.6;
    } else if (def.floating) {
      m.position.y = (isSprite ? 0.8 : 1.5) + Math.sin(performance.now() * 0.0014 + actor.born * 0.0001) * 0.2;
    } else {
      m.position.y = (isSprite ? 0.0 : 0.6) + Math.abs(Math.sin(performance.now() * 0.005 + actor.born * 0.0002)) * 0.08;
    }

    // Sprites always face the camera; only procedural/GLB meshes need a
    // heading rotation. Setting rotation.y on a Sprite-only group has no
    // visual effect anyway, so we just skip the work.
    if (!isSprite) m.rotation.y = -actor.heading + Math.PI / 2;

    // Teletubby-style idle: gentle vertical "breathing" scale + tiny squash.
    // Multiplied against the actor's cached base scale so procedural meshes
    // (pre-scaled at spawn) don't shrink to unit size each frame.
    if (!def.flying && !def.floating) {
      const base = actor.baseScale || 1.0;
      const breath = 1.0 + Math.sin(performance.now() * 0.003 + actor.idlePhase) * 0.04;
      m.scale.y = base * breath;
      m.scale.x = m.scale.z = base * (1.0 + (breath - 1.0) * -0.35);
    }

    // Sims-style plumbob: bob + spin slowly, color-map to mood/joy. Position
    // expressed in the actor mesh's *local* (pre-scale) coordinates.
    if (actor.plumbob) {
      const base = actor.baseScale || 1.0;
      const worldOff = def.flying ? 4.0 : def.floating ? 3.0 : 3.2;
      actor.plumbob.position.y = (worldOff / base) + Math.sin(performance.now() * 0.0025 + actor.idlePhase) * 0.06;
      actor.plumbobDiamond.rotation.y += dt * 0.0018;
      const targetColor = this._moodColor(actor);
      actor.plumbobDiamond.material.color.lerp(new THREE.Color(targetColor), 0.06);
      actor.plumbobHalo.material.color.lerp(new THREE.Color(targetColor), 0.06);
      actor.plumbobHalo.material.opacity = 0.5 + 0.25 * Math.sin(performance.now() * 0.004);
    }

    // Joy ticks up; faster in preferred time.
    const tname = this.timeName();
    const pref = def.prefersTime;
    const joyRate = (pref === "any" || pref === tname) ? 0.00004 : 0.00002;
    actor.joy = Math.min(1, actor.joy + dt * joyRate);

    // Tick the mood so it tracks joy/time — otherwise actors stay
    // "curious" forever. The plumbob + inspector already render mood.
    if (typeof this._moodFor === "function") actor.mood = this._moodFor(actor);

    // Maturation tracker: a prize hatchling that holds joy ≥ 0.9 for
    // GRADUATE_SUSTAIN_MS "grows up" and graduates back to Cluckbot's
    // barnyard. The router shell watches the graduates key and renders
    // the returning flock in the V1 view.
    this._tickMaturation(actor, dt);

    if (typeof def.onMove === "function") def.onMove(this, actor);

    // Mossback's shell grows occasionally.
    if (def.id === "mossback" && Math.random() < 0.0006) this.plantOnTurtle(actor);

    // Whisper teleports rarely at night.
    if (def.id === "whisper" && tname === "night" && Math.random() < 0.0004) this.teleportActor(actor, null);

    if (this.focus && this.focus.id === actor.id) this._refreshInspector();
  }

  // ------------------------------------------------------------------
  // Blue's behavior state machine — runs only for her, replaces the
  // generic wander. Two states:
  //   visiting → walk to this.visitSpot, face the camera, idle there.
  //   playing  → cycle through this.toys (peck the feed bowl, hop on a
  //              hay bale, preen near the coop) when she's left alone.
  // CARE view + recent attention pulse keeps her visiting; long idle in
  // CARE or any time in VALLEY moves her to playing.
  // ------------------------------------------------------------------
  _tickBlue(actor, dt) {
    if (!this.toys || !this.visitSpot) return false; // barn not built yet
    const m = actor.mesh;
    const now = performance.now();
    actor._blue = actor._blue || {
      mode: "visiting",
      toyIdx: 0,
      arrivedAt: 0,
      lingerMs: 1800,
      attentionUntil: now + 6000, // start out attentive (player just opened the app)
    };
    const s = actor._blue;

    // Decide the desired mode. Recent attention OR being in care view biases
    // her toward visiting; valley view OR long idle in care moves her to play.
    const attentive = now < s.attentionUntil;
    const wantsVisit = (this.view === "care") && attentive;
    const desiredMode = wantsVisit ? "visiting" : "playing";
    if (desiredMode !== s.mode) {
      s.mode = desiredMode;
      s.arrivedAt = 0;
      // Pick a fresh toy each time she enters playing — keeps her moving.
      if (s.mode === "playing") s.toyIdx = Math.floor(Math.random() * this.toys.length);
    }

    // Choose a target position for this frame.
    const target = (s.mode === "visiting")
      ? this.visitSpot
      : this.toys[s.toyIdx].pos;
    const dx = target.x - m.position.x;
    const dz = target.z - m.position.z;
    const dist = Math.hypot(dx, dz);

    // Walk speed scales with how far she has to go; she slows on arrival.
    const speed = dist > 2 ? 2.2 : dist > 0.5 ? 1.4 : 0;
    if (speed > 0) {
      const ang = Math.atan2(dz, dx);
      actor.heading = ang;
      m.position.x += Math.cos(ang) * speed * dt / 1000;
      m.position.z += Math.sin(ang) * speed * dt / 1000;
    }

    // On arrival: do the action for this state.
    if (dist <= 0.5) {
      if (s.arrivedAt === 0) {
        s.arrivedAt = now;
        if (s.mode === "visiting") {
          // Face the camera so she "looks at" the player.
          actor.heading = Math.atan2(
            this.camera.position.z - m.position.z,
            this.camera.position.x - m.position.x
          );
          this._blueGreet(actor);
        } else {
          // Toy interaction: peck / hop / preen.
          this._blueToyInteract(actor, this.toys[s.toyIdx]);
          s.lingerMs = 1800 + Math.random() * 1500;
        }
      } else if (now - s.arrivedAt > s.lingerMs && s.mode === "playing") {
        // Move to the next toy.
        s.toyIdx = (s.toyIdx + Math.floor(1 + Math.random() * (this.toys.length - 1))) % this.toys.length;
        s.arrivedAt = 0;
      } else if (s.mode === "visiting" && now - s.arrivedAt > 3000) {
        // Subtle head re-aim every few seconds so she doesn't look frozen.
        actor.heading = Math.atan2(
          this.camera.position.z - m.position.z,
          this.camera.position.x - m.position.x
        ) + (Math.random() - 0.5) * 0.4;
        s.arrivedAt = now;
      }
    }

    // Vertical bob — taller when visiting (alert), gentler when playing.
    const bobAmp = (s.mode === "visiting" && dist <= 0.5) ? 0.05 : 0.08;
    m.position.y = 0.6 + Math.abs(Math.sin(now * 0.005 + actor.born * 0.0002)) * bobAmp;
    m.rotation.y = -actor.heading + Math.PI / 2;

    // Pulse her LEDs — chest disc + antenna bulb breathe slowly while
    // visiting, flicker rapidly while pecking/playing. userData is set
    // directly on the buildBody() group, which IS actor.mesh.
    const led = m.userData && m.userData.led;
    const bulb = m.userData && m.userData.antennaBulb;
    if (led || bulb) {
      const speedHz = s.mode === "visiting" ? 0.001 : 0.003;
      const pulse = 0.7 + Math.sin(now * speedHz) * 0.3;
      if (led && led.material) led.material.opacity = pulse;
      if (bulb && bulb.material) bulb.material.opacity = pulse;
    }

    // Joy still ticks up while she's well-cared-for (matches the generic path).
    const tname = this.timeName();
    const pref = actor.def.prefersTime;
    const joyRate = (pref === "any" || pref === tname) ? 0.00004 : 0.00002;
    actor.joy = Math.min(1, actor.joy + dt * joyRate);

    if (this.focus && this.focus.id === actor.id) this._refreshInspector();
    return true; // we handled this actor
  }

  // Called when a care action fires — pulls Blue back to the visit spot so
  // she "comes to see you" after a pet/feed/play.
  attendToBlue(durMs = 6000) {
    const blue = this.actors.find((a) => a.def && a.def.isGateway);
    if (!blue) return;
    blue._blue = blue._blue || { mode: "visiting", toyIdx: 0, arrivedAt: 0, lingerMs: 1800, attentionUntil: 0 };
    blue._blue.attentionUntil = performance.now() + durMs;
  }

  _blueGreet(actor) {
    // Soft cluck on arrival, but don't spam if she only just clucked.
    const now = performance.now();
    if (now - (actor._lastCluck || 0) > 4500) {
      actor._lastCluck = now;
      if (this.audio && this.audio.cluck) this.audio.cluck();
    }
  }

  _blueToyInteract(actor, toy) {
    // Hop / peck / preen visual reaction.
    if (toy.kind === "peck") {
      // Three rapid head-bob hops, low to the ground — pecks at the feed bowl.
      this.hopActor(actor, -0.1, 200);
      setTimeout(() => this.hopActor(actor, -0.1, 200), 240);
      setTimeout(() => this.hopActor(actor, -0.1, 200), 480);
      if (this.audio && this.audio.tap) this.audio.tap();
    } else if (toy.kind === "hop") {
      // Big hop up onto the hay bale.
      this.hopActor(actor, 0.7, 500);
      if (this.audio && this.audio.tap) this.audio.tap();
    } else {
      // Preen / settle — a calm half-hop.
      this.hopActor(actor, 0.25, 600);
    }
  }

  // ------------------------------------------------------------------
  // Per-actor needs that decay over time and DRIVE goal selection — the
  // Sims trick that turns wander into "I'm hungry, I should eat." Each
  // actor has hunger/energy/social/fun in [0, 100]. Decay rates vary by
  // personality (Magma burns energy fast, Mossback dozes slowly, Whisper
  // hates company so social drains slowly, Pip thrives on it).
  // ------------------------------------------------------------------
  _ensureNeeds(actor) {
    if (actor._needs) return;
    actor._needs = {
      hunger: 60 + Math.random() * 30,
      energy: 60 + Math.random() * 30,
      social: 60 + Math.random() * 30,
      fun:    60 + Math.random() * 30,
    };
  }
  _decayNeeds(actor, dt) {
    this._ensureNeeds(actor);
    const def = actor.def;
    const RATE = {
      hunger: def.id === "mossback" ? 0.25 : def.id === "magma" ? 0.65 : 0.4,
      energy: def.id === "magma"    ? 0.8  : def.id === "mossback" ? 0.2 : def.flying ? 0.5 : 0.35,
      social: def.id === "whisper"  ? 0.15 : def.id === "pip"    ? 0.6 : 0.35,
      fun:    def.id === "ember"    ? 0.55 : 0.4,
    };
    const s = dt / 1000;
    actor._needs.hunger = Math.max(0, actor._needs.hunger - RATE.hunger * s);
    actor._needs.energy = Math.max(0, actor._needs.energy - RATE.energy * s);
    actor._needs.social = Math.max(0, actor._needs.social - RATE.social * s);
    actor._needs.fun    = Math.max(0, actor._needs.fun    - RATE.fun    * s);
    // Joy is the average need / 100 — smoothed so it doesn't oscillate.
    const avg = (actor._needs.hunger + actor._needs.energy + actor._needs.social + actor._needs.fun) / 400;
    actor.joy = actor.joy * 0.96 + avg * 0.04;
  }

  // Each tick: pick a goal weighted by which need is most pressing. A hungry
  // actor prefers the feed bowl; a sleepy actor heads to the bed; a lonely
  // actor goes find a peer. Goals carry which need they satisfy so the goal
  // resolver can refill that need.
  _pickActorGoal(actor) {
    const now = performance.now();
    if (actor._goal && now < (actor._goalDeadline || 0)) return;
    if (actor._goalNextAt && now < actor._goalNextAt) return;
    actor._goalNextAt = now + rand(4500, 14000);

    this._ensureNeeds(actor);
    const def = actor.def;
    const tname = this.timeName();
    const prefers = def.prefersTime;
    const isFlyOrFloat = def.flying || def.floating;
    const n = actor._needs;
    const candidates = [];

    // 1. Toys — choose ones whose interaction satisfies a felt need.
    //    Bowl/worm/ball → hunger. Bed/coop/perch/henhouse → energy. The
    //    rest map to fun. Weight is `(100 - need) / 100` — the hungrier
    //    you are, the more bowls dominate the pool.
    if (this.toys && this.toys.length > 0) {
      for (const t of this.toys) {
        const label = t.label;
        const satisfies =
          (label === "bowl" || label === "worm" || label === "ball") ? "hunger" :
          (label === "bed"  || label === "coop" || label === "perch" || label === "henhouse") ? "energy" :
          "fun";
        const weight = ((100 - n[satisfies]) / 100) * (1 + Math.random() * 0.4);
        if (weight > 0.05) {
          candidates.push({
            weight,
            goal: { pos: t.pos.clone(), kind: "toy:" + label, satisfies,
                    lingerMs: 1500 + Math.random() * 2000 },
          });
        }
      }
    }

    // 2. Social — approach a peer. Ground walkers only (flyers/floaters can't
    //    meaningfully meet on the ground). Weighted by social-need deficit.
    if (!isFlyOrFloat && this.actors.length > 1) {
      const peers = this.actors.filter((p) => p !== actor && !p.def.flying && !p.def.floating);
      if (peers.length > 0) {
        const peer = peers[Math.floor(Math.random() * peers.length)];
        const weight = ((100 - n.social) / 100) * (1 + Math.random() * 0.3);
        candidates.push({
          weight,
          goal: { pos: peer.mesh.position.clone(), kind: "social", peer,
                  satisfies: "social", lingerMs: 1500 + Math.random() * 1500 },
        });
      }
    }

    // 3. Sun / shade — time-of-day preference. Sun in your time = fun; shade
    //    out of your time = energy (resting in the coop).
    if (prefers && prefers !== "any") {
      const inMyTime = (prefers === tname);
      const ang = Math.random() * Math.PI * 2;
      const r  = inMyTime ? 6 + Math.random() * 6 : 3 + Math.random() * 2;
      const x  = inMyTime ? Math.cos(ang) * r : -2 + Math.random() * 4;
      const z  = inMyTime ? Math.sin(ang) * r : -3 + Math.random() * 2;
      const satisfies = inMyTime ? "fun" : "energy";
      const weight = ((100 - n[satisfies]) / 100) * (inMyTime ? 0.6 : 0.8);
      candidates.push({
        weight,
        goal: { pos: new THREE.Vector3(x, 0, z),
                kind: inMyTime ? "sun" : "shade", satisfies,
                lingerMs: 2000 + Math.random() * 2500 },
      });
    }

    // 4. Wander — fallback at a small fixed weight so the actor never stalls.
    {
      const ang = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 8;
      candidates.push({
        weight: 0.15,
        goal: { pos: new THREE.Vector3(Math.cos(ang) * r, 0, Math.sin(ang) * r),
                kind: "wander", satisfies: "fun",
                lingerMs: 800 + Math.random() * 1200 },
      });
    }

    // Weighted pick: roulette.
    let total = 0;
    for (const c of candidates) total += c.weight;
    let r = Math.random() * total;
    let chosen = candidates[candidates.length - 1].goal;
    for (const c of candidates) {
      r -= c.weight;
      if (r <= 0) { chosen = c.goal; break; }
    }
    actor._goal = chosen;
    actor._goalDeadline = now + 20000;
    // Emote a "thought" — what's on their mind. Strong signal that the AI
    // is *thinking*, not just moving randomly. emoteActor throttles itself.
    const thought = ({
      "toy:bowl":     "🌾",
      "toy:bale":     "♬",
      "toy:coop":     "☾",
      "toy:ball":     "✦",
      "toy:henhouse": "♡",
      "toy:disco":    "★",
      "toy:mirror":   "✿",
      "toy:worm":     "🌾",
      "social":       "♡",
      "sun":          "☀",
      "shade":        "☾",
      "wander":       "✦",
    }[chosen.kind] || "·");
    if (this.emoteActor) this.emoteActor(actor, thought, 1400);
  }

  // Steer the actor toward its current goal. Returns a movement speed
  // (px/s analog) when a goal exists, or null when no goal is set so the
  // caller can fall through to wander code.
  _steerToGoal(actor, dt) {
    const goal = actor._goal;
    if (!goal) return null;
    const m = actor.mesh;
    const dx = goal.pos.x - m.position.x;
    const dz = goal.pos.z - m.position.z;
    const dist = Math.hypot(dx, dz);

    // Per-personality speed.
    const def = actor.def;
    const base = def.id === "mossback" ? 0.7
               : def.id === "magma" ? (actor._dashUntil > performance.now() ? 8 : 2.2)
               : def.floating ? 0.9
               : def.flying ? 1.6
               : 1.5;

    if (dist > 0.6) {
      const ang = Math.atan2(dz, dx);
      actor.heading = ang;
      m.position.x += Math.cos(ang) * base * dt / 1000;
      m.position.z += Math.sin(ang) * base * dt / 1000;
      // Y position by category (kept consistent with the wander branch).
      const isSprite = m.userData && m.userData.isSpriteActor;
      if (def.flying) {
        m.position.y = (isSprite ? 5 : 6) + Math.sin(performance.now() * 0.0008 + actor.born * 0.0001) * 0.6;
      } else if (def.floating) {
        m.position.y = (isSprite ? 0.8 : 1.5) + Math.sin(performance.now() * 0.0014 + actor.born * 0.0001) * 0.2;
      } else {
        m.position.y = (isSprite ? 0.0 : 0.6) + Math.abs(Math.sin(performance.now() * 0.005 + actor.born * 0.0002)) * 0.08;
      }
      if (!isSprite) m.rotation.y = -actor.heading + Math.PI / 2;
      return base;
    }

    // Arrived — interact based on goal kind.
    if (!goal.arrivedAt) {
      goal.arrivedAt = performance.now();
      this._actorInteractAtGoal(actor, goal);
    } else if (performance.now() - goal.arrivedAt > (goal.lingerMs || 1500)) {
      actor._goal = null;
    }
    return base * 0.05; // gentle settling motion
  }

  _actorInteractAtGoal(actor, goal) {
    const def = actor.def;
    // Refill the need this goal satisfies.
    if (goal.satisfies && actor._needs) {
      actor._needs[goal.satisfies] = Math.min(100, actor._needs[goal.satisfies] + 45);
    }
    if (goal.kind.startsWith("toy:")) {
      const kind = goal.kind.slice(4);
      if (kind === "bowl" || kind === "ball" || kind === "worm") {
        // Peck-at: rapid head-bobs
        if (!def.flying && !def.floating) this.hopActor(actor, -0.08, 200);
        actor.joy = Math.min(1, actor.joy + 0.04);
      } else if (kind === "bale" || kind === "perch") {
        // Hop on
        this.hopActor(actor, 0.5, 450);
        actor.joy = Math.min(1, actor.joy + 0.05);
      } else if (kind === "disco") {
        // Dance: emote burst + joy bump
        if (this.emoteActor) {
          this.emoteActor(actor, "♬", 1500);
          setTimeout(() => this.emoteActor && this.emoteActor(actor, "✦", 1500), 600);
        }
        actor.joy = Math.min(1, actor.joy + 0.08);
      } else if (kind === "bed" || kind === "coop") {
        // Rest: slight joy lift, settle
        actor.joy = Math.min(1, actor.joy + 0.03);
      } else {
        actor.joy = Math.min(1, actor.joy + 0.02);
      }
    } else if (goal.kind === "social" && goal.peer) {
      // Heart emote + joy lift on both ends
      this.hopActor(actor, 0.3, 350);
      if (this.emoteActor) this.emoteActor(actor, "♡", 1200);
      actor.joy = Math.min(1, actor.joy + 0.04);
    } else if (goal.kind === "sun") {
      if (this.emoteActor) this.emoteActor(actor, "☀", 1300);
      actor.joy = Math.min(1, actor.joy + 0.06);
    } else if (goal.kind === "shade") {
      if (this.emoteActor) this.emoteActor(actor, "☾", 1300);
      actor.joy = Math.min(1, actor.joy + 0.02);
    }
  }

  // ---- helpers used by specials/events ------------------------------------

  registerUpdater(fn) { this.updaters.push(fn); }

  registerBubble(mesh) { this.bubbles.push(mesh); }
  popBubble(mesh) {
    const i = this.bubbles.indexOf(mesh);
    if (i >= 0) this.bubbles.splice(i, 1);
    const memory = mesh.userData.memory;
    this.scene.remove(mesh);
    this.toast("You remember: " + memory);
  }

  canUseSpecial(actor) {
    return performance.now() - actor.lastSpecial >= actor.def.specialCooldownMs;
  }
  useSpecial(actor) {
    if (!this.canUseSpecial(actor)) return false;
    actor.lastSpecial = performance.now();
    actor.joy = Math.min(1, actor.joy + 0.2);
    actor.def.special.call(actor.def, this, actor);
    if (this.focus && this.focus.id === actor.id) this._refreshInspector();
    return true;
  }

  petActor(actor) {
    actor.joy = Math.min(1, actor.joy + 0.08);
    this.hopActor(actor, 0.4, 400);
    // Furby-style "love me" feedback: heart bubble + cluck (when the actor
    // is the chicken; everyone else gets the regular pet blip).
    this.emoteActor(actor, "💖", 1400);
    if (this.audio) {
      if (actor.id === "bluechicken" && this.audio.cluck) this.audio.cluck();
      else this.audio.pet?.();
    }
  }

  // Visible bounce-on-the-spot. Used by petActor and by reactTo() in characters
  // who want a tactile little reaction (hop in joy, hop in surprise) — works for
  // both procedural-mesh and sprite-billboard actors since we only mutate y.
  hopActor(actor, height = 0.4, dur = 400) {
    const baseY = actor.mesh.position.y;
    const tStart = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - tStart) / dur);
      actor.mesh.position.y = baseY + Math.sin(t * Math.PI) * height;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  dashActor(actor, durSec) {
    if (this.audio) this.audio.dash();
    actor._dashUntil = performance.now() + durSec * 1000;
    actor.heading = rand(0, Math.PI * 2);
    // Spawn a row of footprints over the dash duration.
    const N = 12;
    for (let i = 0; i < N; i++) {
      setTimeout(() => this.spawnFootprint(actor.mesh.position, 0xff5a20), i * 80);
    }
  }

  spawnFootprint(at, color) {
    const fp = new THREE.Mesh(
      new THREE.CircleGeometry(0.15, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false })
    );
    fp.rotation.x = -Math.PI / 2;
    fp.position.set(at.x + rand(-0.1, 0.1), 0.03, at.z + rand(-0.1, 0.1));
    this.scene.add(fp);
    const tStart = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - tStart) / 6000);
      fp.material.opacity = 0.8 * (1 - t);
      if (t < 1) requestAnimationFrame(step);
      else this.scene.remove(fp);
    };
    requestAnimationFrame(step);
  }

  plantOnTurtle(actor) {
    const garden = actor.mesh.getObjectByName("garden");
    if (!garden) return;
    const x = rand(-0.4, 0.4);
    const z = rand(-0.4, 0.4);
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.12, 4),
      std(0x3a5c1e)
    );
    stem.position.set(x, 0.06, z);
    garden.add(stem);
    const isFlower = Math.random() < 0.55;
    if (isFlower) {
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 8, 6),
        std([0xffb3d9, 0xffe26a, 0xb8a2ff, 0xffac6b, 0xa0e8c3][Math.floor(Math.random() * 5)])
      );
      head.position.set(x, 0.16, z);
      garden.add(head);
    } else {
      const leaf = new THREE.Mesh(
        new THREE.ConeGeometry(0.05, 0.12, 4),
        std(0x6f9a3a)
      );
      leaf.position.set(x, 0.18, z);
      garden.add(leaf);
    }
  }

  teleportActor(actor, riddle) {
    // Smoke puff + reposition.
    for (let i = 0; i < 10; i++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x3a2a55, transparent: true, opacity: 0.55, depthWrite: false })
      );
      puff.position.copy(actor.mesh.position);
      puff.position.x += rand(-0.3, 0.3);
      puff.position.z += rand(-0.3, 0.3);
      this.scene.add(puff);
      const tStart = performance.now();
      const step = () => {
        const t = Math.min(1, (performance.now() - tStart) / 1100);
        puff.position.y += 0.02;
        puff.material.opacity = 0.55 * (1 - t);
        if (t < 1) requestAnimationFrame(step);
        else this.scene.remove(puff);
      };
      requestAnimationFrame(step);
    }
    actor.mesh.position.x = rand(-GROUND_RADIUS * 0.6, GROUND_RADIUS * 0.6);
    actor.mesh.position.z = rand(-GROUND_RADIUS * 0.6, GROUND_RADIUS * 0.6);
    if (riddle) {
      this.toast('"' + riddle + '"');
    }
  }

  // ---- HUD ---------------------------------------------------------------

  toast(message) {
    if (!this.toastEl) return;
    this.toastEl.textContent = message;
    this.toastEl.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toastEl.classList.remove("show"), 3600);
  }
  setEventLabel(label) { if (this.eventLabel) this.eventLabel.textContent = label; }
  flagSeen(flag) { this.flags[flag] = true; this._persist(); }
  hasFlag(flag) { return !!this.flags[flag]; }

  discover(id, line) {
    const arr = (this.discoveries[id] = this.discoveries[id] || []);
    if (arr[0] !== line) arr.unshift(line);
    if (arr.length > 12) arr.length = 12;
    if (this.focus && this.focus.id === id) this._refreshInspector();
    this._persist();
  }

  // ---- persistence -------------------------------------------------------

  // Save a tiny snapshot of state worth surviving a refresh: who's hatched,
  // each character's joy, what's been discovered, what flags fired. Written
  // every time those mutate. Keeps the world's promise that "the world
  // remembers" actually true.
  // Per-actor maturation. A prize hatchling that holds joy ≥ 0.9 for
  // GRADUATE_SUSTAIN_MS graduates and is written to the shared graduates
  // ledger. Blue and Solis are exempt — Blue is the keeper, Solis is
  // the secret endgame. Once graduated, we don't unwrite — the realm
  // keeps them as a visible alumnus until the player resets.
  _tickMaturation(actor, dt) {
    const def = actor.def;
    if (!def || def.isGateway || def.secret) return;
    if (actor.graduated) return;
    const GRADUATE_SUSTAIN_MS = 30000; // 30s of sustained joy ≥ 0.9
    if (actor.joy >= 0.9) {
      actor._joyHighSince = actor._joyHighSince || performance.now();
      if (performance.now() - actor._joyHighSince >= GRADUATE_SUSTAIN_MS) {
        this._graduateActor(actor);
      }
    } else {
      actor._joyHighSince = 0;
    }
  }

  _graduateActor(actor) {
    actor.graduated = true;
    actor.graduatedAt = Date.now();
    this._appendGraduate({
      id: actor.id,
      name: actor.name,
      portrait: actor.def.portrait || null,
      role: actor.def.role || "",
      at: actor.graduatedAt,
    });
    this.toast(`${actor.name} has grown up — joining Blue at the barnyard.`);
    this.discover(actor.id, "Grew up. Walked home to Blue.");
    this._persist();
  }

  // Append the graduate to a shared localStorage ledger the top-level
  // shell watches. Idempotent — if the same id is already present, no-op.
  _appendGraduate(g) {
    const KEY = "bluechicken/graduates";
    let list = [];
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) list = JSON.parse(raw) || [];
    } catch (_) { list = []; }
    if (list.some((x) => x.id === g.id)) return;
    list.push(g);
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (_) {}
  }

  _persist() {
    if (typeof localStorage === "undefined") return;
    try {
      const actorState = {};
      for (const a of this.actors) actorState[a.id] = { joy: a.joy, mood: a.mood, graduated: !!a.graduated, graduatedAt: a.graduatedAt || 0 };
      const snap = {
        v: 1,
        hatched: this.hatched,
        actors: actorState,
        discoveries: this.discoveries,
        flags: this.flags,
        accelerators: this.accelerators,
        savedAt: Date.now(),
      };
      localStorage.setItem(this._saveKey, JSON.stringify(snap));
    } catch (_e) { /* quota / private-mode — silently ignore */ }
  }

  // Read the snapshot. main3d.js calls this after preload and decides which
  // characters to rehydrate as actors instead of placing as eggs.
  loadSnapshot() {
    if (typeof localStorage === "undefined") return null;
    try {
      const raw = localStorage.getItem(this._saveKey);
      if (!raw) return null;
      const snap = JSON.parse(raw);
      if (!snap || snap.v !== 1) return null;
      // Restore the easy stuff right now; main3d uses snap.hatched to decide
      // egg vs actor placement.
      this.hatched = snap.hatched || {};
      this.discoveries = snap.discoveries || {};
      this.flags = snap.flags || {};
      this.accelerators = Object.assign(
        { sunbeam: 0, hatch_charm: 0, joy_spark: 0, solis_beacon: 0 },
        snap.accelerators || {}
      );
      this._loadedActors = snap.actors || {};
      return snap;
    } catch (_e) { return null; }
  }

  resetSave() {
    if (typeof localStorage === "undefined") return;
    try { localStorage.removeItem(this._saveKey); } catch (_e) {}
  }

  focusActor(actor) {
    this.focus = actor;
    this.inspector.hidden = false;
    this._refreshInspector();
    document.querySelectorAll(".slot").forEach((s) => s.classList.remove("active"));
    const slot = document.querySelector(`.slot[data-id="${actor.id}"]`);
    if (slot) slot.classList.add("active");
  }
  closeInspector() {
    this.focus = null;
    if (this.inspector) this.inspector.hidden = true;
    document.querySelectorAll(".slot").forEach((s) => s.classList.remove("active"));
  }

  _refreshInspector() {
    if (!this.focus) return;
    // V1 PRD layout has no inspector panel — codex replaces it. Bail if its DOM is missing.
    if (!document.getElementById("insp-name")) return;
    const a = this.focus;
    const portraitEl = document.getElementById("insp-portrait");
    if (a.def.portrait) {
      portraitEl.src = a.def.portrait;
      portraitEl.hidden = false;
    } else {
      portraitEl.hidden = true;
    }
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
    for (const line of (this.discoveries[a.id] || [])) {
      const li = document.createElement("li");
      li.textContent = line;
      ul.appendChild(li);
    }
  }
  _moodFor(actor) {
    const tname = this.timeName();
    const pref = actor.def.prefersTime;
    if (actor.joy > 0.85) return "radiant";
    if (actor.joy < 0.2) return "quiet";
    if (pref === tname) return "in their element";
    if (pref === "night" && tname === "day") return "sleepy";
    if (pref === "day" && tname === "night") return "drowsy";
    return "content";
  }
}
