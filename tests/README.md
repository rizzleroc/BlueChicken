# Tests

Two headless Playwright harnesses that drive the **Hatchling Realm**
(`realm.html`) in real Chromium and assert on actual behaviour. They load
`realm.html` directly — that's where `main3d.js` exposes `window.__world`
and `window.__care`. (The shell `index.html` mounts the realm in an iframe,
so those globals live one frame down and aren't reachable from the top page;
an earlier version of `playtest.mjs` targeted the shell and silently tested
nothing.)

## Setup

```bash
# Playwright + its pinned Chromium are preinstalled in CI at
# /opt/node22/lib/node_modules and /opt/pw-browsers. To run locally, make the
# package importable from the repo root (node_modules/ is gitignored):
ln -s /opt/node22/lib/node_modules/playwright       node_modules/playwright
ln -s /opt/node22/lib/node_modules/playwright-core  node_modules/playwright-core
#   …or just `npm i playwright && npx playwright install chromium`
#   (then update BROWSER_PATH at the top of each test).

# Serve the repo root and run:
python3 -m http.server 8765 &
node tests/playtest.mjs       http://127.0.0.1:8765/realm.html
node tests/sim-cognition.mjs  http://127.0.0.1:8765/realm.html
```

Each exits `0` only if its assertions pass and no app-level console/page
error fired. The favicon 404 and the fonts-CDN cert warning are environmental
and filtered out; genuine missing assets are still caught (by response URL).

## `playtest.mjs` — end-to-end smoke

The chicken-fusion flow, with assertions at each step:

1. Load, wait for textures, screenshot the welcome.
2. Confirm Blue's egg is present; dismiss welcome.
3. Project Blue's egg to screen and click it 6× to hatch; dismiss the reveal.
4. Assert the care HUD (needs panel + action bar) appeared.
5. Mash **pet** ×20 + **play** ×5; assert the actions registered and bond rose.
6. Force `bond = 100`, let the loop drop every prize egg, hatch them all,
   and assert the roster reached 9 actors.

Screenshots land in `/tmp/shot-*.png`.

## `sim-cognition.mjs` — proves it's a real simulator

Drives the AI and asserts the perceive → decide → act → satisfy loop is
genuinely need-driven, not random wander:

- **A. Needs decay** — internal state is live and moving for the population.
- **B. Legible thinking** — every actor carries a first-person `_thought`
  (e.g. *"drowsy — off to the coop"*), surfaced in the hover tip.
- **C. Decisions target the most-pressing need** — make an actor tired /
  hungry / lonely and it chooses the goal that fixes *exactly that*. This is
  the count-unbiased fix: four hay bales (fun) can no longer out-vote the one
  coop (rest) when the actor is actually exhausted.
- **D. The loop closes** — an exhausted actor walks to the coop and its energy
  recovers (it rests instead of playing).
- **E. Neglect has stakes** — pin a need critical and joy sinks while mood
  reads the body's loudest signal (`hungry` / `exhausted` / `lonely` /
  `restless`); relieve it and joy recovers toward radiant.

A separate manual soak (not committed) free-runs the valley at 10× for ~2
sim-minutes and confirms no NaN positions, needs stay in `[0,100]`, joy in
`[0,1]`, every actor's worst need recovers (self-maintenance), and mean joy
stays high — i.e. a well-run population genuinely thrives.
