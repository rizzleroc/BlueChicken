// face-orientation.mjs — regression guard for cast facing direction.
//
// Every walking/flying actor must face the direction it MOVES. The per-frame
// rotation `mesh.rotation.y = -heading + π/2` (world3d.js) assumes the model's
// authored front is +Z; each GLB's real front is corrected by `modelYaw`
// (characters3d.js). If a model's modelYaw is wrong/missing, it faces 90° (or
// 180°) off its travel path — the "characters facing away" bug.
//
// This test spawns the cast, lets them wander FREELY (nothing forced), then
// reads each actor's true world facing straight off its live matrixWorld and
// compares it to the actor's heading. Ground truth: the prize GLBs are
// authored facing local -X (whichever of -X/-Z aligns with heading is taken
// as the front). Blue's GLB is the exception — authored facing local +X — so
// her front axis is checked explicitly; checking the -X/-Z candidates instead
// recognises her TAIL as "front" and passes only when her beak points
// backward (the modelYaw=π/2 regression). Any actor off by >TOL fails.
//
// Exits 0 only if every actor faces its movement direction.
import { chromium } from "playwright";

const BROWSER_PATH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const URL_ = process.argv[2] || "http://127.0.0.1:8765/realm.html";
const TOL = 6; // degrees

const browser = await chromium.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist",
         "--ignore-certificate-errors", "--allow-insecure-localhost", "--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.clear(); } catch (_) {} });
await page.goto(URL_, { waitUntil: "load", timeout: 40000 });
await page.waitForTimeout(2500);
await page.click("#welcome-go").catch(() => {});
await page.waitForTimeout(700);

// Hatch Blue + spawn the prize cast, valley view, daytime, free wander.
await page.evaluate(async () => {
  const w = window.__world;
  const mod = await import("/characters3d.js");
  const V3 = w.camera.position.constructor;
  const e = w.eggs["bluechicken"]; if (e) { e.taps = 9; w.tapEgg("bluechicken"); }
  ["magma", "glimmer", "ember", "mossback", "whisper", "aurora", "pip", "bubble"].forEach((id, i) => {
    const c = mod.CHARACTERS.find((o) => o.id === id); if (!c) return;
    const a = (i / 8) * Math.PI * 2;
    try { w._spawnActor(c, new V3(Math.cos(a) * 4, 0, Math.sin(a) * 4)); } catch (_) {}
  });
  w.setView("valley", { instant: true });
  while (w.timeName() !== "day") { w.cycleTime(); }
});

const sample = () => page.evaluate(() => {
  const w = window.__world;
  return w.actors.map((a) => {
    const mesh = a.mesh; mesh.updateWorldMatrix(true, true);
    const root = (mesh.children && mesh.children[0] && mesh.children[0].type === "Group") ? mesh.children[0] : mesh;
    const e = root.matrixWorld.elements;
    return {
      id: a.id, heading: a.heading,
      faceX: Math.atan2(-e[2], -e[0]),   // local -X pushed to world
      faceZ: Math.atan2(-e[10], -e[8]),  // local -Z pushed to world
      faceXpos: Math.atan2(e[2], e[0]),  // local +X pushed to world (Blue's front)
    };
  });
});

// Let them wander, take a couple of samples so transient turns settle.
await sample(); await page.waitForTimeout(2600);
const rows = await sample();

const deg = (r) => Math.round((r * 180 / Math.PI) * 10) / 10;
const norm = (d) => { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

let failed = false;
console.log("id".padEnd(12), "front", "face−heading", "verdict");
for (const o of rows) {
  let off, front;
  if (o.id === "bluechicken") {
    // Blue's GLB is authored facing local +X — check that axis explicitly.
    off = Math.abs(deg(norm(o.faceXpos - o.heading)));
    front = "+X";
  } else {
    const dx = Math.abs(deg(norm(o.faceX - o.heading)));
    const dz = Math.abs(deg(norm(o.faceZ - o.heading)));
    off = Math.min(dx, dz);
    front = dx <= dz ? "-X" : "-Z";
  }
  const ok = off <= TOL;
  if (!ok) failed = true;
  console.log(o.id.padEnd(12), front.padStart(3), String(off).padStart(8) + "°",
              ok ? "OK (faces movement)" : "✗ FACES OFF ITS PATH");
}

await browser.close();
if (failed) { console.error("\n✗ FAIL: one or more actors do not face their movement direction."); process.exit(1); }
console.log("\n✓ PASS: every actor faces the direction it moves.");
process.exit(0);
