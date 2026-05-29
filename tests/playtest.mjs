// playtest.mjs — end-to-end smoke test of the Hatchling Realm.
//
// Loads realm.html directly (where main3d.js exposes window.__world and
// window.__care — the shell index.html mounts it in an iframe, so the globals
// live one frame down and aren't reachable from the top page). Exercises the
// chicken-fusion flow: hatch Blue → care HUD appears → mash care to raise bond
// → prize eggs drop in → hatch them all → assert the roster filled out.
//
// Exits 0 only if no console/page errors fired (favicon 404 + the fonts-CDN
// cert warning are environmental and filtered out).
import { chromium } from "playwright";

const BROWSER_PATH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const URL_ = process.argv[2] || "http://127.0.0.1:8765/realm.html";

const browser = await chromium.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist",
         "--ignore-certificate-errors", "--allow-insecure-localhost", "--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

const errors = [];
// Console "Failed to load resource" lines carry no URL, so we filter them here
// and catch genuine missing assets by URL via the response listener below.
const IGNORE = [/favicon\.ico/, /ERR_CERT_AUTHORITY_INVALID/, /fonts\.g(oogleapis|static)\.com/, /Failed to load resource/];
const keep = (s) => !IGNORE.some((re) => re.test(s));
page.on("console", (m) => { if (m.type() === "error" && keep(m.text())) errors.push("console: " + m.text()); });
page.on("pageerror", (e) => { const s = String(e.stack || e); if (keep(s)) errors.push("page: " + s); });
page.on("response", (r) => { if (r.status() === 404 && !/favicon\.ico/.test(r.url())) errors.push("404: " + r.url()); });

const log = (...a) => console.log("•", ...a);
const shot = (name) => page.screenshot({ path: `/tmp/shot-${name}.png` });
const fail = (msg) => { console.error("✗ FAIL:", msg); failed = true; };
let failed = false;

// Clear stale localStorage so each playtest starts from a known state.
await page.addInitScript(() => {
  try {
    localStorage.removeItem("bluechicken/care/v1");
    localStorage.removeItem("bluechicken/hatchling-world/v2");
    localStorage.removeItem("bluechicken/graduates");
  } catch (_) {}
});

log("loading", URL_);
const resp = await page.goto(URL_, { waitUntil: "load", timeout: 30000 });
log("status", resp && resp.status());
await page.waitForTimeout(2500);
await shot("01-welcome");

await page.click("#welcome-go").catch(() => {});
await page.waitForTimeout(600);
await shot("02-blue-egg-alone");

let probe = await page.evaluate(() => {
  const w = window.__world, c = window.__care;
  return {
    eggs: Object.keys(w.eggs),
    actors: w.actors.map((a) => a.id),
    care: { bond: c.s.bond, hunger: c.s.hunger },
    careActionsHidden: document.getElementById("careActions").hidden,
  };
});
log("initial state", JSON.stringify(probe));
if (!probe.eggs.includes("bluechicken")) fail("Blue's egg not present at boot");

// Hatch Blue (her egg sits at 0,0,0 — project + click).
async function clickEgg(charId) {
  const xy = await page.evaluate((id) => {
    const w = window.__world;
    const egg = w?.eggs?.[id];
    if (!egg) return null;
    const pos = egg.mesh.position.clone();
    pos.project(w.camera);
    const c = w.renderer.domElement;
    const rect = c.getBoundingClientRect();
    return [rect.left + (pos.x + 1) * 0.5 * rect.width, rect.top + (-pos.y + 1) * 0.5 * rect.height];
  }, charId);
  if (!xy) return false;
  await page.mouse.click(xy[0], xy[1]);
  return true;
}

log("tap Blue's egg 6 times");
for (let i = 0; i < 6; i++) { await clickEgg("bluechicken"); await page.waitForTimeout(180); }
await page.waitForTimeout(800);
await shot("03-blue-hatched");

await page.click("#reveal-go").catch(() => {});
await page.waitForTimeout(500);

probe = await page.evaluate(() => {
  const w = window.__world;
  return {
    actors: w.actors.map((a) => a.id),
    careActionsVisible: !document.getElementById("careActions").hidden,
    careNeedsVisible: !document.getElementById("careNeeds").hidden,
    vibe: document.getElementById("petVibe").textContent,
  };
});
log("after Blue hatched", JSON.stringify(probe));
if (!probe.actors.includes("bluechicken")) fail("Blue did not hatch into an actor");
if (!probe.careActionsVisible) fail("care action bar hidden after hatch");

// Mash care buttons to raise bond. Pet adds 2 bond per click + the wellbeing
// ratchet on tick; ~5 pets unlocks Magma (bond>=8). Do 20 to be sure.
log("care actions: pet x 20 + play x 5");
for (let i = 0; i < 20; i++) { await page.click('.action[data-care="pet"]').catch(() => {}); await page.waitForTimeout(40); }
for (let i = 0; i < 5;  i++) { await page.click('.action[data-care="play"]').catch(() => {}); await page.waitForTimeout(40); }
await page.waitForTimeout(500);
await shot("04-after-care");

probe = await page.evaluate(() => {
  const c = window.__care, w = window.__world;
  return {
    bond: c.s.bond, happiness: c.s.happiness,
    timesPetted: c.s.timesPetted, timesPlayed: c.s.timesPlayed,
    unlocked: Object.keys(c.s.unlocked),
    eggsInWorld: Object.keys(w.eggs),
  };
});
log("after caring", JSON.stringify(probe));
if (probe.timesPetted < 1) fail("pet action never registered");

// Force bond to 100 to drop every prize egg, then hatch them all.
log("force bond=100 to drop all prize eggs, then hatch everything");
await page.evaluate(() => { window.__care.s.bond = 100; });
await page.waitForTimeout(1200); // game loop consumes newlyUnlocked -> dropPrizeEgg
await page.evaluate(() => {
  const w = window.__world;
  for (const id of Object.keys(w.eggs)) { const e = w.eggs[id]; if (e) { e.taps = 5; w.tapEgg(id); } }
});
await page.waitForTimeout(800);

probe = await page.evaluate(() => {
  const c = window.__care, w = window.__world;
  return { unlocked: Object.keys(c.s.unlocked), actors: w.actors.map((a) => a.id) };
});
log("after bond=100 + hatch-all", JSON.stringify(probe));
if (probe.actors.length < 9) fail(`expected >= 9 actors after hatch-all, got ${probe.actors.length}`);
await shot("05-all-hatched");

console.log("\n=== ERRORS ===");
if (errors.length === 0) console.log("  (none — clean run)");
for (const e of errors) console.log("  " + String(e).split("\n").slice(0, 3).join("\n  "));

await browser.close();
process.exit(errors.length > 0 || failed ? 1 : 0);
