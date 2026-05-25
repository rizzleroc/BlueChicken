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
    this._buildGround();
    this._scatterScenery();
    this._buildStars();

    this.actors = [];
    this.eggs = {};         // id -> { mesh, taps, charDef }
    this.discoveries = {};  // id -> string[]
    this.bubbles = [];      // memory bubbles (for click pick)
    this.flags = {};        // event flags (e.g. ufo seen)

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
    this.toastEl = document.getElementById("toast");
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

  // Draw a brush-stroke ground onto an offscreen canvas. Many overlapping
  // soft circles of slightly-varied greens give the painterly feel, plus a
  // handful of warm and floral accents.
  _makePaintedGroundTexture() {
    const size = 1024;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    // base wash
    const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.55);
    grad.addColorStop(0, "#69954b");
    grad.addColorStop(1, "#3f5a30");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    // grass splotches
    const greens = ["#5a8a3a", "#79a655", "#3f6128", "#88b466", "#4e7a36", "#a3c378"];
    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = greens[Math.floor(Math.random() * greens.length)];
      ctx.globalAlpha = 0.22 + Math.random() * 0.4;
      const x = Math.random() * size, y = Math.random() * size;
      const r = 8 + Math.random() * 38;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.6 + Math.random() * 0.7), Math.random() * Math.PI, 0, Math.PI * 2); ctx.fill();
    }
    // dirt patches
    ctx.globalAlpha = 0.35;
    const dirts = ["#6b4a2a", "#7a5a36", "#553820"];
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = dirts[Math.floor(Math.random() * dirts.length)];
      const x = Math.random() * size, y = Math.random() * size;
      const r = 8 + Math.random() * 22;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // wildflower specks
    ctx.globalAlpha = 0.75;
    const flowers = ["#ffd1e8", "#ffe26a", "#bba2ff", "#ffac6b", "#a0e8c3", "#ffffff"];
    for (let i = 0; i < 240; i++) {
      ctx.fillStyle = flowers[Math.floor(Math.random() * flowers.length)];
      const x = Math.random() * size, y = Math.random() * size;
      ctx.beginPath(); ctx.arc(x, y, 1.2 + Math.random() * 2.2, 0, Math.PI * 2); ctx.fill();
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
    // Trees: a low-poly conifer (cylinder trunk, stacked cones).
    const trunkMat = std(0x4a2f1a);
    const leafMat = std(0x355d2a);
    const N = 18;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2 + rand(-0.2, 0.2);
      const r = rand(GROUND_RADIUS * 0.55, GROUND_RADIUS - 1.5);
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.0, 6), trunkMat);
      trunk.position.y = 0.5;
      trunk.castShadow = true;
      tree.add(trunk);
      for (let s = 0; s < 3; s++) {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.95 - s * 0.18, 1.2 - s * 0.18, 8),
          leafMat
        );
        cone.position.y = 1.1 + s * 0.55;
        cone.castShadow = true;
        tree.add(cone);
      }
      tree.position.set(x, 0, z);
      tree.rotation.y = rand(0, Math.PI * 2);
      tree.scale.setScalar(rand(0.85, 1.4));
      this.scene.add(tree);
    }
    // A few rocks
    for (let i = 0; i < 12; i++) {
      const rock = new THREE.Mesh(
        new THREE.IcosahedronGeometry(rand(0.35, 0.7), 0),
        std(0x7a8088)
      );
      rock.position.set(rand(-22, 22), 0.2, rand(-22, 22));
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.scene.add(rock);
    }
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
    this.weatherIcon.textContent = i;
    this.weatherLabel.textContent = l;
  }

  cycleTime() {
    this.timeT = TIME_DURATION_MS;
  }

  _applyTimeBlend(dt) {
    this.timeT += dt;
    if (this.timeT >= TIME_DURATION_MS) {
      this.timeT -= TIME_DURATION_MS;
      this.timeIdx = (this.timeIdx + 1) % TIMES.length;
      const map = { dawn: ["☼", "Dawn"], day: ["☀", "Day"], dusk: ["☾", "Dusk"], night: ["✦", "Night"] };
      const [icon, label] = map[this.timeName()];
      this.timeIcon.textContent = icon;
      this.timeLabel.textContent = label;
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
    // Sun position rides an arc across the cycle.
    const fullT = (this.timeIdx + t) / TIMES.length; // 0..1 over full cycle
    const ang = fullT * Math.PI * 2;
    this.sun.position.set(Math.cos(ang) * 30, Math.max(2, Math.sin(ang) * 30), Math.sin(ang) * 10);
    this.sun.intensity = Math.max(0.05, Math.sin(ang) * 1.6);
    // Stars fade in at night.
    const isNight = cur === "night";
    const isDuskOrDawn = cur === "dusk" || cur === "dawn";
    let targetOpacity = isNight ? 1 : isDuskOrDawn ? 0.4 : 0;
    this.starMat.opacity += (targetOpacity - this.starMat.opacity) * 0.02;
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
    return Promise.all(promises);
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
    const mesh = charDef.buildEgg();
    mesh.position.copy(position);
    mesh.userData = { kind: "egg", charId: charDef.id };
    // make every mesh under the egg pickable by raycaster via userData on parents
    mesh.traverse((c) => { if (c.isMesh) c.userData.eggRef = mesh; });
    this.scene.add(mesh);
    this.eggs[charDef.id] = { mesh, taps: 0, charDef, basePos: position.clone(), bobPhase: Math.random() * 10 };
    return mesh;
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
    // burst
    const burst = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff8d0, transparent: true, opacity: 0.9 })
    );
    burst.position.copy(pos);
    this.scene.add(burst);
    const tStart = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - tStart) / 700);
      const s = 0.5 + t * 3.5;
      burst.scale.setScalar(s);
      burst.material.opacity = 0.9 * (1 - t);
      if (t < 1) requestAnimationFrame(step);
      else this.scene.remove(burst);
    };
    requestAnimationFrame(step);

    this.scene.remove(egg.mesh);
    delete this.eggs[charId];

    const actor = this._spawnActor(egg.charDef, pos);
    this.toast(egg.charDef.name + " has hatched.");
    this.discover(egg.charDef.id, "Hatched at " + this.timeName() + ".");
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

  // Priority: GLB (if a Tripo model is in /docs/models/) → painted sprite
  // billboard (if the portrait texture loaded) → procedural buildBody().
  // The sprite is always good if the texture exists; GLB only "wins" when it's
  // explicitly present because we know that's the highest-fidelity result.
  _buildActorMesh(charDef) {
    const glb = this.modelCache[charDef.id];
    if (glb) {
      const cloned = glb.clone(true);
      cloned.traverse((n) => {
        if (n.isMesh && n.material) n.material = n.material.clone();
      });
      return cloned;
    }
    const tex = this.spriteCache[charDef.id];
    if (tex) return this._buildSpriteActor(charDef, tex);
    return charDef.buildBody();
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

    // Egg bob & wiggle.
    const now = performance.now();
    for (const id in this.eggs) {
      const e = this.eggs[id];
      e.mesh.position.y = e.basePos.y + Math.sin(now * 0.002 + e.bobPhase) * 0.05;
      if (e.wiggleT) {
        const wt = (now - e.wiggleT) / 600;
        if (wt < 1) {
          e.mesh.rotation.z = Math.sin(wt * Math.PI * 4) * (0.4 * (1 - wt));
        } else {
          e.mesh.rotation.z = 0;
          e.wiggleT = 0;
        }
      }
      // Cracks: scale down slightly as taps accrue (visual cue).
      e.mesh.scale.setScalar(1 - e.taps * 0.02);
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
    // little bounce
    const baseY = actor.mesh.position.y;
    const tStart = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - tStart) / 400);
      actor.mesh.position.y = baseY + Math.sin(t * Math.PI) * 0.4;
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
    this.toastEl.textContent = message;
    this.toastEl.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toastEl.classList.remove("show"), 3600);
  }
  setEventLabel(label) { this.eventLabel.textContent = label; }
  flagSeen(flag) { this.flags[flag] = true; }
  hasFlag(flag) { return !!this.flags[flag]; }

  discover(id, line) {
    const arr = (this.discoveries[id] = this.discoveries[id] || []);
    if (arr[0] !== line) arr.unshift(line);
    if (arr.length > 12) arr.length = 12;
    if (this.focus && this.focus.id === id) this._refreshInspector();
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
    this.inspector.hidden = true;
    document.querySelectorAll(".slot").forEach((s) => s.classList.remove("active"));
  }

  _refreshInspector() {
    if (!this.focus) return;
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
