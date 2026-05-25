// characters3d.js
// -----------------------------------------------------------------------------
// Same nine souls as the 2D version, rebuilt as low-poly THREE.Group meshes.
// Each character exports:
//   - id, name, role, story, palette, prefersTime, secret
//   - buildEgg()    -> THREE.Group  (the unhatched egg)
//   - buildBody()   -> THREE.Group  (the hatchling, scaled to roughly y=1.5 tall)
//   - specialLabel, specialCooldownMs
//   - special(world, actor) -> visual effect
//
// All meshes have castShadow set on solids and translucent materials disable
// shadow casting (jellies and ghostly things).

import * as THREE from "three";

// ----- shared materials & helpers -------------------------------------------

const std = (color, extra = {}) => new THREE.MeshStandardMaterial(Object.assign({
  color,
  roughness: 0.65,
  metalness: 0.05,
  flatShading: true,
}, extra));

const emissive = (color, intensity = 1.2) => new THREE.MeshStandardMaterial({
  color, emissive: color, emissiveIntensity: intensity, flatShading: true, roughness: 0.4,
});

const glass = (color, opacity = 0.55) => new THREE.MeshStandardMaterial({
  color, transparent: true, opacity, roughness: 0.2, metalness: 0.0, flatShading: true,
});

function meshOf(geom, mat, castShadow = true, receiveShadow = false) {
  const m = new THREE.Mesh(geom, mat);
  m.castShadow = castShadow;
  m.receiveShadow = receiveShadow;
  return m;
}

// Eyes shared across characters: small dark spheres with a tiny highlight.
function makeEye(r = 0.06, offset = [0, 0, 0]) {
  const g = new THREE.Group();
  const ball = meshOf(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshBasicMaterial({ color: 0x0a0710 }));
  const hi = meshOf(new THREE.SphereGeometry(r * 0.35, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  hi.position.set(r * 0.4, r * 0.3, r * 0.6);
  g.add(ball, hi);
  g.position.set(offset[0], offset[1], offset[2]);
  return g;
}

// Base egg: an ovoid (squashed sphere). Each character paints over it with
// extra decorations (speckles, etc.). Returns a Group so callers can append.
function eggBase(colorHex, decorate = (g) => {}) {
  const group = new THREE.Group();
  const body = meshOf(
    new THREE.SphereGeometry(0.45, 18, 14),
    std(colorHex, { roughness: 0.55 })
  );
  body.scale.set(1, 1.32, 1); // ovoid
  group.add(body);
  // A subtle inner highlight via a slightly-smaller, brighter sphere offset up-left.
  const hi = meshOf(
    new THREE.SphereGeometry(0.18, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 })
  );
  hi.position.set(-0.13, 0.22, 0.18);
  group.add(hi);
  decorate(group);
  // Light bobble in y — main3d.js animates each egg with a per-instance phase.
  return group;
}

// ----- 1. AURORA — Sky-Whale ------------------------------------------------

const aurora = {
  id: "aurora",
  portrait: "docs/portraits/aurora.png",
  name: "Aurora",
  role: "Sky-Whale of the Quiet Vault",
  story: "Aurora hatched from a piece of the night that fell. When she sings, the stars remember the shapes she dreams.",
  palette: { body: 0x5d4a9c, belly: 0xa89be0, accent: 0xfbe7a0 },
  prefersTime: "night",
  flying: true,
  buildEgg() {
    return eggBase(0x1c2150, (g) => {
      // dot speckle of stars on the egg surface
      const starMat = new THREE.MeshBasicMaterial({ color: 0xfff8d0 });
      for (let i = 0; i < 14; i++) {
        const s = meshOf(new THREE.SphereGeometry(0.015 + Math.random() * 0.015, 5, 4), starMat, false);
        const t = Math.random() * Math.PI * 2;
        const p = Math.random() * Math.PI - Math.PI / 2;
        s.position.set(Math.cos(p) * Math.cos(t) * 0.46, Math.sin(p) * 0.6, Math.cos(p) * Math.sin(t) * 0.46);
        g.add(s);
      }
    });
  },
  buildBody() {
    const g = new THREE.Group();
    const body = meshOf(new THREE.SphereGeometry(0.8, 18, 14), std(this.palette.body));
    body.scale.set(2.2, 1, 1.2);
    g.add(body);
    const belly = meshOf(new THREE.SphereGeometry(0.7, 16, 12), std(this.palette.belly));
    belly.scale.set(2.0, 0.6, 1.1);
    belly.position.y = -0.18;
    g.add(belly);
    // tail
    const tail = meshOf(new THREE.ConeGeometry(0.45, 0.9, 8), std(this.palette.body));
    tail.rotation.z = Math.PI / 2;
    tail.position.set(-2.0, 0.0, 0.0);
    g.add(tail);
    // dorsal fin
    const fin = meshOf(new THREE.ConeGeometry(0.25, 0.55, 6), std(this.palette.body));
    fin.position.set(0.2, 0.7, 0);
    g.add(fin);
    // star speckles
    for (let i = 0; i < 6; i++) {
      const sp = meshOf(new THREE.SphereGeometry(0.04, 6, 4), new THREE.MeshBasicMaterial({ color: this.palette.accent }), false);
      sp.position.set(-1.4 + i * 0.55, 0.25 + Math.sin(i) * 0.1, 0.6 * (i % 2 ? 1 : -1));
      g.add(sp);
    }
    g.add(makeEye(0.07, [1.55, 0.15, 0.6]));
    g.add(makeEye(0.07, [1.55, 0.15, -0.6]));
    return g;
  },
  specialLabel: "Sing a constellation",
  specialCooldownMs: 8000,
  special(world, actor) {
    world.events.run("constellation", { x: actor.mesh.position.x, z: actor.mesh.position.z });
    world.toast(actor.name + " sings a star-song into the sky.");
    world.discover(actor.id, "Drew a constellation.");
  },
};

// ----- 2. MAGMA — Lava Pup --------------------------------------------------

const magma = {
  id: "magma",
  portrait: "docs/portraits/magma.png",
  name: "Magma",
  role: "Pup of the First Forge",
  story: "Magma was born inside a heart-shaped coal at the bottom of a volcano. He runs because standing still makes flowers wilt.",
  palette: { body: 0xc83a1a, belly: 0xf59230, accent: 0xffd770 },
  prefersTime: "day",
  buildEgg() {
    return eggBase(0x1a0e0a, (g) => {
      const lava = meshOf(
        new THREE.SphereGeometry(0.46, 16, 12),
        emissive(0xff6a1e, 0.8)
      );
      lava.scale.set(0.6, 0.5, 0.6);
      lava.position.y = 0.05;
      g.add(lava);
    });
  },
  buildBody() {
    const g = new THREE.Group();
    const body = meshOf(new THREE.SphereGeometry(0.45, 14, 10), std(this.palette.body));
    body.scale.set(1.2, 0.95, 1.0);
    g.add(body);
    const head = meshOf(new THREE.SphereGeometry(0.32, 14, 10), std(this.palette.body));
    head.position.set(0.55, 0.18, 0);
    g.add(head);
    // ears
    const earGeom = new THREE.ConeGeometry(0.08, 0.18, 6);
    const ear1 = meshOf(earGeom, std(this.palette.body));
    ear1.position.set(0.6, 0.5, 0.18);
    const ear2 = meshOf(earGeom, std(this.palette.body));
    ear2.position.set(0.6, 0.5, -0.18);
    g.add(ear1, ear2);
    // glow underbelly
    const glow = meshOf(new THREE.SphereGeometry(0.36, 14, 10), emissive(this.palette.accent, 1.4));
    glow.scale.set(1.1, 0.4, 0.95);
    glow.position.y = -0.25;
    g.add(glow);
    // ember crown
    const ember = meshOf(new THREE.SphereGeometry(0.08, 8, 6), emissive(this.palette.accent, 2.0), false);
    ember.position.set(0.55, 0.72, 0);
    g.add(ember);
    // legs
    const legGeom = new THREE.CylinderGeometry(0.07, 0.07, 0.25, 6);
    const legMat = std(this.palette.body);
    for (const [x, z] of [[-0.25, 0.18], [-0.25, -0.18], [0.25, 0.18], [0.25, -0.18]]) {
      const l = meshOf(legGeom, legMat);
      l.position.set(x, -0.5, z);
      g.add(l);
    }
    // tail
    const tail = meshOf(new THREE.ConeGeometry(0.1, 0.35, 6), std(this.palette.body));
    tail.rotation.z = -Math.PI / 3;
    tail.position.set(-0.6, 0.1, 0);
    g.add(tail);
    g.add(makeEye(0.05, [0.78, 0.25, 0.14]));
    g.add(makeEye(0.05, [0.78, 0.25, -0.14]));
    return g;
  },
  specialLabel: "Dash & scorch",
  specialCooldownMs: 6000,
  special(world, actor) {
    world.dashActor(actor, 8);
    world.toast(actor.name + " runs hot — careful where you step.");
    world.discover(actor.id, "Scorched the grass with a sprint.");
  },
  onMove(world, actor) {
    if (Math.random() < 0.18) world.spawnFootprint(actor.mesh.position, 0xff8a30);
  },
};

// ----- 3. GLIMMER — Crystal Fox --------------------------------------------

const glimmer = {
  id: "glimmer",
  portrait: "docs/portraits/glimmer.png",
  name: "Glimmer",
  role: "Fox of the Prism Caves",
  story: "Glimmer was the last facet of a crystal that learned to want. She turns to face every light and asks it questions.",
  palette: { body: 0xe8c9ff, belly: 0xffffff, accent: 0x9ad6ff },
  prefersTime: "day",
  buildEgg() {
    return eggBase(0xcfe6ff, (g) => {
      // Add a faceted crystal cap.
      const cap = meshOf(new THREE.OctahedronGeometry(0.22, 0), std(0xb4d9ff, { metalness: 0.4, roughness: 0.2 }));
      cap.position.y = 0.28;
      g.add(cap);
    });
  },
  buildBody() {
    const g = new THREE.Group();
    // body — octahedron for that crystalline silhouette
    const body = meshOf(new THREE.OctahedronGeometry(0.45, 0), std(this.palette.body, { metalness: 0.3, roughness: 0.2 }));
    body.scale.set(1.4, 0.85, 0.85);
    g.add(body);
    // head
    const head = meshOf(new THREE.ConeGeometry(0.22, 0.45, 6), std(this.palette.body, { metalness: 0.3, roughness: 0.2 }));
    head.rotation.z = -Math.PI / 2;
    head.position.set(0.55, 0.1, 0);
    g.add(head);
    // ears
    const earGeom = new THREE.ConeGeometry(0.07, 0.22, 5);
    for (const z of [0.15, -0.15]) {
      const e = meshOf(earGeom, std(this.palette.body));
      e.position.set(0.55, 0.36, z);
      g.add(e);
    }
    // bushy tail (multi-facet)
    for (let i = 0; i < 4; i++) {
      const t = meshOf(new THREE.OctahedronGeometry(0.16 - i * 0.025, 0), std(this.palette.body, { metalness: 0.3, roughness: 0.25 }));
      t.position.set(-0.5 - i * 0.18, 0.1 + i * 0.06, 0);
      g.add(t);
    }
    // legs
    const legGeom = new THREE.CylinderGeometry(0.05, 0.05, 0.25, 6);
    for (const [x, z] of [[-0.18, 0.15], [-0.18, -0.15], [0.2, 0.15], [0.2, -0.15]]) {
      const l = meshOf(legGeom, std(this.palette.body));
      l.position.set(x, -0.45, z);
      g.add(l);
    }
    // sparkle accent
    const acc = meshOf(new THREE.OctahedronGeometry(0.06, 0), emissive(this.palette.accent, 1.5), false);
    acc.position.set(0.1, 0.45, 0);
    g.add(acc);
    g.add(makeEye(0.04, [0.72, 0.16, 0.08]));
    return g;
  },
  specialLabel: "Refract a rainbow",
  specialCooldownMs: 7000,
  special(world, actor) {
    world.events.run("rainbow", { x: actor.mesh.position.x, z: actor.mesh.position.z });
    world.toast(actor.name + " catches the light and casts it free.");
    world.discover(actor.id, "Cast a rainbow.");
  },
};

// ----- 4. MOSSBACK — Garden Turtle ------------------------------------------

const mossback = {
  id: "mossback",
  portrait: "docs/portraits/mossback.png",
  name: "Mossback",
  role: "Turtle of the Slow Forest",
  story: "Mossback has been hatching for a thousand years. Time is just the rate at which moss grows on something patient.",
  palette: { body: 0x7a8c4a, shell: 0x4d6431, belly: 0xcbd190, accent: 0xa3d36a },
  prefersTime: "day",
  buildEgg() {
    return eggBase(0x6e5d3a, (g) => {
      const moss = meshOf(new THREE.SphereGeometry(0.18, 10, 8), std(0x6f9a3f), false);
      moss.scale.set(0.9, 0.4, 0.8);
      moss.position.set(0.05, 0.25, 0.15);
      g.add(moss);
    });
  },
  buildBody() {
    const g = new THREE.Group();
    // shell — half sphere
    const shellGeom = new THREE.SphereGeometry(0.65, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const shell = meshOf(shellGeom, std(this.palette.shell));
    shell.position.y = 0.05;
    g.add(shell);
    // shell rim
    const rim = meshOf(new THREE.TorusGeometry(0.62, 0.05, 8, 24), std(0x3a4a22));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.05;
    g.add(rim);
    // belly disc
    const belly = meshOf(new THREE.CylinderGeometry(0.58, 0.58, 0.08, 16), std(this.palette.belly));
    belly.position.y = -0.0;
    g.add(belly);
    // head
    const head = meshOf(new THREE.SphereGeometry(0.22, 12, 10), std(this.palette.body));
    head.position.set(0.7, 0.05, 0);
    g.add(head);
    // legs (stubby cylinders)
    for (const [x, z] of [[-0.4, 0.4], [-0.4, -0.4], [0.4, 0.4], [0.4, -0.4]]) {
      const l = meshOf(new THREE.CylinderGeometry(0.12, 0.12, 0.18, 8), std(this.palette.body));
      l.position.set(x, -0.18, z);
      g.add(l);
    }
    // garden bed on shell — main3d.js adds flora here over time.
    const garden = new THREE.Group();
    garden.name = "garden";
    garden.position.y = 0.65;
    g.add(garden);
    g.add(makeEye(0.05, [0.84, 0.12, 0.1]));
    g.add(makeEye(0.05, [0.84, 0.12, -0.1]));
    return g;
  },
  specialLabel: "Plant a seed",
  specialCooldownMs: 5000,
  special(world, actor) {
    world.plantOnTurtle(actor);
    world.toast(actor.name + " adds a sprout to her garden.");
    world.discover(actor.id, "Grew a new plant on her shell.");
  },
};

// ----- 5. WHISPER — Shadow Cat ----------------------------------------------

const whisper = {
  id: "whisper",
  portrait: "docs/portraits/whisper.png",
  name: "Whisper",
  role: "Cat of the Unlit Hour",
  story: "Whisper is not one creature but a habit the dark fell into. She visits the same places, never the same shadow twice.",
  palette: { body: 0x2a1f3e, belly: 0x46355f, accent: 0x9d7fff },
  prefersTime: "night",
  riddles: [
    "I have a face but no eyes; I see all things by what they hide.",
    "What walks beside you only when you forget to look?",
    "I am the only door that opens by closing yours.",
    "The smaller my flame, the bigger my country.",
    "I am born of light and yet I cannot bear to see it.",
    "Count me and I vanish; trust me and I deepen.",
  ],
  buildEgg() {
    return eggBase(0x0a0820, (g) => {
      const moon = meshOf(new THREE.TorusGeometry(0.18, 0.02, 6, 18, Math.PI), std(0xcabbff), false);
      moon.position.set(0.15, 0.05, 0.4);
      moon.rotation.set(0, 0, Math.PI / 6);
      g.add(moon);
    });
  },
  buildBody() {
    const g = new THREE.Group();
    const body = meshOf(new THREE.SphereGeometry(0.42, 14, 10), std(this.palette.body));
    body.scale.set(1.4, 0.95, 1.0);
    g.add(body);
    const head = meshOf(new THREE.SphereGeometry(0.3, 14, 10), std(this.palette.body));
    head.position.set(0.55, 0.18, 0);
    g.add(head);
    // ears
    const earGeom = new THREE.ConeGeometry(0.08, 0.22, 5);
    for (const z of [0.18, -0.18]) {
      const e = meshOf(earGeom, std(this.palette.body));
      e.position.set(0.55, 0.5, z);
      g.add(e);
    }
    // long tail (curve via segments)
    for (let i = 0; i < 6; i++) {
      const seg = meshOf(new THREE.SphereGeometry(0.08 - i * 0.008, 8, 6), std(this.palette.body));
      seg.position.set(-0.45 - i * 0.16, 0.05 + i * 0.04, 0);
      g.add(seg);
    }
    // legs
    const legGeom = new THREE.CylinderGeometry(0.06, 0.06, 0.28, 6);
    for (const [x, z] of [[-0.2, 0.18], [-0.2, -0.18], [0.22, 0.18], [0.22, -0.18]]) {
      const l = meshOf(legGeom, std(this.palette.body));
      l.position.set(x, -0.45, z);
      g.add(l);
    }
    // glowing eyes
    for (const z of [0.12, -0.12]) {
      const eye = meshOf(new THREE.SphereGeometry(0.05, 8, 6), emissive(this.palette.accent, 2.5), false);
      eye.position.set(0.78, 0.2, z);
      g.add(eye);
    }
    return g;
  },
  specialLabel: "Slip into shadow",
  specialCooldownMs: 9000,
  special(world, actor) {
    const riddle = this.riddles[Math.floor(Math.random() * this.riddles.length)];
    world.teleportActor(actor, riddle);
    world.toast(actor.name + " is gone. A riddle remains.");
    world.discover(actor.id, "Riddle: " + riddle);
  },
};

// ----- 6. PIP — Storm Sparrow -----------------------------------------------

const pip = {
  id: "pip",
  portrait: "docs/portraits/pip.png",
  name: "Pip",
  role: "Sparrow with a Pocket Storm",
  story: "Pip was hatched in a thundercloud and dropped on a Tuesday. The cloud followed him home. It wasn't done telling him things.",
  palette: { body: 0x5d7ba8, belly: 0xcfe0f0, accent: 0xfdd351 },
  prefersTime: "any",
  buildEgg() {
    return eggBase(0x7a8aa0, (g) => {
      const bolt = meshOf(new THREE.ConeGeometry(0.05, 0.18, 4), emissive(0xfdd351, 1.5), false);
      bolt.position.set(0.05, 0.2, 0.4);
      bolt.rotation.set(0, 0, Math.PI / 8);
      g.add(bolt);
    });
  },
  buildBody() {
    const g = new THREE.Group();
    // pocket cloud above the bird
    const cloud = new THREE.Group();
    cloud.name = "pocketCloud";
    const cMat = std(0xcfd6e0, { roughness: 0.9 });
    for (const [x, y, z, s] of [[0, 0.05, 0, 0.28], [-0.18, 0, 0, 0.22], [0.18, 0, 0, 0.22], [0, -0.06, 0.15, 0.2]]) {
      const c = meshOf(new THREE.SphereGeometry(s, 12, 8), cMat);
      c.position.set(x, y, z);
      cloud.add(c);
    }
    cloud.position.set(0, 1.1, 0);
    g.add(cloud);
    // body
    const body = meshOf(new THREE.SphereGeometry(0.32, 14, 10), std(this.palette.body));
    g.add(body);
    const belly = meshOf(new THREE.SphereGeometry(0.25, 12, 10), std(this.palette.belly));
    belly.position.set(0.0, -0.05, 0.1);
    g.add(belly);
    // wings
    const wingGeom = new THREE.BoxGeometry(0.1, 0.04, 0.28);
    for (const z of [0.3, -0.3]) {
      const w = meshOf(wingGeom, std(0x3f5a85));
      w.position.set(0, 0, z);
      g.add(w);
    }
    // beak
    const beak = meshOf(new THREE.ConeGeometry(0.06, 0.15, 6), std(this.palette.accent));
    beak.rotation.z = -Math.PI / 2;
    beak.position.set(0.32, 0.0, 0);
    g.add(beak);
    g.add(makeEye(0.04, [0.22, 0.12, 0.1]));
    g.add(makeEye(0.04, [0.22, 0.12, -0.1]));
    // legs
    for (const z of [0.1, -0.1]) {
      const leg = meshOf(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 5), std(0x9a7b3f));
      leg.position.set(0, -0.35, z);
      g.add(leg);
    }
    return g;
  },
  specialLabel: "Make it rain",
  specialCooldownMs: 7000,
  special(world, actor) {
    world.events.run("pipRain", { x: actor.mesh.position.x, z: actor.mesh.position.z });
    world.toast(actor.name + "'s little cloud bursts.");
    world.discover(actor.id, "Made it rain — a flower grew.");
  },
};

// ----- 7. BUBBLE — Deep Jelly -----------------------------------------------

const bubble = {
  id: "bubble",
  portrait: "docs/portraits/bubble.png",
  name: "Bubble",
  role: "Jelly of the Drifting Trench",
  story: "Bubble keeps the smallest moments somebody almost forgot. Pop one and you'll catch a glimpse before it returns to the sea.",
  palette: { body: 0xff9ec7, belly: 0xffe5f0, accent: 0xa3eaff },
  prefersTime: "any",
  floating: true,
  memories: [
    "the smell of rain on hot pavement",
    "the third laugh of an old friend",
    "the click of a door closing softly",
    "a song hummed by no one",
    "the dust caught in afternoon light",
    "the first sip of cold water",
    "the weight of a sleeping cat",
    "a moth turning toward a window",
  ],
  buildEgg() {
    return eggBase(0xf7d8e6, (g) => {
      const inner = meshOf(new THREE.SphereGeometry(0.28, 14, 10), glass(0xfff7fb, 0.55), false);
      g.add(inner);
    });
  },
  buildBody() {
    const g = new THREE.Group();
    // bell — hemisphere
    const bellGeom = new THREE.SphereGeometry(0.55, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const bell = meshOf(bellGeom, glass(this.palette.body, 0.7), false);
    bell.position.y = 0.05;
    g.add(bell);
    const inner = meshOf(new THREE.SphereGeometry(0.32, 14, 10), emissive(this.palette.accent, 0.5), false);
    inner.position.y = 0.0;
    g.add(inner);
    // tentacles
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const x = Math.cos(ang) * 0.32;
      const z = Math.sin(ang) * 0.32;
      for (let s = 0; s < 4; s++) {
        const seg = meshOf(new THREE.SphereGeometry(0.04, 6, 4), glass(this.palette.body, 0.75), false);
        seg.position.set(x, -0.1 - s * 0.13, z);
        g.add(seg);
      }
    }
    // tiny face on the inner glow
    for (const z of [0.05, -0.05]) {
      const eye = meshOf(new THREE.SphereGeometry(0.025, 6, 4), new THREE.MeshBasicMaterial({ color: 0x3b1530 }), false);
      eye.position.set(0.25, 0.05, z);
      g.add(eye);
    }
    return g;
  },
  specialLabel: "Release a memory",
  specialCooldownMs: 4000,
  special(world, actor) {
    const memory = this.memories[Math.floor(Math.random() * this.memories.length)];
    world.events.run("memoryBubble", { x: actor.mesh.position.x, z: actor.mesh.position.z, memory });
    world.toast(actor.name + " releases a bubble. Click it before it drifts away.");
    world.discover(actor.id, "Memory released: " + memory);
  },
};

// ----- 8. EMBER — Phoenix Chick ---------------------------------------------

const ember = {
  id: "ember",
  portrait: "docs/portraits/ember.png",
  name: "Ember",
  role: "Phoenix Still Learning to Burn",
  story: "Ember's first life lasted four minutes. He spent it bowing to a beetle. He has been bowing to things ever since, between flames.",
  palette: { body: 0xff7a3d, belly: 0xffd95c, accent: 0xff4d6e },
  feathers: [0xff7a3d, 0xff4d6e, 0xa04bff, 0x3dc6ff, 0x4dff9e, 0xffd23d],
  featherIndex: 0,
  prefersTime: "day",
  buildEgg() {
    return eggBase(0x5a1e10, (g) => {
      const flame = meshOf(new THREE.ConeGeometry(0.2, 0.32, 6), emissive(0xff7a3d, 1.2), false);
      flame.position.y = 0.18;
      g.add(flame);
    });
  },
  buildBody() {
    const g = new THREE.Group();
    const body = meshOf(new THREE.SphereGeometry(0.4, 14, 10), std(this.palette.body));
    g.add(body);
    const belly = meshOf(new THREE.SphereGeometry(0.28, 12, 10), std(this.palette.belly));
    belly.position.set(0, -0.05, 0.12);
    g.add(belly);
    // tail feathers — splayed cones
    for (let i = -1; i <= 1; i++) {
      const t = meshOf(new THREE.ConeGeometry(0.1, 0.4, 5), std(this.palette.accent));
      t.rotation.z = Math.PI / 2 + i * 0.5;
      t.position.set(-0.4, 0.05 + i * 0.1, 0);
      g.add(t);
    }
    // wings
    for (const z of [0.32, -0.32]) {
      const w = meshOf(new THREE.BoxGeometry(0.1, 0.05, 0.3), std(this.palette.accent));
      w.position.set(0, 0, z);
      g.add(w);
    }
    // crest
    const crest = meshOf(new THREE.ConeGeometry(0.08, 0.25, 5), std(this.palette.accent));
    crest.position.set(0.15, 0.4, 0);
    g.add(crest);
    // beak
    const beak = meshOf(new THREE.ConeGeometry(0.07, 0.18, 5), std(0xffb14a));
    beak.rotation.z = -Math.PI / 2;
    beak.position.set(0.4, 0.0, 0);
    g.add(beak);
    g.add(makeEye(0.04, [0.28, 0.12, 0.1]));
    g.add(makeEye(0.04, [0.28, 0.12, -0.1]));
    // legs
    for (const z of [0.08, -0.08]) {
      const leg = meshOf(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 5), std(0xb96820));
      leg.position.set(0, -0.4, z);
      g.add(leg);
    }
    return g;
  },
  specialLabel: "Rebirth in flame",
  specialCooldownMs: 10000,
  special(world, actor) {
    this.featherIndex = (this.featherIndex + 1) % this.feathers.length;
    const newColor = this.feathers[this.featherIndex];
    const accentIdx = (this.featherIndex + 2) % this.feathers.length;
    this.palette.body = newColor;
    this.palette.accent = this.feathers[accentIdx];
    world.events.run("rebirth", { actor });
    world.toast(actor.name + " burns away — and returns " + describeColor(newColor) + ".");
    world.discover(actor.id, "Reborn as " + describeColor(newColor) + ".");
  },
};

function describeColor(hex) {
  const map = {
    0xff7a3d: "ember-orange",
    0xff4d6e: "rose-flame",
    0xa04bff: "twilight-violet",
    0x3dc6ff: "frost-blue",
    0x4dff9e: "spring-green",
    0xffd23d: "morning-gold",
  };
  return map[hex] || "a new color";
}

// ----- 9. SOLIS — Secret ----------------------------------------------------

const solis = {
  id: "solis",
  portrait: "docs/portraits/solis.png",
  name: "Solis",
  role: "The First Egg, Finally Listening",
  story: "Solis was the original egg, asleep beneath every other. When the eight are happy, she finally remembers she was waiting for them.",
  palette: { body: 0xfff8d0, belly: 0xffffff, accent: 0xffc060 },
  secret: true,
  prefersTime: "any",
  floating: true,
  buildEgg() {
    return eggBase(0xfff8d0, (g) => {
      const halo = meshOf(new THREE.TorusGeometry(0.5, 0.04, 8, 24), emissive(0xffc060, 1.0), false);
      halo.rotation.x = Math.PI / 2;
      g.add(halo);
    });
  },
  buildBody() {
    const g = new THREE.Group();
    const body = meshOf(new THREE.SphereGeometry(0.55, 18, 14), emissive(this.palette.body, 1.2), false);
    g.add(body);
    const ring = meshOf(new THREE.TorusGeometry(0.85, 0.05, 8, 32), emissive(this.palette.accent, 1.0), false);
    ring.rotation.x = Math.PI / 3;
    g.add(ring);
    const ring2 = meshOf(new THREE.TorusGeometry(0.7, 0.04, 8, 32), emissive(this.palette.accent, 0.8), false);
    ring2.rotation.x = -Math.PI / 4;
    ring2.rotation.z = Math.PI / 6;
    g.add(ring2);
    // little motes
    for (let i = 0; i < 6; i++) {
      const m = meshOf(new THREE.SphereGeometry(0.05, 6, 4), emissive(this.palette.accent, 1.5), false);
      const a = (i / 6) * Math.PI * 2;
      m.position.set(Math.cos(a) * 1.1, Math.sin(a) * 0.4, Math.sin(a) * 1.1);
      g.add(m);
    }
    return g;
  },
  specialLabel: "Shift the world",
  specialCooldownMs: 12000,
  special(world, actor) {
    world.cycleTime();
    world.toast(actor.name + " turns the day on its hinge.");
    world.discover(actor.id, "Bent time forward.");
  },
};

// -----------------------------------------------------------------------------

export const CHARACTERS = [aurora, magma, glimmer, mossback, whisper, pip, bubble, ember, solis];
export const CHARACTER_BY_ID = CHARACTERS.reduce((m, c) => (m[c.id] = c, m), {});
