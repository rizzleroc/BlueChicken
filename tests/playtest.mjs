// playtest.mjs — exercise the chicken-fusion flow.
// Sequence: hatch Blue → care HUD appears → mash care buttons to raise bond
// → prize eggs drop in via newlyUnlocked → confirm.
import { chromium } from "playwright";

const BROWSER_PATH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const URL_ = process.argv[2] || "http://127.0.0.1:8765/index.html";

const browser = await chromium.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist",
         "--ignore-certificate-errors", "--allow-insecure-localhost", "--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("pageerror", (e) => errors.push("page: " + (e.stack || e)));

const log = (...a) => console.log("•", ...a);
const shot = (name) => page.screenshot({ path: `/tmp/shot-${name}.png` });

// Clear stale localStorage so each playtest starts from a known state.
await page.addInitScript(() => {
  try {
    localStorage.removeItem("bluechicken/care/v1");
    localStorage.removeItem("bluechicken/hatchling-world/v2");
  } catch (_) {}
});

log("loading", URL_);
const resp = await page.goto(URL_, { waitUntil: "load", timeout: 30000 });
log("status", resp && resp.status());
await page.waitForTimeout(2500);
await shot("01-welcome");

await page.click("#welcome-go").catch(()=>{});
await page.waitForTimeout(600);
await shot("02-blue-egg-alone");

let probe = await page.evaluate(() => {
  const w = window.__world;
  const c = window.__care;
  return {
    eggs: Object.keys(w.eggs),
    actors: w.actors.length,
    care: { bond: c.s.bond, hunger: c.s.hunger },
    careHudHidden: document.getElementById("care").hidden,
  };
});
log("initial state", JSON.stringify(probe));

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

await page.click("#reveal-go").catch(()=>{});
await page.waitForTimeout(500);

probe = await page.evaluate(() => {
  const w = window.__world;
  return {
    eggs: Object.keys(w.eggs),
    actors: w.actors.map(a => a.id),
    careHudVisible: !document.getElementById("care").hidden,
    careVibe: document.getElementById("care-vibe").textContent,
  };
});
log("after Blue hatched", JSON.stringify(probe));

// Mash care buttons to raise bond. We need bond >= 8 for Magma (the first
// prize). Pet adds 2 bond per click + the wellbeing ratchet on tick. So ~5
// pets should unlock Magma; we'll do 20 to make sure.
log("care actions: pet x 20 + play x 5");
for (let i = 0; i < 20; i++) {
  await page.click('.care-actions button[data-care="pet"]').catch(()=>{});
  await page.waitForTimeout(40);
}
for (let i = 0; i < 5; i++) {
  await page.click('.care-actions button[data-care="play"]').catch(()=>{});
  await page.waitForTimeout(40);
}
await page.waitForTimeout(500);
await shot("04-after-care");

probe = await page.evaluate(() => {
  const c = window.__care;
  const w = window.__world;
  return {
    bond: c.s.bond,
    happiness: c.s.happiness,
    timesPetted: c.s.timesPetted,
    timesPlayed: c.s.timesPlayed,
    unlocked: Object.keys(c.s.unlocked),
    eggsInWorld: Object.keys(w.eggs),
    actorIds: w.actors.map(a => a.id),
  };
});
log("after caring", JSON.stringify(probe));

// Force bond up via the test hook for a stress test
log("force bond to 100 to drop all prize eggs");
await page.evaluate(() => { window.__care.s.bond = 100; });
await page.waitForTimeout(800);

probe = await page.evaluate(() => {
  const c = window.__care;
  const w = window.__world;
  return {
    unlocked: Object.keys(c.s.unlocked),
    eggsInWorld: Object.keys(w.eggs),
  };
});
log("after bond=100", JSON.stringify(probe));
await shot("05-all-prizes-dropped");

console.log("\n=== ERRORS ===");
if (errors.length === 0) console.log("  (none — clean run)");
for (const e of errors) console.log("  " + String(e).split("\n").slice(0,3).join("\n  "));

await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
