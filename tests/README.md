# Playtest

Drives the game in headless Chromium via Playwright and exercises
every UI surface end-to-end, collecting console errors, page errors
and failed network requests. Captures screenshots of each stage to
`/tmp/shot-*.png`.

## Run

```bash
# Once: install Playwright + its Chromium
npm i playwright
npx playwright install chromium

# Start a local static server for the repo root
python3 -m http.server 8765 &

# Then run the playtest
node tests/playtest.mjs http://127.0.0.1:8765/index.html
```

Exits 0 if no console/page errors fired during the run; non-zero
otherwise.

## What it does, in order
1. Loads `index.html` and waits 2.5s for textures.
2. Probes `window.__world` for boot state (scene children, eggs,
   spriteCache, tree+rock textures).
3. Clicks `#welcome-go`.
4. Projects Aurora's egg world-position to screen and clicks it 6
   times to hatch.
5. Dismisses the hatch-reveal modal.
6. Opens the Codex, screenshots, closes.
7. Opens the Shop, screenshots, closes.
8. Opens the Dev panel via backtick, then triggers Hatch-all.
9. Verifies eight discoveries logged and Solis egg appeared.
