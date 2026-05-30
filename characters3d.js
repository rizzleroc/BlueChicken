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

// ----- 0. BLUE CHICKEN — gateway hatchling (always first) -------------------

// Blue is the only character that gets an egg at boot. The other nine are
// "prize animals" unlocked progressively by caring for her (see care.js +
// PRIZE_THRESHOLDS). She's the BlueChicken repo's mascot finally in the game.
const bluechicken = {
  id: "bluechicken",
  portrait: "docs/portraits/bluechicken.png",
  model: "docs/models/bluechicken.glb",
  modelTargetHeight: 1.8,
  // Determined empirically via a yaw sweep (8 angles at π/4 increments):
  // applying π to the GLB at load time orients her so her face direction
  // aligns with the procedural convention (+X local), which is where the
  // face widget is parented. Without this, her face is on her side or back.
  modelYaw: Math.PI,
  spriteScale: 2.4,
  // The procedural buildBody() is ~1 unit tall; the default 2× spriteScale
  // bump (= 4.8) made her tower over the care-view camera frame. 1.8 puts
  // her at a Tamagotchi-pet height in the cozy close-up.
  proceduralScale: 1.8,
  name: "Blue",
  role: "Hatchling Keeper",
  story: "Blue hatched first, fluffed up, and waited. The valley has been ready for her ever since. Care for her well and the world will come.",
  palette: { body: 0x2a6bff, belly: 0x9ec8ff, accent: 0xffc35a },
  prefersTime: "any",
  isGateway: true,           // marks her as the always-first hatchling
  buildEgg() {
    return eggBase(0xc8e0ff, (g) => {
      // a tiny crown-tuft on top, hinting at her identity before she hatches
      const tuft = meshOf(new THREE.SphereGeometry(0.08, 8, 6), std(0x2a6bff), false);
      tuft.scale.set(1.1, 0.6, 1.1);
      tuft.position.y = 0.28;
      g.add(tuft);
      // little orange beak speck
      const beak = meshOf(new THREE.ConeGeometry(0.04, 0.08, 4), std(0xff8a2a), false);
      beak.rotation.z = -Math.PI / 2;
      beak.position.set(0.18, -0.02, 0);
      g.add(beak);
    });
  },
  buildBody() {
    const g = new THREE.Group();
    // --- ROBOT-CHICKEN body --------------------------------------------------
    // Slightly metallic blue chassis with a pulsing chest LED, brass beak, an
    // antenna, and tiny rivets along the seam — same affectionate-robot read
    // as the V1 portrait, just sculpted in 3D. References on the group so the
    // world tick can pulse the LED/antenna.
    const chassis = new THREE.MeshStandardMaterial({
      color: this.palette.body,
      roughness: 0.4,
      metalness: 0.55,
    });
    const bellyMat = new THREE.MeshStandardMaterial({
      color: this.palette.belly,
      roughness: 0.55,
      metalness: 0.3,
    });
    const brassMat = new THREE.MeshStandardMaterial({
      color: this.palette.accent,
      roughness: 0.45,
      metalness: 0.7,
    });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 14), chassis);
    body.scale.set(1, 0.95, 1);
    g.add(body);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), bellyMat);
    belly.position.set(0, -0.05, 0.12);
    g.add(belly);

    // Seam ring around the body — five tiny rivets along the equator.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 5), brassMat);
      rivet.position.set(Math.cos(a) * 0.44, 0.02, Math.sin(a) * 0.44);
      g.add(rivet);
    }

    // Chest LED — a small additive disc that the tick loop pulses.
    const ledMat = new THREE.MeshBasicMaterial({
      color: 0xffd57f,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), ledMat);
    led.position.set(0.42, 0.04, 0.0);
    led.rotation.y = Math.PI / 2;
    g.add(led);
    g.userData.led = led; // tick loop pulses this

    // Crown tuft — repurposed as a small antenna with a glowing ball on top.
    const antennaStem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6),
      brassMat,
    );
    antennaStem.position.set(0.05, 0.55, 0);
    g.add(antennaStem);
    const antennaBulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd57f, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    antennaBulb.position.set(0.05, 0.7, 0);
    g.add(antennaBulb);
    g.userData.antennaBulb = antennaBulb;

    // Wings — slightly angled plates so they read as articulated panels.
    for (const z of [0.32, -0.32]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.32), chassis);
      w.position.set(-0.02, 0.0, z);
      w.rotation.z = z > 0 ? -0.12 : 0.12;
      g.add(w);
    }

    // Brass beak — tracked on userData so _tickBlueFace can pop it open
    // for emotes or angle it for smile/frown.
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 6), brassMat);
    beak.rotation.z = -Math.PI / 2;
    beak.position.set(0.42, -0.02, 0);
    g.add(beak);
    g.userData.beak = beak;
    g.userData.beakBasePos = beak.position.clone();
    g.userData.beakBaseRot = beak.rotation.clone();

    // Camera-eye LEDs — black sclera + glowing dot inside. Bigger than a
    // realistic chicken eye so the player can actually read her expressions
    // from the care-view camera distance (~7.5u away). Track each socket
    // + glow + brow so the face animator can blink, color the glow with
    // mood, and tilt the brow into smiles / frowns.
    const eyeSocketMat = new THREE.MeshStandardMaterial({ color: 0x0a0a18, roughness: 0.3, metalness: 0.6 });
    const eyeGlowMat = new THREE.MeshBasicMaterial({ color: 0xb8e4ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const browMat = new THREE.MeshStandardMaterial({ color: 0x0a0a18, roughness: 0.5, metalness: 0.2 });
    const eyes = [];
    for (const z of [0.18, -0.18]) {
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), eyeSocketMat.clone());
      socket.position.set(0.32, 0.16, z);
      g.add(socket);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), eyeGlowMat.clone());
      glow.position.set(0.40, 0.16, z);
      g.add(glow);
      // White highlight dot — makes the eye feel "alive" (catchlight).
      const hi = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      );
      hi.position.set(0.45, 0.20, z + (z > 0 ? -0.02 : 0.02));
      g.add(hi);
      // Brow — small dark plate above the eye that tilts to express emotion.
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.04), browMat);
      brow.position.set(0.36, 0.31, z);
      brow.userData.basePos = brow.position.clone();
      brow.userData.baseRot = brow.rotation.clone();
      g.add(brow);
      eyes.push({ socket, glow, hi, brow, baseScaleY: 1 });
    }
    g.userData.eyes = eyes;

    // Legs — brass cylinders + tiny foot pads.
    for (const z of [0.1, -0.1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.22, 6), brassMat);
      leg.position.set(0, -0.4, z);
      g.add(leg);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.1), brassMat);
      foot.position.set(0.02, -0.52, z);
      g.add(foot);
    }

    // The whole rig casts/receives shadows so she reads as a solid object
    // sitting on the coop floor.
    g.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    return g;
  },
  specialLabel: "Sing a soft song",
  specialCooldownMs: 6000,
  special(world, actor) {
    world.toast(actor.name + " sings a soft little song.");
    world.discover(actor.id, "Sang a song — joy lifted across the valley.");
    // Gateway perk: her song bumps every other hatched actor's joy.
    for (const a of world.actors) a.joy = Math.min(1, a.joy + 0.05);
  },
  reactTo(eventId, world, self) {
    // Blue is the keeper. She greets every visitor in character — a calm hop,
    // a gentle bow, a quiet vigil — so the world never passes her unnoticed.
    // The "blue/<event>" flag gates the journal line so her log doesn't spam,
    // but the visible reaction (hop / joy / heading / cluck) fires every time.
    const once = (flag) => {
      if (world.hasFlag(flag)) return false;
      world.flagSeen(flag);
      return true;
    };
    const cluck = () => { if (world.audio && world.audio.cluck) world.audio.cluck(); };
    const emote = (emoji) => { if (world.emoteActor) world.emoteActor(self, emoji); };
    // Aim Blue's heading toward another actor she wants to be near (huddle).
    // Returns true if she found one; false if she's the only one out.
    const turnToNearestPeer = () => {
      let best = null, bestD = Infinity;
      for (const a of world.actors) {
        if (a.id === self.id) continue;
        const d = a.mesh.position.distanceTo(self.mesh.position);
        if (d < bestD) { best = a; bestD = d; }
      }
      if (!best) return false;
      self.heading = Math.atan2(
        best.mesh.position.z - self.mesh.position.z,
        best.mesh.position.x - self.mesh.position.x
      );
      return true;
    };
    switch (eventId) {
      // ---- scheduled visitors / weather ----
      case "ufo":
        cluck();
        emote("🛸");
        world.hopActor(self, 0.45, 500);
        self.joy = Math.min(1, self.joy + 0.05);
        if (once("blue/ufo")) world.discover(self.id, "Watched a UFO drift overhead.");
        break;
      case "firstContact":
        // A small bow toward the visitor: dip down then rise. She walks
        // toward the nearest peer afterward so the visitor finds the flock.
        cluck();
        emote("👋");
        world.hopActor(self, -0.15, 700);
        turnToNearestPeer();
        self.joy = Math.min(1, self.joy + 0.10);
        if (once("blue/firstContact")) world.discover(self.id, "Bowed to the visitor from the stars.");
        break;
      case "wolf":
        // Crouch low, point away from the valley's edge, and stay quiet.
        emote("😨");
        self.mood = "scared";
        self.joy = Math.max(0, self.joy - 0.04);
        self.heading = Math.atan2(-self.mesh.position.z, -self.mesh.position.x);
        if (once("blue/wolf")) world.discover(self.id, "Hid still until the wolf passed.");
        break;
      case "winter":
        // Fluffs up and heads toward another hatchling — the warm spot others
        // gather around. Huddle is the visible behavior here.
        emote("🥶");
        self.mood = "cold";
        self.joy = Math.max(0, self.joy - 0.02);
        turnToNearestPeer();
        if (once("blue/winter")) world.discover(self.id, "Fluffed up against the chill.");
        break;
      case "snowfall":
        // Hop in the snow and leave a tiny pale footprint trail.
        cluck();
        emote("❄️");
        world.hopActor(self, 0.35, 450);
        self.joy = Math.min(1, self.joy + 0.05);
        for (let i = 0; i < 3; i++) {
          setTimeout(() => world.spawnFootprint(self.mesh.position, 0xcfe4f5), i * 140);
        }
        if (once("blue/snowfall")) world.discover(self.id, "Made tiny footprints in the snow.");
        break;
      case "thaw":
        // Celebratory double-hop as the cold breaks.
        cluck();
        emote("🌷");
        self.mood = "radiant";
        world.hopActor(self, 0.55, 500);
        setTimeout(() => world.hopActor(self, 0.4, 400), 520);
        self.joy = Math.min(1, self.joy + 0.08);
        if (once("blue/thaw")) world.discover(self.id, "Sang as the world warmed back.");
        break;
      case "auroraBorealis":
        // Gaze up, soft joy lift.
        emote("✨");
        world.hopActor(self, 0.25, 700);
        self.joy = Math.min(1, self.joy + 0.06);
        if (once("blue/auroraBorealis")) world.discover(self.id, "Watched the sky paint itself.");
        break;
      case "meteor":
        // A wishful little hop.
        cluck();
        emote("⭐");
        world.hopActor(self, 0.45, 500);
        self.joy = Math.min(1, self.joy + 0.07);
        if (once("blue/meteor")) world.discover(self.id, "Made a wish on a streak of fire.");
        break;
      case "eclipse":
        // Settles down — calm, not afraid.
        emote("🌑");
        self.joy = Math.max(0, self.joy - 0.02);
        if (once("blue/eclipse")) world.discover(self.id, "Sat quietly through the dimming.");
        break;

      // ---- peer-special cheers (broadcast from EventDirector.run) ----
      case "constellation":
        emote("⭐");
        world.hopActor(self, 0.3, 450);
        self.joy = Math.min(1, self.joy + 0.04);
        if (once("blue/constellation")) world.discover(self.id, "Cheered Aurora's star-song.");
        break;
      case "rainbow":
        emote("🌈");
        world.hopActor(self, 0.35, 450);
        self.joy = Math.min(1, self.joy + 0.05);
        if (once("blue/rainbow")) world.discover(self.id, "Caught Glimmer's rainbow on her wing.");
        break;
      case "pipRain":
        emote("💧");
        world.hopActor(self, 0.3, 500);
        self.joy = Math.min(1, self.joy + 0.04);
        if (once("blue/pipRain")) world.discover(self.id, "Danced under Pip's pocket storm.");
        break;
      case "memoryBubble":
        emote("💭");
        world.hopActor(self, 0.2, 400);
        self.joy = Math.min(1, self.joy + 0.03);
        break;
      case "rebirth":
        emote("🔥");
        world.hopActor(self, 0.4, 500);
        self.joy = Math.min(1, self.joy + 0.05);
        if (once("blue/rebirth")) world.discover(self.id, "Cheered Ember's rebirth in flame.");
        break;
    }
  },
};

// ----- 1. AURORA — Sky-Whale ------------------------------------------------

const aurora = {
  id: "aurora",
  portrait: "docs/portraits/aurora.png",
  model: "docs/models/aurora.glb",
  modelTargetHeight: 3.0,
  // GLB authored facing -X; +π/2 aligns the face to the +Z heading convention.
  modelYaw: Math.PI / 2,
  spriteScale: 3.5,
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
  reactTo(eventId, world, self) {
    // Loves anything in the sky; the dimming sun unsettles her.
    if (eventId === "ufo" || eventId === "auroraBorealis" || eventId === "meteor") {
      self.joy = Math.min(1, self.joy + 0.06);
    }
    if (eventId === "eclipse") self.joy = Math.max(0, self.joy - 0.05);
  },
};

// ----- 2. MAGMA — Lava Pup --------------------------------------------------

const magma = {
  id: "magma",
  portrait: "docs/portraits/magma.png",
  model: "docs/models/magma.glb",
  modelTargetHeight: 1.6,
  modelYaw: Math.PI / 2,   // GLB authored facing -X (see aurora)
  spriteScale: 1.8,
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
  reactTo(eventId, world, self) {
    // Fearless guard dog — dashes at threats. Hates the cold.
    if (eventId === "wolf") { world.dashActor(self, 4); self.joy = Math.max(0, self.joy - 0.04); }
    if (eventId === "winter" || eventId === "snowfall") self.joy = Math.max(0, self.joy - 0.08);
    if (eventId === "thaw" || eventId === "eclipse") self.joy = Math.min(1, self.joy + 0.05);
  },
};

// ----- 3. GLIMMER — Crystal Fox --------------------------------------------

const glimmer = {
  id: "glimmer",
  portrait: "docs/portraits/glimmer.png",
  model: "docs/models/glimmer.glb",
  modelTargetHeight: 1.6,
  modelYaw: Math.PI / 2,   // GLB authored facing -X (see aurora)
  spriteScale: 1.8,
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
  reactTo(eventId, world, self) {
    // Refracts every kind of new light; pouts in the dark.
    if (eventId === "ufo" || eventId === "auroraBorealis" || eventId === "meteor") {
      self.joy = Math.min(1, self.joy + 0.07);
    }
    if (eventId === "eclipse") self.joy = Math.max(0, self.joy - 0.06);
  },
};

// ----- 4. MOSSBACK — Garden Turtle ------------------------------------------

const mossback = {
  id: "mossback",
  model: "docs/models/mossback.glb",
  modelTargetHeight: 1.7,
  modelYaw: Math.PI / 2,   // GLB authored facing -X (see aurora)
  portrait: "docs/portraits/mossback.png",
  spriteScale: 2.2,
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
  reactTo(eventId, world, self) {
    // The anchor. She doesn't flinch — others cluster near her in winter.
    if (eventId === "winter") { self.vx = 0; self.vz = 0; }
    if (eventId === "meteor" || eventId === "auroraBorealis") self.joy = Math.min(1, self.joy + 0.04);
  },
};

// ----- 5. WHISPER — Shadow Cat ----------------------------------------------

const whisper = {
  id: "whisper",
  portrait: "docs/portraits/whisper.png",
  model: "docs/models/whisper.glb",
  modelTargetHeight: 1.7,
  modelYaw: Math.PI / 2,   // GLB authored facing -X (see aurora)
  spriteScale: 1.9,
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
  reactTo(eventId, world, self) {
    // Comes alive in shadow. Vanishes when a wolf shows up.
    if (eventId === "eclipse")        self.joy = Math.min(1, self.joy + 0.12);
    if (eventId === "winter" || eventId === "snowfall") self.joy = Math.min(1, self.joy + 0.06);
    if (eventId === "auroraBorealis") world.teleportActor(self, null);
    if (eventId === "wolf")           world.teleportActor(self, null);
  },
};

// ----- 6. PIP — Storm Sparrow -----------------------------------------------

const pip = {
  id: "pip",
  portrait: "docs/portraits/pip.png",
  model: "docs/models/pip.glb",
  modelTargetHeight: 1.3,
  modelYaw: Math.PI / 2,   // GLB authored facing -X (see aurora)
  spriteScale: 1.5,
  flying: true,
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
  reactTo(eventId, world, self) {
    // Tiny and skittish. Flees the wolf, sad without rain, jubilant at thaw.
    if (eventId === "wolf") { self.heading += Math.PI; self.joy = Math.max(0, self.joy - 0.05); }
    if (eventId === "winter") self.joy = Math.max(0, self.joy - 0.05);
    if (eventId === "thaw")   self.joy = Math.min(1, self.joy + 0.08);
  },
};

// ----- 7. BUBBLE — Deep Jelly -----------------------------------------------

const bubble = {
  id: "bubble",
  portrait: "docs/portraits/bubble.png",
  model: "docs/models/bubble.glb",
  modelTargetHeight: 2.0,
  modelYaw: Math.PI / 2,   // GLB authored facing -X (see aurora)
  spriteScale: 2.2,
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
  reactTo(eventId, world, self) {
    // Curious drifter — bobs higher to look at strange things.
    if (eventId === "ufo" || eventId === "auroraBorealis" || eventId === "meteor") {
      self.joy = Math.min(1, self.joy + 0.05);
    }
    if (eventId === "winter") self.joy = Math.max(0, self.joy - 0.04);
  },
};

// ----- 8. EMBER — Phoenix Chick ---------------------------------------------

const ember = {
  id: "ember",
  portrait: "docs/portraits/ember.png",
  model: "docs/models/ember.glb",
  modelTargetHeight: 1.7,
  modelYaw: Math.PI / 2,   // GLB authored facing -X (see aurora)
  spriteScale: 1.9,
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
  reactTo(eventId, world, self) {
    // He IS the sun's apprentice. An eclipse staggers him.
    if (eventId === "eclipse") self.joy = Math.max(0, self.joy - 0.12);
    if (eventId === "meteor")  self.joy = Math.min(1, self.joy + 0.08);
    if (eventId === "winter")  self.joy = Math.max(0, self.joy - 0.06);
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
  spriteScale: 2.6,
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
  reactTo(eventId, world, self) {
    // The First Egg has seen everything; she joys at cosmic visits gently.
    if (eventId === "ufo" || eventId === "firstContact" || eventId === "auroraBorealis" || eventId === "meteor" || eventId === "eclipse") {
      self.joy = Math.min(1, self.joy + 0.04);
    }
  },
};

// -----------------------------------------------------------------------------

export const CHARACTERS = [bluechicken, aurora, magma, glimmer, mossback, whisper, pip, bubble, ember, solis];
export const CHARACTER_BY_ID = CHARACTERS.reduce((m, c) => (m[c.id] = c, m), {});
