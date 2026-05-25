// events.js
// -----------------------------------------------------------------------------
// World events come in two flavors:
//   1. Scheduled visitors / weather — UFO, first contact, wolves, polar bears,
//      freezing, snowfall, igloo build, aurora borealis, meteor shower, eclipse.
//   2. Character specials — constellation, rainbow, pipRain, memoryBubble,
//      rebirth. These are triggered by the characters and visualized here.
//
// EventDirector picks one scheduled event every 25-55 seconds when nothing is
// active. The "winter" sequence (freeze → snow → igloo build → polar bear) runs
// as one extended event because the visuals stack.

import * as THREE from "three";

// shared helpers -------------------------------------------------------------

const rand = (a, b) => a + Math.random() * (b - a);
const choose = (arr) => arr[Math.floor(Math.random() * arr.length)];

function std(color, extra = {}) {
  return new THREE.MeshStandardMaterial(Object.assign({
    color, roughness: 0.7, metalness: 0.05, flatShading: true,
  }, extra));
}
function emissive(color, intensity = 1.2) {
  return new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: intensity, flatShading: true, roughness: 0.4,
  });
}

// ---------- Scheduled events ------------------------------------------------

/* Each scheduled event is `{ id, label, weight, duration, run(world) }`.
   run(world) returns a Promise<void> that resolves when the event is over.
   Inside, the event mutates world.scene, world.lights, etc. and is responsible
   for cleaning up its own meshes. */

function wait(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// Smoothly interpolate two values toward a target over `ms`, calling cb each frame.
function tween(obj, key, to, ms, ease = (t) => t) {
  return new Promise((resolve) => {
    const from = obj[key];
    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / ms);
      obj[key] = from + (to - from) * ease(t);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// ---- UFO Visit -------------------------------------------------------------

function buildUFO() {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.5, 0.5, 24),
    std(0x9aa4b0, { metalness: 0.7, roughness: 0.25 })
  );
  disc.castShadow = true;
  g.add(disc);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x9ee5ff, transparent: true, opacity: 0.55, roughness: 0.1, metalness: 0.1 })
  );
  dome.position.y = 0.25;
  g.add(dome);
  // rim lights
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), emissive(0xfff48a, 2.2));
    light.position.set(Math.cos(a) * 2.45, -0.15, Math.sin(a) * 2.45);
    light.userData.baseColor = 0xfff48a;
    g.add(light);
  }
  // ground beam — a thin tapered cone (transparent)
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(2.0, 12, 18, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x9af7c0, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false })
  );
  beam.position.y = -6;
  beam.name = "beam";
  g.add(beam);
  return g;
}

const ufoVisit = {
  id: "ufo",
  label: "A UFO drifts overhead",
  weight: 4,
  async run(world) {
    const ufo = buildUFO();
    const target = new THREE.Vector3(rand(-12, 12), 14, rand(-12, 12));
    ufo.position.set(target.x + 30, 20, target.z + 30);
    world.scene.add(ufo);
    if (world.audio) world.audio.ufoSwoop();
    world.toast("Something silver moves above the trees…");

    // Approach
    const start = ufo.position.clone();
    await tween({ t: 0 }, "t", 1, 4500, easeInOut).then(() => {
      // (tween cb above doesn't get position; do it explicitly here)
    });
    // Actually move via a per-frame raf with vector lerp:
    await new Promise((resolve) => {
      const tStart = performance.now();
      const dur = 4000;
      function step() {
        const t = Math.min(1, (performance.now() - tStart) / dur);
        const e = easeInOut(t);
        ufo.position.lerpVectors(start, target, e);
        ufo.rotation.y += 0.04;
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });

    // Hover with beam on
    const beam = ufo.getObjectByName("beam");
    await tween(beam.material, "opacity", 0.45, 900);
    world.toast("A beam of green light reaches down.");
    await wait(3500);
    await tween(beam.material, "opacity", 0, 800);

    // Drift away
    const exit = new THREE.Vector3(target.x - 40, 22, target.z - 30);
    await new Promise((resolve) => {
      const from = ufo.position.clone();
      const tStart = performance.now();
      const dur = 5000;
      function step() {
        const t = Math.min(1, (performance.now() - tStart) / dur);
        const e = easeInOut(t);
        ufo.position.lerpVectors(from, exit, e);
        ufo.rotation.y += 0.06;
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
    world.scene.remove(ufo);
    world.toast("The sky is quiet again — but someone watched it pass.");
    world.flagSeen("ufo");
  },
};

// ---- First Contact (unlocks after a UFO visit) -----------------------------

function buildAlien() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 14, 12),
    std(0x9bd9a3, { roughness: 0.3 })
  );
  body.scale.set(0.9, 1.1, 0.7);
  body.position.y = 0.0;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 16, 14),
    std(0x9bd9a3, { roughness: 0.3 })
  );
  head.position.y = 0.7;
  head.scale.set(1, 1.15, 1);
  g.add(head);
  // big black eyes
  for (const z of [0.18, -0.18]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x0a0a14 })
    );
    eye.position.set(0.32, 0.7, z);
    eye.scale.set(0.7, 1.2, 0.9);
    g.add(eye);
  }
  // arms
  for (const z of [0.32, -0.32]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.6, 6), std(0x9bd9a3));
    arm.position.set(0, 0.0, z);
    arm.rotation.x = z > 0 ? -0.2 : 0.2;
    g.add(arm);
  }
  // legs
  for (const z of [0.12, -0.12]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.5, 6), std(0x9bd9a3));
    leg.position.set(0, -0.5, z);
    g.add(leg);
  }
  return g;
}

const firstContact = {
  id: "firstContact",
  label: "First contact",
  weight: 0,
  async run(world) {
    // UFO drops in and leaves an alien.
    const ufo = buildUFO();
    const drop = new THREE.Vector3(rand(-8, 8), 14, rand(-8, 8));
    ufo.position.set(drop.x + 25, 22, drop.z - 25);
    world.scene.add(ufo);
    if (world.audio) world.audio.ufoSwoop();
    world.toast("They're back. And they brought someone.");
    const start = ufo.position.clone();
    await new Promise((resolve) => {
      const tStart = performance.now();
      const dur = 4500;
      function step() {
        const t = Math.min(1, (performance.now() - tStart) / dur);
        ufo.position.lerpVectors(start, drop, easeInOut(t));
        ufo.rotation.y += 0.05;
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
    const beam = ufo.getObjectByName("beam");
    await tween(beam.material, "opacity", 0.6, 700);

    // Alien materializes on the ground beneath the beam.
    const alien = buildAlien();
    alien.position.set(drop.x, 0.5, drop.z);
    alien.scale.setScalar(0.01);
    world.scene.add(alien);
    await tween(alien.scale, "x", 1, 1200, easeInOut);
    // (uniform scale up — set other axes after)
    await new Promise((res) => {
      const start = performance.now();
      const dur = 1200;
      function step() {
        const t = Math.min(1, (performance.now() - start) / dur);
        const s = 0.01 + (1 - 0.01) * easeInOut(t);
        alien.scale.set(s, s, s);
        if (t < 1) requestAnimationFrame(step);
        else res();
      }
      requestAnimationFrame(step);
    });
    await tween(beam.material, "opacity", 0, 800);

    // UFO drifts away.
    const exit = new THREE.Vector3(drop.x - 30, 24, drop.z + 30);
    await new Promise((resolve) => {
      const from = ufo.position.clone();
      const tStart = performance.now();
      const dur = 4500;
      function step() {
        const t = Math.min(1, (performance.now() - tStart) / dur);
        ufo.position.lerpVectors(from, exit, easeInOut(t));
        ufo.rotation.y += 0.06;
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
    world.scene.remove(ufo);

    // Alien waddles toward the nearest hatchling, then waves.
    world.toast("First contact.");
    const target = world.findNearestActor(alien.position);
    if (target) {
      if (world.audio) world.audio.firstContact();
      await new Promise((res) => {
        const from = alien.position.clone();
        const to = target.mesh.position.clone();
        // stop a couple of units before the actor
        const dir = to.clone().sub(from).normalize();
        to.sub(dir.multiplyScalar(1.6));
        const tStart = performance.now();
        const dur = 4000;
        function step() {
          const t = Math.min(1, (performance.now() - tStart) / dur);
          alien.position.lerpVectors(from, to, t);
          alien.position.y = 0.5 + Math.abs(Math.sin(t * Math.PI * 8)) * 0.08;
          alien.lookAt(target.mesh.position.x, alien.position.y, target.mesh.position.z);
          if (t < 1) requestAnimationFrame(step);
          else res();
        }
        requestAnimationFrame(step);
      });
      world.toast("They say hello in a frequency only " + target.name + " can hear.");
      target.joy = Math.min(1, target.joy + 0.3);
    }
    await wait(5000);
    // Alien stays for a while, then beams up off-screen.
    await tween(alien.scale, "y", 0.01, 1200);
    world.scene.remove(alien);
    world.toast("They left a humming behind them.");
  },
};

// ---- Wolf -----------------------------------------------------------------

function buildWolf(color = 0x4d4a4f) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.65, 0.7), std(color));
  body.position.y = 0.65;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.6), std(color));
  head.position.set(0.95, 0.95, 0);
  head.castShadow = true;
  g.add(head);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 0.4), std(color));
  snout.position.set(1.3, 0.85, 0);
  g.add(snout);
  // ears
  for (const z of [0.18, -0.18]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.25, 4), std(color));
    ear.position.set(0.95, 1.32, z);
    g.add(ear);
  }
  // legs
  for (const [x, z] of [[-0.5, 0.25], [-0.5, -0.25], [0.5, 0.25], [0.5, -0.25]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.65, 6), std(color));
    leg.position.set(x, 0.32, z);
    leg.castShadow = true;
    g.add(leg);
  }
  // tail
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.6, 6), std(color));
  tail.rotation.z = Math.PI / 3;
  tail.position.set(-0.95, 0.95, 0);
  g.add(tail);
  // eyes
  for (const z of [0.16, -0.16]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), emissive(0xfff58a, 1.4));
    eye.position.set(1.45, 0.95, z);
    g.add(eye);
  }
  return g;
}

const wolfVisit = {
  id: "wolf",
  label: "A wolf is at the treeline",
  weight: 3,
  async run(world) {
    const wolf = buildWolf();
    const from = new THREE.Vector3(-30, 0, rand(-15, 15));
    const to = new THREE.Vector3(30, 0, rand(-15, 15));
    wolf.position.copy(from);
    wolf.lookAt(to.x, wolf.position.y, to.z);
    world.scene.add(wolf);
    if (world.audio) world.audio.wolf();
    world.toast("Something moves at the edge of the trees.");
    await new Promise((res) => {
      const tStart = performance.now();
      const dur = 14000;
      function step() {
        const t = Math.min(1, (performance.now() - tStart) / dur);
        wolf.position.lerpVectors(from, to, t);
        // bob the body
        wolf.position.y = Math.abs(Math.sin(t * Math.PI * 22)) * 0.06;
        if (t < 1) requestAnimationFrame(step);
        else res();
      }
      requestAnimationFrame(step);
    });
    world.scene.remove(wolf);
    world.toast("The wolf disappears into the brush.");
  },
};

// ---- Winter sequence: freeze → snow → igloos → polar bear ------------------

function buildIgloo(scale = 1) {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.2 * scale, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    std(0xf2f6fa, { roughness: 0.85 })
  );
  dome.castShadow = true;
  dome.receiveShadow = true;
  g.add(dome);
  // entrance tunnel
  const tunnel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4 * scale, 0.4 * scale, 0.8 * scale, 12, 1, true, 0, Math.PI),
    std(0xf2f6fa, { side: THREE.DoubleSide, roughness: 0.85 })
  );
  tunnel.rotation.z = Math.PI / 2;
  tunnel.position.set(1.0 * scale, 0.3 * scale, 0);
  g.add(tunnel);
  // dark entrance
  const dark = new THREE.Mesh(
    new THREE.CircleGeometry(0.34 * scale, 14),
    new THREE.MeshBasicMaterial({ color: 0x0a1018 })
  );
  dark.position.set(1.4 * scale, 0.3 * scale, 0);
  dark.rotation.y = Math.PI / 2;
  g.add(dark);
  return g;
}

function buildPolarBear() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 12), std(0xf6f7f3));
  body.scale.set(1.6, 0.9, 1.0);
  body.position.y = 0.8;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), std(0xf6f7f3));
  head.position.set(1.3, 1.0, 0);
  head.castShadow = true;
  g.add(head);
  // snout
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), std(0xf6f7f3));
  snout.position.set(1.65, 0.9, 0);
  g.add(snout);
  // ears
  for (const z of [0.2, -0.2]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), std(0xf6f7f3));
    ear.position.set(1.25, 1.35, z);
    g.add(ear);
  }
  // legs
  for (const [x, z] of [[-0.6, 0.3], [-0.6, -0.3], [0.55, 0.3], [0.55, -0.3]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.7, 8), std(0xf6f7f3));
    leg.position.set(x, 0.35, z);
    leg.castShadow = true;
    g.add(leg);
  }
  // black nose & eyes
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), new THREE.MeshBasicMaterial({ color: 0x0a0a14 }));
  nose.position.set(1.83, 0.92, 0);
  g.add(nose);
  for (const z of [0.14, -0.14]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), new THREE.MeshBasicMaterial({ color: 0x0a0a14 }));
    eye.position.set(1.5, 1.05, z);
    g.add(eye);
  }
  return g;
}

const winterSequence = {
  id: "winter",
  label: "Winter sets in",
  weight: 3,
  async run(world) {
    world.toast("A chill rolls down from the mountains.");
    if (world.audio) world.audio.freeze();
    world.setWeather("freezing");
    // Desaturate fog/scene color and cool the lights.
    const origFog = world.scene.fog.color.getHex();
    const origAmb = world.ambient.color.getHex();
    const origSun = world.sun.color.getHex();
    await tween({ t: 0 }, "t", 1, 4000, easeInOut).then(() => {
      world.scene.fog.color.setHex(0xb8cee0);
      world.ambient.color.setHex(0xbfd7e8);
      world.sun.color.setHex(0xcfe0f0);
    });

    // Snowfall: a particle system attached to the camera area.
    const snow = makeSnow(world, 1200);
    world.scene.add(snow);
    if (world.audio) world.audio.snowfall();
    world.setWeather("snowing");

    // After a while, build a few igloos.
    await wait(8000);
    const igloos = [];
    for (let i = 0; i < 3; i++) {
      const igloo = buildIgloo(rand(0.9, 1.2));
      igloo.position.set(rand(-18, 18), 0, rand(-18, 18));
      igloo.rotation.y = rand(0, Math.PI * 2);
      igloo.scale.setScalar(0.001);
      world.scene.add(igloo);
      igloos.push(igloo);
      if (world.audio) world.audio.igloo();
      // animate scale up
      const startTime = performance.now();
      (function grow() {
        const t = Math.min(1, (performance.now() - startTime) / 1500);
        const s = easeInOut(t);
        igloo.scale.setScalar(s);
        if (t < 1) requestAnimationFrame(grow);
      })();
      await wait(1100);
    }
    world.toast("Igloos rise from the drifts.");

    // Polar bear shows up.
    await wait(4000);
    const bear = buildPolarBear();
    const from = new THREE.Vector3(-28, 0, rand(-10, 10));
    const to = new THREE.Vector3(28, 0, rand(-10, 10));
    bear.position.copy(from);
    bear.lookAt(to.x, bear.position.y, to.z);
    world.scene.add(bear);
    if (world.audio) world.audio.polarBear();
    world.toast("A polar bear lumbers across the valley.");
    await new Promise((res) => {
      const tStart = performance.now();
      const dur = 18000;
      function step() {
        const t = Math.min(1, (performance.now() - tStart) / dur);
        bear.position.lerpVectors(from, to, t);
        bear.position.y = Math.abs(Math.sin(t * Math.PI * 18)) * 0.05;
        if (t < 1) requestAnimationFrame(step);
        else res();
      }
      requestAnimationFrame(step);
    });
    world.scene.remove(bear);

    // Hold the winter scene for a bit longer.
    await wait(6000);
    if (world.audio) world.audio.thaw();
    world.toast("The thaw begins.");
    // Fade snow out
    snow.userData.fading = true;
    await wait(4500);
    snow.parent && snow.parent.remove(snow);

    // Restore colors.
    await new Promise((resolve) => {
      const start = performance.now();
      const dur = 4000;
      const fogStart = world.scene.fog.color.clone();
      const ambStart = world.ambient.color.clone();
      const sunStart = world.sun.color.clone();
      const fogEnd = new THREE.Color(origFog);
      const ambEnd = new THREE.Color(origAmb);
      const sunEnd = new THREE.Color(origSun);
      function step() {
        const t = Math.min(1, (performance.now() - start) / dur);
        const e = easeInOut(t);
        world.scene.fog.color.lerpColors(fogStart, fogEnd, e);
        world.ambient.color.lerpColors(ambStart, ambEnd, e);
        world.sun.color.lerpColors(sunStart, sunEnd, e);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
    world.setWeather("calm");
    // Leave igloos behind as monuments — they'll be cleaned up by the next winter.
    world._winterIgloos = igloos;
  },
};

function makeSnow(world, count) {
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = rand(-40, 40);
    positions[i * 3 + 1] = rand(0, 30);
    positions[i * 3 + 2] = rand(-40, 40);
    speeds[i] = rand(0.04, 0.12);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.18,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const points = new THREE.Points(geom, mat);
  points.userData.speeds = speeds;
  points.userData.fading = false;
  points.userData.update = (dt) => {
    const pos = geom.attributes.position.array;
    for (let i = 0; i < count; i++) {
      pos[i * 3 + 1] -= speeds[i] * (dt / 16);
      if (pos[i * 3 + 1] < 0.2) pos[i * 3 + 1] = 28;
    }
    geom.attributes.position.needsUpdate = true;
    if (points.userData.fading) mat.opacity = Math.max(0, mat.opacity - dt * 0.0002);
  };
  world.registerUpdater(points.userData.update);
  return points;
}

// ---- Aurora Borealis -------------------------------------------------------

const auroraBorealis = {
  id: "auroraBorealis",
  label: "Aurora borealis",
  weight: 2,
  prefersNight: true,
  async run(world) {
    if (world.timeName() !== "night") return;
    if (world.audio) world.audio.auroraBorealis();
    world.toast("Ribbons of light pour across the sky.");
    const ribbons = new THREE.Group();
    const colors = [0x6effc4, 0x96b8ff, 0xff96d2];
    for (let r = 0; r < 3; r++) {
      const geo = new THREE.PlaneGeometry(60, 6, 32, 1);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        pos.setY(i, pos.getY(i) + Math.sin(x * 0.3 + r) * 1.5);
      }
      const mat = new THREE.MeshBasicMaterial({
        color: colors[r], transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false,
      });
      const plane = new THREE.Mesh(geo, mat);
      plane.position.set(0, 22 + r * 2, -30 + r * 4);
      plane.rotation.x = -0.4;
      ribbons.add(plane);
    }
    world.scene.add(ribbons);
    // Fade in, undulate, fade out.
    const start = performance.now();
    const dur = 14000;
    await new Promise((resolve) => {
      const step = () => {
        const elapsed = performance.now() - start;
        const t = Math.min(1, elapsed / dur);
        ribbons.children.forEach((p, i) => {
          const targetOp = t < 0.2 ? t / 0.2 : t > 0.8 ? (1 - t) / 0.2 : 1;
          p.material.opacity = targetOp * 0.55;
          p.position.x = Math.sin(elapsed * 0.0006 + i) * 4;
        });
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    world.scene.remove(ribbons);
  },
};

// ---- Meteor Shower ---------------------------------------------------------

const meteorShower = {
  id: "meteor",
  label: "Meteor shower",
  weight: 2,
  prefersNight: true,
  async run(world) {
    if (world.timeName() !== "night") return;
    world.toast("Streaks of fire cross the sky — make a wish.");
    const N = 12;
    for (let i = 0; i < N; i++) {
      setTimeout(() => {
        streakOne(world);
        if (world.audio) world.audio.meteor();
      }, i * 400 + rand(0, 200));
    }
    await wait(N * 400 + 3000);
  },
};

function streakOne(world) {
  const start = new THREE.Vector3(rand(-15, 15), 28, rand(-30, -5));
  const end = new THREE.Vector3(start.x + rand(15, 25), 4, start.z + rand(10, 20));
  const geom = new THREE.BufferGeometry().setFromPoints([start, start]);
  const mat = new THREE.LineBasicMaterial({ color: 0xfff2bf, transparent: true, opacity: 0.9 });
  const line = new THREE.Line(geom, mat);
  world.scene.add(line);
  const tStart = performance.now();
  const dur = 800;
  function step() {
    const t = Math.min(1, (performance.now() - tStart) / dur);
    const p = new THREE.Vector3().lerpVectors(start, end, t);
    geom.setFromPoints([new THREE.Vector3().lerpVectors(start, end, Math.max(0, t - 0.2)), p]);
    mat.opacity = 0.9 * (1 - t);
    if (t < 1) requestAnimationFrame(step);
    else world.scene.remove(line);
  }
  requestAnimationFrame(step);
}

// ---- Eclipse ---------------------------------------------------------------

const eclipse = {
  id: "eclipse",
  label: "An eclipse",
  weight: 1,
  async run(world) {
    if (world.timeName() !== "day") return;
    if (world.audio) world.audio.eclipse();
    world.toast("The sun goes dark. Everything waits.");
    const origAmb = world.ambient.intensity;
    const origSun = world.sun.intensity;
    await tween(world.ambient, "intensity", 0.05, 2500, easeInOut);
    await tween(world.sun, "intensity", 0.05, 2500, easeInOut);
    await wait(4500);
    await tween(world.ambient, "intensity", origAmb, 3000, easeInOut);
    await tween(world.sun, "intensity", origSun, 3000, easeInOut);
    world.toast("The light returns, gentler than before.");
  },
};

// ---------- Character specials ----------------------------------------------

const characterSpecials = {
  constellation(world, args) {
    if (world.audio) world.audio.constellation();
    // Draw a constellation high in the sky (visible best at night).
    const N = 6 + Math.floor(Math.random() * 3);
    const cx = rand(-15, 15);
    const cz = rand(-15, 15);
    const cy = 24;
    const pts = [];
    for (let i = 0; i < N; i++) pts.push(new THREE.Vector3(cx + rand(-6, 6), cy + rand(-3, 3), cz + rand(-4, 4)));
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xfff8c0, transparent: true, opacity: 0.9 });
    const line = new THREE.LineSegments(lineGeo, lineMat);
    world.scene.add(line);
    const stars = new THREE.Group();
    for (const p of pts) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), emissive(0xfff8c0, 2.5));
      s.position.copy(p);
      stars.add(s);
    }
    world.scene.add(stars);
    setTimeout(() => {
      const start = performance.now();
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / 2500);
        lineMat.opacity = 0.9 * (1 - t);
        stars.children.forEach((s) => (s.material.emissiveIntensity = 2.5 * (1 - t)));
        if (t < 1) requestAnimationFrame(step);
        else { world.scene.remove(line); world.scene.remove(stars); }
      };
      requestAnimationFrame(step);
    }, 4000);
  },

  rainbow(world, args) {
    if (world.audio) world.audio.rainbow();
    const colors = [0xff5959, 0xffa844, 0xffe35c, 0x7be07b, 0x5cc3ff, 0x7e7bff, 0xc87bff];
    const arcGroup = new THREE.Group();
    for (let i = 0; i < colors.length; i++) {
      const r = 12 + i * 0.6;
      const torus = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.18, 8, 64, Math.PI),
        new THREE.MeshBasicMaterial({ color: colors[i], transparent: true, opacity: 0 })
      );
      torus.rotation.z = Math.PI;
      torus.position.set(args.x, 0, args.z);
      arcGroup.add(torus);
    }
    world.scene.add(arcGroup);
    const tStart = performance.now();
    const dur = 4500;
    const step = () => {
      const t = Math.min(1, (performance.now() - tStart) / dur);
      arcGroup.children.forEach((arc) => {
        arc.material.opacity = t < 0.3 ? t / 0.3 * 0.85 : t > 0.7 ? (1 - t) / 0.3 * 0.85 : 0.85;
      });
      if (t < 1) requestAnimationFrame(step);
      else world.scene.remove(arcGroup);
    };
    requestAnimationFrame(step);
  },

  pipRain(world, args) {
    if (world.audio) world.audio.pipRain();
    // Drop water particles for ~2s, then grow a flower at the center.
    const drops = new THREE.Group();
    const dropMat = new THREE.MeshBasicMaterial({ color: 0x7fb6ff, transparent: true, opacity: 0.8 });
    const dropGeom = new THREE.CylinderGeometry(0.03, 0.03, 0.18, 4);
    const N = 40;
    for (let i = 0; i < N; i++) {
      const d = new THREE.Mesh(dropGeom, dropMat);
      d.position.set(args.x + rand(-0.7, 0.7), rand(3, 4), args.z + rand(-0.7, 0.7));
      d.userData.v = rand(0.08, 0.14);
      drops.add(d);
    }
    world.scene.add(drops);
    const tStart = performance.now();
    const dur = 1800;
    const step = () => {
      const t = Math.min(1, (performance.now() - tStart) / dur);
      drops.children.forEach((d) => {
        d.position.y -= d.userData.v;
        if (d.position.y < 0) d.position.y = 4;
      });
      if (t < 1) requestAnimationFrame(step);
      else world.scene.remove(drops);
    };
    requestAnimationFrame(step);
    setTimeout(() => growFlower(world, args.x, args.z), 1700);
  },

  memoryBubble(world, args) {
    if (world.audio) world.audio.memoryBubble();
    const bub = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 18, 14),
      new THREE.MeshStandardMaterial({
        color: 0xbeeaff, transparent: true, opacity: 0.5, roughness: 0.1, metalness: 0.1,
      })
    );
    bub.position.set(args.x, 1.2, args.z);
    bub.userData = { isBubble: true, memory: args.memory };
    world.scene.add(bub);
    world.registerBubble(bub);
    const tStart = performance.now();
    const dur = 9000;
    const step = () => {
      const t = Math.min(1, (performance.now() - tStart) / dur);
      bub.position.y = 1.2 + t * 12;
      bub.position.x += Math.sin(performance.now() * 0.002) * 0.01;
      if (t < 1 && bub.parent) requestAnimationFrame(step);
      else if (bub.parent) world.scene.remove(bub);
    };
    requestAnimationFrame(step);
  },

  rebirth(world, args) {
    if (world.audio) world.audio.rebirth();
    const actor = args.actor;
    // Burst of flame around the actor; rebuild the body with new palette.
    const flameGroup = new THREE.Group();
    for (let i = 0; i < 18; i++) {
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.18, 0.5, 5),
        emissive([0xff7a3d, 0xff4d6e, 0xffd23d][i % 3], 1.6)
      );
      const a = (i / 18) * Math.PI * 2;
      flame.position.set(Math.cos(a) * 0.6, rand(0.2, 0.8), Math.sin(a) * 0.6);
      flame.userData.t0 = performance.now() + rand(0, 200);
      flameGroup.add(flame);
    }
    flameGroup.position.copy(actor.mesh.position);
    world.scene.add(flameGroup);
    const tStart = performance.now();
    const dur = 1800;
    const step = () => {
      const t = Math.min(1, (performance.now() - tStart) / dur);
      flameGroup.children.forEach((f) => {
        f.position.y += 0.04;
        f.material.opacity = 1 - t;
        f.material.transparent = true;
      });
      if (t < 1) requestAnimationFrame(step);
      else world.scene.remove(flameGroup);
    };
    requestAnimationFrame(step);
    // Rebuild the actor body with new palette in the middle of the burn.
    setTimeout(() => world.rebuildActor(actor), 600);
  },
};

function growFlower(world, x, z) {
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.6, 5),
    std(0x3a5c1e)
  );
  stem.position.set(x, 0.3, z);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 10, 8),
    std(choose([0xffd1e8, 0xffe26a, 0xbba2ff, 0xffac6b, 0xa0e8c3]))
  );
  head.position.set(x, 0.65, z);
  head.scale.setScalar(0.01);
  const g = new THREE.Group();
  g.add(stem, head);
  world.scene.add(g);
  // grow
  const tStart = performance.now();
  const step = () => {
    const t = Math.min(1, (performance.now() - tStart) / 900);
    const s = easeInOut(t);
    head.scale.setScalar(s);
    stem.scale.y = s;
    stem.position.y = 0.3 * s;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  // The flower stays put as a permanent garden decoration.
}

// ---------- Director --------------------------------------------------------

export class EventDirector {
  constructor(world) {
    this.world = world;
    this.scheduled = [ufoVisit, wolfVisit, winterSequence, auroraBorealis, meteorShower, eclipse];
    this.specials = characterSpecials;
    this.active = null;
    this._lastFireAt = performance.now() + 8000; // 8s grace period at start
    this._minGap = 25000;
    this._maxGap = 55000;
  }

  // Called every frame from the game loop.
  tick(now) {
    if (this.active) return;
    if (now - this._lastFireAt < this._minGap) return;
    if (now - this._lastFireAt > this._maxGap || Math.random() < 0.002) {
      this._pickAndFire();
    }
  }

  _pickAndFire() {
    // Weighted random pick of scheduled events.
    let pool = this.scheduled.filter((ev) => !ev.prefersNight || this.world.timeName() === "night");
    if (pool.length === 0) pool = this.scheduled;
    const totalW = pool.reduce((a, e) => a + e.weight, 0);
    let r = Math.random() * totalW;
    let chosen = pool[pool.length - 1];
    for (const ev of pool) { r -= ev.weight; if (r <= 0) { chosen = ev; break; } }

    // First contact gating: trigger automatically the first time a UFO has been seen,
    // about 30 seconds after the UFO leaves.
    if (this.world.hasFlag("ufo") && !this.world.hasFlag("firstContact")) {
      chosen = firstContact;
      this.world.flagSeen("firstContact");
    }
    this._fire(chosen);
  }

  async _fire(event) {
    this.active = event;
    this.world.setEventLabel(event.label);
    try { await event.run(this.world); }
    catch (e) { console.error("event", event.id, "failed:", e); }
    this.active = null;
    this._lastFireAt = performance.now();
    this.world.setEventLabel("All quiet");
  }

  // Triggered by character specials by name.
  run(specialId, args) {
    const fn = this.specials[specialId];
    if (fn) fn(this.world, args || {});
  }
}
