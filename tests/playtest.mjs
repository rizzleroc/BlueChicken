// playtest.mjs — drive Chromium, exercise every UI surface, collect every error.
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
const failedReqs = [];
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("pageerror", (e) => errors.push("page: " + (e.stack || e)));
page.on("requestfailed", (r) => {
  const url = r.url();
  if (url.endsWith("/favicon.ico")) return; // browser noise
  failedReqs.push(`${r.failure()?.errorText} ${url}`);
});

const log = (...a) => console.log("•", ...a);
const shot = (name) => page.screenshot({ path: `/tmp/shot-${name}.png` });

log("loading", URL_);
const resp = await page.goto(URL_, { waitUntil: "load", timeout: 30000 });
log("status", resp && resp.status());

await page.waitForTimeout(2500);
await shot("01-welcome");

let probe = await page.evaluate(() => {
  const w = window.__world;
  return {
    worldReady: !!w,
    sceneChildren: w?.scene?.children?.length,
    eggs: w ? Object.keys(w.eggs) : null,
    actors: w ? w.actors.length : null,
    spriteCache: w ? Object.keys(w.spriteCache).length : null,
    treeTexLoaded: !!w?.treeTexture,
    rockTexLoaded: !!w?.rockTexture,
  };
});
log("after-load probe", JSON.stringify(probe));

await page.click("#welcome-go").catch((e) => log("welcome click failed:", e.message));
await page.waitForTimeout(500);
await shot("02-game");

// Click on an egg by projecting its world position to screen space.
async function clickEggByCharId(charId, taps) {
  for (let i = 0; i < taps; i++) {
    const xy = await page.evaluate((id) => {
      const w = window.__world;
      const egg = w?.eggs?.[id];
      if (!egg) return null;
      const pos = egg.mesh.position.clone();
      pos.project(w.camera);
      const c = w.renderer.domElement;
      const rect = c.getBoundingClientRect();
      const sx = rect.left + (pos.x + 1) * 0.5 * rect.width;
      const sy = rect.top  + (-pos.y + 1) * 0.5 * rect.height;
      return [sx, sy];
    }, charId);
    if (!xy) { log(`egg ${charId} not found at tap ${i+1}`); return false; }
    await page.mouse.click(xy[0], xy[1]);
    await page.waitForTimeout(140);
  }
  return true;
}

log("hatching aurora");
await clickEggByCharId("aurora", 6);
await page.waitForTimeout(1000);
await shot("03-hatched-aurora");

probe = await page.evaluate(() => {
  const w = window.__world;
  return {
    eggs: Object.keys(w.eggs),
    actors: w.actors.map(a => ({ id: a.id, isSprite: !!a.mesh.userData.isSpriteActor })),
    revealVisible: !document.getElementById("reveal").hidden,
  };
});
log("after-hatch probe", JSON.stringify(probe));

await page.click("#reveal-go").catch(()=>{});
await page.waitForTimeout(500);

log("open codex");
await page.click("#codex-toggle").catch(e => log("codex toggle failed:", e.message));
await page.waitForTimeout(700);
await shot("04-codex");
await page.click("#codex-close").catch(()=>{});
await page.waitForTimeout(300);

log("open shop");
await page.click("#shop-toggle").catch(e => log("shop toggle failed:", e.message));
await page.waitForTimeout(700);
await shot("05-shop");
await page.click("#shop-close").catch(()=>{});
await page.waitForTimeout(300);

log("open dev panel");
await page.keyboard.press("`");
await page.waitForTimeout(300);
await shot("06-dev");

log("hatch all via dev");
await page.click('button[data-dev="hatchall"]').catch(e => log("hatchall failed:", e.message));
await page.waitForTimeout(2500);
for (let i = 0; i < 12; i++) {
  await page.click("#reveal-go").catch(()=>{});
  await page.waitForTimeout(150);
}
await shot("07-all-hatched");

probe = await page.evaluate(() => {
  const w = window.__world;
  return {
    eggs: Object.keys(w.eggs),
    actorIds: w.actors.map(a => a.id),
    discoveries: Object.fromEntries(Object.entries(w.discoveries).map(([k,v]) => [k, v.length])),
  };
});
log("after-hatch-all probe", JSON.stringify(probe));

console.log("\n=== ERRORS ===");
if (errors.length === 0) console.log("  (none — clean run)");
for (const e of errors) console.log("  " + String(e).split("\n").slice(0,4).join("\n  "));
console.log("\n=== FAILED REQUESTS ===");
if (failedReqs.length === 0) console.log("  (none)");
for (const r of failedReqs) console.log("  " + r);

await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
