// sim-cognition.mjs — real-world test that the Realm is a genuine simulator:
// every actor runs a perceive → decide → act → satisfy loop driven by felt
// needs, not random wander. We drive realm.html headless, hatch the whole
// roster, then run targeted experiments on the AI and assert outcomes.
//
// What it proves:
//   A. Needs decay over time (the world has internal state that moves).
//   B. Thinking is legible — every actor carries a first-person _thought.
//   C. Decisions target the MOST-PRESSING need — make an actor hungry/tired/
//      lonely and it chooses the goal that fixes exactly that. This is the
//      count-unbiased fix: four hay bales (fun) can't out-vote one coop (rest).
//   D. A tired actor actually RESTS and recovers (the loop closes).
//   E. Neglect has stakes — pin a need critical and joy sinks + mood reflects
//      it; relieve it and the actor recovers toward radiant.
//
// Exit 0 only if every assertion passes and no app console/page error fired.
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

let failed = false;
const ok   = (cond, msg) => { console.log((cond ? "  ✓ " : "  ✗ ") + msg); if (!cond) failed = true; };
const log  = (...a) => console.log("•", ...a);

await page.addInitScript(() => {
  try {
    localStorage.removeItem("bluechicken/care/v1");
    localStorage.removeItem("bluechicken/hatchling-world/v2");
    localStorage.removeItem("bluechicken/graduates");
    localStorage.setItem("bc-dev", "1");
  } catch (_) {}
});

log("loading", URL_);
const resp = await page.goto(URL_, { waitUntil: "load", timeout: 30000 });
log("status", resp && resp.status());
await page.waitForTimeout(2000);
await page.click("#welcome-go").catch(() => {});
await page.waitForTimeout(400);

// Unlock + drop all prize eggs (bond=100), let the loop place them, hatch all.
await page.evaluate(() => { window.__care.s.bond = 100; });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const w = window.__world;
  for (const id of Object.keys(w.eggs)) { const e = w.eggs[id]; if (e) { e.taps = 5; w.tapEgg(id); } }
});
await page.waitForTimeout(600);

const roster = await page.evaluate(() => window.__world.actors.map((a) => a.id));
log("hatched:", roster.join(", "));

// ---- helpers run inside the page ------------------------------------------
const setFastTime = (on) => page.evaluate((on) => {
  const w = window.__world;
  const want = !!on;
  // main3d owns the fastTime flag via the dev button; click to match.
  const btn = document.querySelector('[data-dev="fasttime"]');
  const isOn = btn && /\(on\)/.test(btn.textContent);
  if (btn && isOn !== want) btn.click();
}, on);

const force = (id, needs) => page.evaluate(({ id, needs }) => {
  const a = window.__world.actors.find((x) => x.id === id);
  if (!a || !a._needs) return false;
  Object.assign(a._needs, needs);
  return true;
}, { id, needs });

const readOnce = (id) => page.evaluate((id) => {
  const a = window.__world.actors.find((x) => x.id === id);
  if (!a) return null;
  return {
    joy: a.joy, mood: a.mood, thought: a._thought || null,
    goal: a._goal ? a._goal.kind : null,
    satisfies: a._goal ? a._goal.satisfies : null,
    needs: a._needs ? { ...a._needs } : null,
  };
}, id);
// Resilient read — a single evaluate can race a frame; retry briefly.
const read = async (id) => {
  for (let i = 0; i < 5; i++) {
    const r = await readOnce(id);
    if (r) return r;
    await page.waitForTimeout(60);
  }
  return null;
};

const readAll = () => page.evaluate(() =>
  window.__world.actors.map((a) => ({
    id: a.id, joy: a.joy, mood: a.mood, thought: a._thought || null,
    needs: a._needs ? { ...a._needs } : null,
  })));

// ===========================================================================
console.log("\n── A. needs decay ──");
await setFastTime(true);
const before = await readAll();
await page.waitForTimeout(1500);
const after = await readAll();
{
  let moved = 0;
  for (const b of before) {
    const a = after.find((x) => x.id === b.id);
    if (!a || !a.needs || !b.needs) continue;
    const d = ["hunger", "energy", "social", "fun"].some((k) => Math.abs(a.needs[k] - b.needs[k]) > 1);
    if (d) moved++;
  }
  ok(moved >= 6, `needs are live and moving for the population (${moved} actors changed)`);
}

console.log("\n── B. thinking is legible ──");
{
  const all = await readAll();
  const withThought = all.filter((a) => a.thought && a.thought.length > 3);
  ok(withThought.length >= all.length - 1, `actors carry a first-person thought (${withThought.length}/${all.length})`);
  log("sample thoughts:", all.slice(0, 4).map((a) => `${a.id}:"${a.thought}"`).join("  "));
}

// ---- C. decisions target the pressing need --------------------------------
// Re-force the target need low (others high) on each poll so the actor stays
// urgent and we observe a stable decision. The count-unbiased softmax should
// pick the goal that relieves exactly that need.
console.log("\n── C. decisions target the most-pressing need ──");
await setFastTime(false);
async function expectGoalFor(id, lowNeed, wantSatisfies, label) {
  await force(id, { hunger: 92, energy: 92, social: 92, fun: 92, [lowNeed]: 12 });
  await page.waitForTimeout(350); // settle: urgency override re-plans
  let match = 0, total = 0;
  for (let i = 0; i < 10; i++) {
    await force(id, { hunger: 92, energy: 92, social: 92, fun: 92, [lowNeed]: 12 });
    await page.waitForTimeout(110);
    const s = await read(id);
    total++;
    if (s.satisfies === wantSatisfies) match++;
  }
  ok(match >= 8, `${label}: ${id} chose a ${wantSatisfies}-goal in ${match}/${total} polls`);
}
await expectGoalFor("magma",    "energy", "energy", "tired → rest");
await expectGoalFor("mossback", "hunger", "hunger", "hungry → eat");
await expectGoalFor("ember",    "social", "social", "lonely → seek company"); // ground actor (pip/aurora fly)

// ---- D. a tired actor actually rests and recovers (loop closes) -----------
console.log("\n── D. tired actor rests and recovers ──");
{
  const id = "magma";
  // Park it next to an energy toy first, so the test measures the *decision +
  // refill* (does a tired actor rest and recover?) rather than how far it
  // happened to spawn from the coop. Then make it exhausted.
  await page.evaluate((id) => {
    const w = window.__world;
    const a = w.actors.find((x) => x.id === id);
    const toy = (w.toys || []).find((t) => ["coop", "bed", "perch", "henhouse"].includes(t.label));
    if (a && toy) { a.mesh.position.x = toy.pos.x + 1.2; a.mesh.position.z = toy.pos.z; a._goal = null; }
  }, id);
  await force(id, { hunger: 90, energy: 16, social: 90, fun: 90 });
  let sawEnergyGoal = false, peak = 16;
  for (let i = 0; i < 40; i++) {       // up to ~8s real time
    await page.waitForTimeout(200);
    const s = await read(id);
    if (s.satisfies === "energy") sawEnergyGoal = true;
    if (s.needs) peak = Math.max(peak, s.needs.energy);
  }
  ok(sawEnergyGoal, `${id} set a rest goal while exhausted`);
  ok(peak > 45, `${id} energy recovered to ${Math.round(peak)} (rested instead of playing)`);
}

// ---- E. neglect has stakes; care restores --------------------------------
console.log("\n── E. neglect crushes joy; relief restores it ──");
{
  const id = "glimmer";
  await setFastTime(true);
  // Pin every need critical (total neglect — it can refill one, but we
  // overwrite faster than it can dig out). Hunger lowest so mood reads hungry.
  for (let i = 0; i < 70; i++) {
    await force(id, { hunger: 3, energy: 7, social: 7, fun: 7 });
    await page.waitForTimeout(30);
  }
  await force(id, { hunger: 3, energy: 7, social: 7, fun: 7 });
  const low = await read(id);
  ok(low.joy < 0.5, `starved ${id} joy sank to ${low.joy.toFixed(2)}`);
  ok(low.mood === "hungry", `starved ${id} mood reads "${low.mood}"`);
  // Relieve: top everything up and let the loop sustain it.
  await force(id, { hunger: 95, energy: 95, social: 95, fun: 95 });
  await page.waitForTimeout(2500);
  const hi = await read(id);
  ok(hi.joy > 0.75, `relieved ${id} joy recovered to ${hi.joy.toFixed(2)}`);
}

await page.screenshot({ path: "/tmp/shot-cognition.png" });

console.log("\n=== console/page errors ===");
if (errors.length === 0) console.log("  (none — clean run)");
for (const e of errors.slice(0, 10)) console.log("  " + String(e).split("\n")[0]);
if (errors.length) failed = true;

await browser.close();
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS");
process.exit(failed ? 1 : 0);
