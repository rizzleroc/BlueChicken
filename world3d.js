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
    this.skyColors = {
      dawn:  new THREE.Color(0xf3b5a0),
      day:   new THREE.Color(0x88c4f0),
      dusk:  new THREE.Color(0xa86c75),
      night: new THREE.Color(0x0c1234),
    };
    this.fogColors = {
      dawn:  new THREE.Color(0xeac2a8),
      day:   new THREE.Color(0xd6ebfb),
      dusk:  new THREE.Color(0x916578),
      night: new THREE.Color(0x111738),
    };
    this.ambientColors = {
      dawn:  new THREE.Color(0xffd4c0),
      day:   new THREE.Color(0xeef4ff),
      dusk:  new THREE.Color(0xffb38c),
      night: new THREE.Color(0x6080b0),
    };
    this.sunColors = {
      dawn:  new THREE.Color(0xffdcb0),
      day:   new THREE.Color(0xfff4dc),
      dusk:  new THREE.Color(0xffb070),
      night: new THREE.Color(0xb6c8ff),
    };

    this.timeIdx = 1;
    this.timeT = 0;
    this.weather = "clear";

    this.scene.background = this.skyColors.day.clone();
    this.scene.fog = new THREE.Fog(this.fogColors.day.getHex(), 25, 70);

    this._buildLights();
    this._buildSkyDome();
    this._buildCelestial();   // visible sun + moon + pink-tinted clouds
    this._buildMountainRing(); // dark purple horizon silhouettes (V1 aesthetic)
    this._buildCenterMountain();// glowing-peaked pyramid in the distance
    this._buildGround();
    this._scatterScenery();
    this._buildStars();

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

  // V1 PRD: clouds are dusk-pink/coral, not stark white.
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
      g.addColorStop(0,   `rgba(255,200,194,${alpha})`);
      g.addColorStop(0.55, `rgba(255,160,164,${alpha * 0.6})`);
      g.addColorStop(1,   "rgba(255,170,170,0)");
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

  // Paint a single dark-purple mountain silhouette. Pyramid form for the
  // centre mountain, rounded ridges for the ring mountains.
  _makeMountainTexture(isPyramid = false) {
    const W = 512, H = 384;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    // Two-stop gradient — dark to darker, makes the silhouette feel solid
    // but lets the sky show through at the tip.
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#2a2348");
    grad.addColorStop(1, "#1a1430");
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
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
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

  // Draw a brush-stroke ground onto an offscreen canvas. V1 PRD palette: a
  // dark-purple-grey plain with scattered painterly flower tufts + tiny
  // vertical grass blades. No large green washes — V1's ground reads as
  // night-dusk-tinted earth rather than a green meadow.
  _makePaintedGroundTexture() {
    const size = 1024;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    // Base wash — dark purple-grey with a subtle radial highlight to suggest
    // a soft pool of light in the centre.
    const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.55);
    grad.addColorStop(0, "#3a3551");
    grad.addColorStop(1, "#1f1a30");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    // Subtle darker speckles — texture variation, no big shapes.
    ctx.globalAlpha = 0.15;
    for (let i = 0; i < 600; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? "#2a2540" : "#4a3f60";
      const x = Math.random() * size, y = Math.random() * size;
      const r = 3 + Math.random() * 8;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // Tiny vertical grass blades — pairs of thin lines coming up from a base
    // point. Matches the V1 tufts visible on the dusk ground.
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.2;
    const grassColors = ["#5a8a3a", "#79a655", "#6fb46a", "#4e7a36", "#7ab472"];
    for (let i = 0; i < 380; i++) {
      ctx.strokeStyle = grassColors[Math.floor(Math.random() * grassColors.length)];
      const bx = Math.random() * size, by = Math.random() * size;
      const h = 4 + Math.random() * 8;
      ctx.beginPath();
      ctx.moveTo(bx, by); ctx.lineTo(bx - 1, by - h);
      ctx.moveTo(bx, by); ctx.lineTo(bx + 1, by - h);
      ctx.stroke();
    }
    // Painterly flower tufts — small pastel petal clusters scattered across
    // the plain. Match V1's pink/yellow/white wildflower vocabulary.
    ctx.globalAlpha = 0.9;
    const flowers = ["#ffd1e8", "#ffe26a", "#bba2ff", "#ffac6b", "#ffffff", "#ff8aae", "#9be3ff"];
    for (let i = 0; i < 320; i++) {
      ctx.fillStyle = flowers[Math.floor(Math.random() * flowers.length)];
      const cx = Math.random() * size, cy = Math.random() * size;
      const r = 1.4 + Math.random() * 1.8;
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
    for (const c of charDefs) {
      if (c.model) promises.push(this._loadGLB(c));
      if (c.portrait) promises.push(this._loadSpriteTexture(c));
    }
    // Also load painted scenery textures used by _scatterScenery. We can't load
    // them during the constructor because TextureLoader is async — and we want
    // the scenery sprites to be ready by the time the user dismisses welcome.
    promises.push(this._loadSceneryTextures());
    return Promise.all(promises);
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
    };
    this.actors.push(actor);
    if (this.focus && this.focus.id === actor.id) this._refreshInspector();
    return actor;
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

    // Per-event updaters (snow particles, etc.)
    for (let i = this.updaters.length - 1; i >= 0; i--) {
      try { this.updaters[i](dt); } catch (err) { this.updaters.splice(i, 1); }
    }
  }

  _tickActor(actor, dt) {
    const def = actor.def;
    const m = actor.mesh;
    // Wander within the ground disc.
    const speed = def.id === "magma" && actor._dashUntil > performance.now() ? 8 : 1.2;
    actor.heading += rand(-0.02, 0.02);
    const radius = GROUND_RADIUS - 3;
    const distFromCenter = Math.hypot(m.position.x, m.position.z);
    if (distFromCenter > radius) {
      // turn back toward center
      const desired = Math.atan2(-m.position.z, -m.position.x);
      actor.heading = desired + rand(-0.1, 0.1);
    }
    m.position.x += Math.cos(actor.heading) * speed * dt / 1000;
    m.position.z += Math.sin(actor.heading) * speed * dt / 1000;

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

    // Joy ticks up; faster in preferred time.
    const tname = this.timeName();
    const pref = def.prefersTime;
    const joyRate = (pref === "any" || pref === tname) ? 0.00004 : 0.00002;
    actor.joy = Math.min(1, actor.joy + dt * joyRate);

    if (typeof def.onMove === "function") def.onMove(this, actor);

    // Mossback's shell grows occasionally.
    if (def.id === "mossback" && Math.random() < 0.0006) this.plantOnTurtle(actor);

    // Whisper teleports rarely at night.
    if (def.id === "whisper" && tname === "night" && Math.random() < 0.0004) this.teleportActor(actor, null);

    if (this.focus && this.focus.id === actor.id) this._refreshInspector();
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
  _persist() {
    if (typeof localStorage === "undefined") return;
    try {
      const actorState = {};
      for (const a of this.actors) actorState[a.id] = { joy: a.joy, mood: a.mood };
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
