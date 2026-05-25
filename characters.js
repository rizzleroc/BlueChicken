// characters.js
// -----------------------------------------------------------------------------
// Each character is a small self-contained world: its own egg, its own body SVG,
// its own personality config, and — most importantly — its own `special(world)`
// function that does something nobody else can do. The whole point of this app
// is that hatching is a discovery, not a reskin.
//
// The svg/eggSvg builders return raw <svg> child fragments (no outer <svg> tag).
// They're inserted into the world's <g id="actor-layer"> at a translation set
// by main.js, so all internal coordinates are local to the actor (centered at 0,0
// roughly, with feet near y=0).

(function (root) {
  "use strict";

  // Tiny helper for building SVG strings without losing my mind.
  const $ = (tag, attrs = {}, children = "") => {
    const a = Object.entries(attrs)
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");
    return `<${tag}${a ? " " + a : ""}>${children}</${tag}>`;
  };

  // Shared egg base: an oval with shading. Each character paints over it.
  const eggBase = (fill, accent, pattern = "") =>
    $("g", { class: "egg-art" },
      $("ellipse", { cx: 0, cy: 0, rx: 32, ry: 42, fill }) +
      $("ellipse", { cx: -10, cy: -14, rx: 10, ry: 16, fill: "#ffffff", opacity: 0.35 }) +
      $("ellipse", { cx: 0, cy: 0, rx: 32, ry: 42, fill: "none", stroke: accent, "stroke-width": 1.2, opacity: 0.6 }) +
      pattern +
      // Cracks reveal progressively as the egg is tapped.
      $("path", { class: "crack-1", d: "M-6 -22 L-2 -10 L-8 -2 L-1 6",  stroke: "#1a1a1a", "stroke-width": 1.5, fill: "none" }) +
      $("path", { class: "crack-2", d: "M6 -18 L10 -4 L4 4 L11 14",     stroke: "#1a1a1a", "stroke-width": 1.5, fill: "none" }) +
      $("path", { class: "crack-3", d: "M-12 4 L-4 14 L-10 22 L-2 30",  stroke: "#1a1a1a", "stroke-width": 1.5, fill: "none" })
    );

  // -------------------------------------------------------------------------
  // 1. AURORA — Sky-Whale. Petting at night draws a constellation.
  // -------------------------------------------------------------------------
  const aurora = {
    id: "aurora",
    name: "Aurora",
    role: "Sky-Whale of the Quiet Vault",
    story: "Aurora hatched from a piece of the night that fell. When she sings, the stars remember the shapes she dreams.",
    palette: { body: "#5d4a9c", belly: "#a89be0", accent: "#fbe7a0" },
    prefersTime: "night",
    eggSvg: () => eggBase("#1c2150", "#7d8de0",
      // star speckles
      Array.from({ length: 14 }, () => {
        const x = (Math.random() * 50 - 25).toFixed(1);
        const y = (Math.random() * 64 - 32).toFixed(1);
        const r = (Math.random() * 1.2 + 0.4).toFixed(1);
        return $("circle", { cx: x, cy: y, r, fill: "#fff9d0", opacity: 0.85 });
      }).join("") +
      $("path", { d: "M-20 8 Q0 -2 22 10", stroke: "#9eb1ff", "stroke-width": 1, fill: "none", opacity: 0.6 })
    ),
    bodySvg: function () {
      const p = this.palette;
      return $("g", { class: "actor-art" },
        // tail
        $("path", { d: "M-58 -6 Q-72 -16 -80 -2 Q-72 6 -58 6 Z", fill: p.body }) +
        // body
        $("ellipse", { cx: 0, cy: 0, rx: 50, ry: 24, fill: p.body }) +
        $("ellipse", { cx: 6, cy: 6, rx: 38, ry: 14, fill: p.belly, opacity: 0.7 }) +
        // fin
        $("path", { d: "M-2 -18 Q4 -34 16 -22 Z", fill: p.body }) +
        // star spots
        $("circle", { cx: -18, cy: -8, r: 1.6, fill: p.accent }) +
        $("circle", { cx: -4, cy: -12, r: 1.2, fill: p.accent }) +
        $("circle", { cx: 12, cy: -6, r: 1.8, fill: p.accent }) +
        $("circle", { cx: 30, cy: -2, r: 1.2, fill: p.accent }) +
        // eye
        $("circle", { cx: 38, cy: -2, r: 4, fill: "#fff" }) +
        $("circle", { cx: 39, cy: -1, r: 2.2, fill: "#1a1230" }) +
        // smile
        $("path", { d: "M40 6 Q44 9 48 6", stroke: "#1a1230", "stroke-width": 1.4, fill: "none" })
      );
    },
    specialLabel: "Sing a constellation",
    specialCooldownMs: 8000,
    special: function (world, actor) {
      // Draw a constellation in the sky. Looks best at night, but works any time.
      world.drawConstellation();
      world.toast(actor.name + " sings a star-song into the sky.");
      world.discover(actor.id, "Drew a constellation.");
    },
  };

  // -------------------------------------------------------------------------
  // 2. MAGMA — Lava Pup. Leaves glowing footprints; melts ice.
  // -------------------------------------------------------------------------
  const magma = {
    id: "magma",
    name: "Magma",
    role: "Pup of the First Forge",
    story: "Magma was born inside a heart-shaped coal at the bottom of a volcano. He runs because standing still makes flowers wilt.",
    palette: { body: "#c83a1a", belly: "#f59230", accent: "#ffd770" },
    prefersTime: "day",
    eggSvg: () => eggBase("#1a0e0a", "#ff6a1e",
      $("path", { d: "M-22 -14 Q-8 -2 -16 12 Q -2 22 8 6 Q 18 -4 6 -18 Q -4 -10 -22 -14 Z", fill: "#ff7322", opacity: 0.85 }) +
      $("path", { d: "M-22 -14 Q-8 -2 -16 12 Q -2 22 8 6 Q 18 -4 6 -18 Q -4 -10 -22 -14 Z", fill: "none", stroke: "#ffd270", "stroke-width": 0.8 })
    ),
    bodySvg: function () {
      const p = this.palette;
      return $("g", { class: "actor-art" },
        // tail
        $("path", { d: "M-32 0 Q-46 -10 -38 -18 L-30 -8 Z", fill: p.body }) +
        // body
        $("ellipse", { cx: 0, cy: 0, rx: 26, ry: 20, fill: p.body }) +
        $("ellipse", { cx: 4, cy: 6, rx: 18, ry: 10, fill: p.belly }) +
        // head
        $("circle", { cx: 22, cy: -8, r: 16, fill: p.body }) +
        $("path", { d: "M14 -22 L18 -10 L10 -14 Z", fill: p.body }) +
        $("path", { d: "M28 -22 L24 -10 L34 -14 Z", fill: p.body }) +
        // glow underbelly
        $("ellipse", { cx: 4, cy: 14, rx: 14, ry: 5, fill: p.accent, opacity: 0.5 }) +
        // legs
        $("rect", { x: -14, y: 14, width: 6, height: 10, fill: p.body, rx: 2 }) +
        $("rect", { x: 10, y: 14, width: 6, height: 10, fill: p.body, rx: 2 }) +
        // eye
        $("circle", { cx: 26, cy: -10, r: 3, fill: "#fff" }) +
        $("circle", { cx: 27, cy: -9, r: 1.5, fill: "#1a0a05" }) +
        // grin
        $("path", { d: "M22 -2 Q26 1 30 -2", stroke: "#1a0a05", "stroke-width": 1.4, fill: "none" }) +
        // ember on head
        $("circle", { cx: 22, cy: -26, r: 3, fill: p.accent, opacity: 0.9 })
      );
    },
    specialLabel: "Dash & scorch",
    specialCooldownMs: 6000,
    special: function (world, actor) {
      // Magma sprints across the world leaving a trail of lava prints.
      world.dashActor(actor, 200);
      world.toast(actor.name + " runs hot — careful where you step.");
      world.discover(actor.id, "Scorched the grass with a sprint.");
    },
    // Hook called every tick — drops footprints when walking.
    onMove: function (world, actor) {
      if (Math.random() < 0.35) world.spawnFootprint(actor.x, actor.y + 22, "#ff8a30");
    },
  };

  // -------------------------------------------------------------------------
  // 3. GLIMMER — Crystal Fox. Refracts light into rainbows.
  // -------------------------------------------------------------------------
  const glimmer = {
    id: "glimmer",
    name: "Glimmer",
    role: "Fox of the Prism Caves",
    story: "Glimmer was the last facet of a crystal that learned to want. She turns to face every light and asks it questions.",
    palette: { body: "#e8c9ff", belly: "#fff", accent: "#9ad6ff" },
    prefersTime: "day",
    eggSvg: () => eggBase("#cfe6ff", "#9ad6ff",
      // facets
      $("polygon", { points: "-18,-22 0,-12 -10,4", fill: "#fff", opacity: 0.5 }) +
      $("polygon", { points: "10,-18 22,-2 6,6",   fill: "#a9d4ff", opacity: 0.6 }) +
      $("polygon", { points: "-12,8 8,12 -2,28",   fill: "#d8c1ff", opacity: 0.55 })
    ),
    bodySvg: function () {
      const p = this.palette;
      return $("g", { class: "actor-art" },
        // big bushy tail
        $("path", { d: "M-30 0 Q-52 -6 -56 -22 Q-44 -10 -36 -6 Z", fill: p.body }) +
        $("path", { d: "M-46 -16 Q-54 -22 -52 -28 Q-44 -22 -42 -18 Z", fill: "#fff", opacity: 0.7 }) +
        // body
        $("ellipse", { cx: 0, cy: 0, rx: 22, ry: 14, fill: p.body }) +
        $("ellipse", { cx: 2, cy: 4, rx: 14, ry: 6, fill: p.belly }) +
        // legs
        $("rect", { x: -10, y: 10, width: 4, height: 10, fill: p.body, rx: 1.5 }) +
        $("rect", { x: 8, y: 10, width: 4, height: 10, fill: p.body, rx: 1.5 }) +
        // head
        $("path", { d: "M14 -6 L26 -14 L36 -6 L32 6 L18 8 Z", fill: p.body }) +
        // ears
        $("polygon", { points: "16,-14 20,-22 24,-12", fill: p.body }) +
        $("polygon", { points: "30,-14 34,-22 38,-12", fill: p.body }) +
        // eye
        $("circle", { cx: 30, cy: -4, r: 2.4, fill: "#1a0a25" }) +
        $("circle", { cx: 30.6, cy: -4.5, r: 0.7, fill: "#fff" }) +
        // facet sparkles
        $("polygon", { points: "0,-10 4,-6 0,-2 -4,-6", fill: "#fff", opacity: 0.7 }) +
        $("polygon", { points: "-14,2 -10,6 -14,10 -18,6", fill: p.accent, opacity: 0.6 })
      );
    },
    specialLabel: "Refract a rainbow",
    specialCooldownMs: 7000,
    special: function (world, actor) {
      world.castRainbow(actor.x, actor.y);
      world.toast(actor.name + " catches the light and casts it free.");
      world.discover(actor.id, "Cast a rainbow.");
    },
  };

  // -------------------------------------------------------------------------
  // 4. MOSSBACK — Garden Turtle. Plants grow on her shell over time.
  // -------------------------------------------------------------------------
  const mossback = {
    id: "mossback",
    name: "Mossback",
    role: "Turtle of the Slow Forest",
    story: "Mossback has been hatching for a thousand years. Time is just the rate at which moss grows on something patient.",
    palette: { body: "#7a8c4a", shell: "#4d6431", belly: "#cbd190", accent: "#a3d36a" },
    prefersTime: "day",
    eggSvg: () => eggBase("#6e5d3a", "#a3d36a",
      $("path", { d: "M-18 -10 Q-8 -18 4 -10 Q12 -2 4 6 Q-8 8 -16 0 Z", fill: "#5e8240" }) +
      $("circle", { cx: -10, cy: -4, r: 2, fill: "#a3d36a" }) +
      $("circle", { cx: 2, cy: -2, r: 1.5, fill: "#a3d36a" }) +
      $("path", { d: "M10 -16 L12 -22 L14 -16 Z", fill: "#5e8240" })
    ),
    bodySvg: function () {
      const p = this.palette;
      // Note: shell flora is appended at runtime by main.js based on age.
      return $("g", { class: "actor-art" },
        // legs
        $("ellipse", { cx: -16, cy: 12, rx: 6, ry: 4, fill: p.body }) +
        $("ellipse", { cx: 16, cy: 12, rx: 6, ry: 4, fill: p.body }) +
        // head
        $("circle", { cx: 24, cy: 2, r: 8, fill: p.body }) +
        $("circle", { cx: 27, cy: 0, r: 1.4, fill: "#1a1a0a" }) +
        $("path", { d: "M26 5 Q30 6 32 4", stroke: "#1a1a0a", "stroke-width": 1.2, fill: "none" }) +
        // shell
        $("ellipse", { cx: 0, cy: -2, rx: 26, ry: 18, fill: p.shell }) +
        $("ellipse", { cx: 0, cy: -2, rx: 26, ry: 18, fill: "none", stroke: "#3a4a22", "stroke-width": 1.5 }) +
        // shell hex pattern
        $("path", { d: "M-12 -8 L-4 -8 L0 -2 L-4 4 L-12 4 L-16 -2 Z", fill: "none", stroke: "#3a4a22", "stroke-width": 0.8 }) +
        $("path", { d: "M0 -8 L8 -8 L12 -2 L8 4 L0 4 L-4 -2 Z", fill: "none", stroke: "#3a4a22", "stroke-width": 0.8 }) +
        $("path", { d: "M12 -8 L20 -8 L24 -2 L20 4 L12 4 L8 -2 Z", fill: "none", stroke: "#3a4a22", "stroke-width": 0.8 }) +
        // belly band
        $("path", { d: "M-22 8 Q0 16 22 8", stroke: p.belly, "stroke-width": 4, fill: "none", opacity: 0.6 }) +
        // garden placeholder group — main.js appends grass blades & flowers
        $("g", { class: "garden", transform: "translate(0,-18)" })
      );
    },
    specialLabel: "Plant a seed",
    specialCooldownMs: 5000,
    special: function (world, actor) {
      world.plantOnTurtle(actor);
      world.toast(actor.name + " adds a sprout to her garden.");
      world.discover(actor.id, "Grew a new plant on her shell.");
    },
  };

  // -------------------------------------------------------------------------
  // 5. WHISPER — Shadow Cat. Teleports between shadows, leaves riddles.
  // -------------------------------------------------------------------------
  const whisper = {
    id: "whisper",
    name: "Whisper",
    role: "Cat of the Unlit Hour",
    story: "Whisper is not one creature but a habit the dark fell into. She visits the same places, never the same shadow twice.",
    palette: { body: "#2a1f3e", belly: "#46355f", accent: "#9d7fff" },
    prefersTime: "night",
    riddles: [
      "I have a face but no eyes; I see all things by what they hide.",
      "What walks beside you only when you forget to look?",
      "I am the only door that opens by closing yours.",
      "The smaller my flame, the bigger my country.",
      "I am born of light and yet I cannot bear to see it.",
      "Count me and I vanish; trust me and I deepen.",
    ],
    eggSvg: () => eggBase("#0a0820", "#9d7fff",
      $("path", { d: "M-12 -22 Q-18 -10 -10 -2 Q-2 6 -10 14", stroke: "#6b56b3", "stroke-width": 1.5, fill: "none", opacity: 0.7 }) +
      $("path", { d: "M-4 -18 A 18 18 0 1 0 8 -2", stroke: "#cabbff", "stroke-width": 1.5, fill: "none", opacity: 0.8 }) +
      $("circle", { cx: 12, cy: 10, r: 1.4, fill: "#cabbff" })
    ),
    bodySvg: function () {
      const p = this.palette;
      return $("g", { class: "actor-art" },
        // long tail
        $("path", { d: "M-22 -2 Q-44 -14 -36 -28", stroke: p.body, "stroke-width": 6, fill: "none", "stroke-linecap": "round" }) +
        // body
        $("ellipse", { cx: 0, cy: 0, rx: 22, ry: 12, fill: p.body }) +
        $("ellipse", { cx: 2, cy: 4, rx: 14, ry: 5, fill: p.belly, opacity: 0.7 }) +
        // legs
        $("rect", { x: -10, y: 8, width: 4, height: 10, fill: p.body, rx: 1.5 }) +
        $("rect", { x: 8, y: 8, width: 4, height: 10, fill: p.body, rx: 1.5 }) +
        // head
        $("circle", { cx: 20, cy: -6, r: 12, fill: p.body }) +
        // ears
        $("polygon", { points: "12,-16 16,-22 20,-14", fill: p.body }) +
        $("polygon", { points: "22,-14 26,-22 30,-16", fill: p.body }) +
        // glowing eyes
        $("ellipse", { cx: 16, cy: -6, rx: 1.4, ry: 2.5, fill: p.accent }) +
        $("ellipse", { cx: 24, cy: -6, rx: 1.4, ry: 2.5, fill: p.accent }) +
        // smirk
        $("path", { d: "M18 -1 Q20 1 22 -1 Q24 1 26 -1", stroke: "#cabbff", "stroke-width": 1.2, fill: "none" })
      );
    },
    specialLabel: "Slip into shadow",
    specialCooldownMs: 9000,
    special: function (world, actor) {
      // Teleport elsewhere, leaving a riddle behind.
      const riddle = this.riddles[Math.floor(Math.random() * this.riddles.length)];
      world.teleportActor(actor, riddle);
      world.toast(actor.name + " is gone. A riddle remains.");
      world.discover(actor.id, "Riddle: " + riddle);
    },
  };

  // -------------------------------------------------------------------------
  // 6. PIP — Storm Sparrow. Summons a tiny rain cloud that makes flowers grow.
  // -------------------------------------------------------------------------
  const pip = {
    id: "pip",
    name: "Pip",
    role: "Sparrow with a Pocket Storm",
    story: "Pip was hatched in a thundercloud and dropped on a Tuesday. The cloud followed him home. It wasn't done telling him things.",
    palette: { body: "#5d7ba8", belly: "#cfe0f0", accent: "#fdd351" },
    prefersTime: "any",
    eggSvg: () => eggBase("#7a8aa0", "#cfe0f0",
      $("path", { d: "M-14 -10 Q-2 -4 -8 4 Q4 8 6 -2 Q-4 -12 -14 -10 Z", fill: "#dbe6f0", opacity: 0.9 }) +
      $("path", { d: "M-2 0 L4 8 L0 10 L6 18", stroke: "#fdd351", "stroke-width": 1.5, fill: "none" })
    ),
    bodySvg: function () {
      const p = this.palette;
      return $("g", { class: "actor-art" },
        // little cloud above head
        $("g", { class: "pocket-cloud" },
          $("ellipse", { cx: 0, cy: -38, rx: 18, ry: 8, fill: "#cfd6e0" }) +
          $("ellipse", { cx: -10, cy: -36, rx: 8, ry: 6, fill: "#dde2ec" }) +
          $("ellipse", { cx: 10, cy: -36, rx: 8, ry: 6, fill: "#dde2ec" })
        ) +
        // body
        $("circle", { cx: 0, cy: 0, r: 14, fill: p.body }) +
        $("ellipse", { cx: 0, cy: 4, rx: 10, ry: 5, fill: p.belly }) +
        // wing
        $("path", { d: "M-2 -2 Q-12 4 -2 10 Z", fill: "#3f5a85" }) +
        // legs
        $("line", { x1: -4, y1: 12, x2: -4, y2: 20, stroke: "#9a7b3f", "stroke-width": 1.4 }) +
        $("line", { x1: 4, y1: 12, x2: 4, y2: 20, stroke: "#9a7b3f", "stroke-width": 1.4 }) +
        // beak
        $("polygon", { points: "12,-2 18,0 12,4", fill: p.accent }) +
        // eye
        $("circle", { cx: 8, cy: -4, r: 2, fill: "#fff" }) +
        $("circle", { cx: 8.5, cy: -3.5, r: 1, fill: "#0c0a1f" })
      );
    },
    specialLabel: "Make it rain",
    specialCooldownMs: 7000,
    special: function (world, actor) {
      world.rainAt(actor.x, actor.y - 38);
      world.toast(actor.name + "'s little cloud bursts.");
      world.discover(actor.id, "Made it rain — a flower grew.");
    },
  };

  // -------------------------------------------------------------------------
  // 7. BUBBLE — Deep Jelly. Floats bubbles you can pop for memories.
  // -------------------------------------------------------------------------
  const bubble = {
    id: "bubble",
    name: "Bubble",
    role: "Jelly of the Drifting Trench",
    story: "Bubble keeps the smallest moments somebody almost forgot. Pop one and you'll catch a glimpse before it returns to the sea.",
    palette: { body: "#ff9ec7", belly: "#ffe5f0", accent: "#a3eaff" },
    prefersTime: "any",
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
    eggSvg: () => eggBase("#f7d8e6", "#ff9ec7",
      $("ellipse", { cx: 0, cy: 4, rx: 16, ry: 22, fill: "#fff", opacity: 0.55 }) +
      $("circle", { cx: -6, cy: -14, r: 4, fill: "#fff", opacity: 0.9 }) +
      $("circle", { cx: 8, cy: 8, r: 2, fill: "#fff", opacity: 0.7 })
    ),
    bodySvg: function () {
      const p = this.palette;
      return $("g", { class: "actor-art" },
        // bell
        $("path", { d: "M-24 -4 Q-24 -28 0 -28 Q24 -28 24 -4 Q0 -8 -24 -4 Z", fill: p.body, opacity: 0.9 }) +
        $("path", { d: "M-24 -4 Q0 8 24 -4", fill: p.belly, opacity: 0.8 }) +
        // tentacles
        $("path", { d: "M-18 -2 Q-20 14 -16 28", stroke: p.body, "stroke-width": 3, fill: "none", "stroke-linecap": "round", opacity: 0.85 }) +
        $("path", { d: "M-8 0 Q-10 18 -4 32", stroke: p.body, "stroke-width": 3, fill: "none", "stroke-linecap": "round", opacity: 0.85 }) +
        $("path", { d: "M2 0 Q0 18 6 32", stroke: p.body, "stroke-width": 3, fill: "none", "stroke-linecap": "round", opacity: 0.85 }) +
        $("path", { d: "M12 -2 Q14 16 10 28", stroke: p.body, "stroke-width": 3, fill: "none", "stroke-linecap": "round", opacity: 0.85 }) +
        $("path", { d: "M20 -2 Q22 12 18 24", stroke: p.body, "stroke-width": 3, fill: "none", "stroke-linecap": "round", opacity: 0.85 }) +
        // inner glow & face
        $("circle", { cx: 0, cy: -16, r: 12, fill: p.accent, opacity: 0.35 }) +
        $("circle", { cx: -5, cy: -18, r: 1.5, fill: "#3b1530" }) +
        $("circle", { cx: 5, cy: -18, r: 1.5, fill: "#3b1530" }) +
        $("path", { d: "M-3 -12 Q0 -10 3 -12", stroke: "#3b1530", "stroke-width": 1.2, fill: "none" })
      );
    },
    specialLabel: "Release a memory",
    specialCooldownMs: 4000,
    special: function (world, actor) {
      const memory = this.memories[Math.floor(Math.random() * this.memories.length)];
      world.releaseBubble(actor.x, actor.y - 10, memory);
      world.toast(actor.name + " releases a bubble. Pop it.");
      world.discover(actor.id, "Memory released: " + memory);
    },
  };

  // -------------------------------------------------------------------------
  // 8. EMBER — Phoenix Chick. Periodically reborn in a new feather color.
  // -------------------------------------------------------------------------
  const ember = {
    id: "ember",
    name: "Ember",
    role: "Phoenix Still Learning to Burn",
    story: "Ember's first life lasted four minutes. He spent it bowing to a beetle. He has been bowing to things ever since, between flames.",
    palette: { body: "#ff7a3d", belly: "#ffd95c", accent: "#ff4d6e" },
    feathers: ["#ff7a3d", "#ff4d6e", "#a04bff", "#3dc6ff", "#4dff9e", "#ffd23d"],
    featherIndex: 0,
    prefersTime: "day",
    eggSvg: () => eggBase("#5a1e10", "#ffb14a",
      $("path", { d: "M-18 12 Q-8 -8 0 6 Q 8 -10 18 12 Q 6 18 -10 16 Z", fill: "#ff7a3d", opacity: 0.85 }) +
      $("path", { d: "M-8 6 Q0 -8 8 6", fill: "#ffd23d", opacity: 0.9 })
    ),
    bodySvg: function () {
      const p = this.palette;
      return $("g", { class: "actor-art" },
        // tail feathers
        $("path", { d: "M-16 -4 L-30 -16 L-24 -6 L-32 0 L-22 2 L-30 12 L-16 6 Z", fill: p.accent }) +
        // body
        $("circle", { cx: 0, cy: 0, r: 16, fill: p.body }) +
        $("ellipse", { cx: 0, cy: 4, rx: 10, ry: 6, fill: p.belly }) +
        // wing
        $("path", { d: "M-4 -2 Q-12 4 -4 12 Z", fill: p.accent }) +
        // head crest
        $("path", { d: "M8 -16 L10 -26 L14 -18 L18 -28 L20 -16 Z", fill: p.accent }) +
        // beak
        $("polygon", { points: "16,-2 22,0 16,4", fill: "#ffb14a" }) +
        // eye
        $("circle", { cx: 12, cy: -4, r: 2, fill: "#fff" }) +
        $("circle", { cx: 12.5, cy: -3.5, r: 1, fill: "#1a0a05" }) +
        // legs
        $("line", { x1: -3, y1: 14, x2: -3, y2: 22, stroke: "#b96820", "stroke-width": 1.4 }) +
        $("line", { x1: 4, y1: 14, x2: 4, y2: 22, stroke: "#b96820", "stroke-width": 1.4 })
      );
    },
    specialLabel: "Rebirth in flame",
    specialCooldownMs: 10000,
    special: function (world, actor) {
      // Cycle to the next feather color.
      this.featherIndex = (this.featherIndex + 1) % this.feathers.length;
      const newColor = this.feathers[this.featherIndex];
      const accentIdx = (this.featherIndex + 2) % this.feathers.length;
      actor.tplPalette.body = newColor;
      actor.tplPalette.accent = this.feathers[accentIdx];
      world.burnAndRebuild(actor);
      world.toast(actor.name + " burns away — and returns " + describeColor(newColor) + ".");
      world.discover(actor.id, "Reborn as " + describeColor(newColor) + ".");
    },
  };

  function describeColor(hex) {
    const map = {
      "#ff7a3d": "ember-orange",
      "#ff4d6e": "rose-flame",
      "#a04bff": "twilight-violet",
      "#3dc6ff": "frost-blue",
      "#4dff9e": "spring-green",
      "#ffd23d": "morning-gold",
    };
    return map[hex] || "a new color";
  }

  // -------------------------------------------------------------------------
  // 9. SOLIS — Secret. Only hatches when all 8 reach max joy.
  // -------------------------------------------------------------------------
  const solis = {
    id: "solis",
    name: "Solis",
    role: "The First Egg, Finally Listening",
    story: "Solis was the original egg, asleep beneath every other. When the eight are happy, she finally remembers she was waiting for them.",
    palette: { body: "#fff8d0", belly: "#fff", accent: "#ffc060" },
    secret: true,
    prefersTime: "any",
    eggSvg: () => eggBase("#fff8d0", "#ffc060",
      $("circle", { cx: 0, cy: 0, r: 24, fill: "url(#sun-glow)", opacity: 0.7 }) +
      // little orbiting marks for each of the 8
      Array.from({ length: 8 }).map((_, i) => {
        const ang = (i / 8) * Math.PI * 2;
        const x = (Math.cos(ang) * 24).toFixed(1);
        const y = (Math.sin(ang) * 30).toFixed(1);
        return $("circle", { cx: x, cy: y, r: 1.6, fill: "#ffc060" });
      }).join("")
    ),
    bodySvg: function () {
      const p = this.palette;
      // Solis cycles through a soft gradient body; rendered with concentric rings.
      return $("g", { class: "actor-art" },
        // halo
        $("circle", { cx: 0, cy: -4, r: 40, fill: "url(#sun-glow)", opacity: 0.6 }) +
        // body
        $("circle", { cx: 0, cy: 0, r: 22, fill: p.body }) +
        $("circle", { cx: 0, cy: 0, r: 22, fill: "none", stroke: p.accent, "stroke-width": 1.6, opacity: 0.7 }) +
        $("circle", { cx: 0, cy: 0, r: 14, fill: p.belly, opacity: 0.8 }) +
        // eyes (closed, content)
        $("path", { d: "M-8 -2 Q-5 0 -2 -2", stroke: "#3a2a10", "stroke-width": 1.6, fill: "none" }) +
        $("path", { d: "M2 -2 Q5 0 8 -2", stroke: "#3a2a10", "stroke-width": 1.6, fill: "none" }) +
        // smile
        $("path", { d: "M-6 6 Q0 11 6 6", stroke: "#3a2a10", "stroke-width": 1.6, fill: "none" }) +
        // little floaty motes
        $("circle", { cx: -28, cy: -18, r: 1.4, fill: p.accent, opacity: 0.9 }) +
        $("circle", { cx: 26, cy: -22, r: 1.2, fill: p.accent, opacity: 0.9 }) +
        $("circle", { cx: 30, cy: 10, r: 1.6, fill: p.accent, opacity: 0.9 })
      );
    },
    specialLabel: "Shift the world",
    specialCooldownMs: 12000,
    special: function (world, actor) {
      world.cycleTime();
      world.toast(actor.name + " turns the day on its hinge.");
      world.discover(actor.id, "Bent time forward.");
    },
  };

  // -------------------------------------------------------------------------
  // Roster
  // -------------------------------------------------------------------------
  const ALL = [aurora, magma, glimmer, mossback, whisper, pip, bubble, ember, solis];

  // Export
  root.CHARACTERS = ALL;
  root.CHARACTER_BY_ID = ALL.reduce((m, c) => (m[c.id] = c, m), {});
})(window);
