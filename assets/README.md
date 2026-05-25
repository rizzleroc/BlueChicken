# CLUCKBOT assets

Drop PNGs here and the renderer picks them up on the next frame. Every
slot is optional — when a file is missing, the procedural canvas
fallback keeps the site looking exactly like it does today.

Loader: `js/assets.js` (cached, with `ready` / `failed` flags).

## Slots

### `variants/<id>.png` — hatch portrait + topbar icon

512x512, transparent background, consistent style across the set.
Used by:
- `js/main.js` `showHatch()` — overlaid on the conic-gradient swatch
  in the hatch modal (96x96 circle).
- `js/main.js` `syncTopbarPortrait()` — small circular avatar next to
  the pet name in the topbar (36px desktop, 28px tablet, 24px mobile).

Filenames (one per variant defined in `js/egg.js` `VARIANTS`):
- `variants/cosmic.png`
- `variants/solar.png`
- `variants/lunar.png`
- `variants/hyper.png`
- `variants/feral.png`
- `variants/glitch.png`
- `variants/mossy.png`
- `variants/ghost.png`

Hidden variants defined in `js/story.js` `ORIGINS` but not yet
unlockable: `ancestral`, `haunted`. Add `variants/ancestral.png` and
`variants/haunted.png` when the unlock paths land.

### `world/day.png` and `world/night.png` — background plates

Recommended: 1920x1080 or wider, drawn full-bleed and scaled to the
canvas. They REPLACE the procedural sky+mountain layers when BOTH
load; clouds/stars/rain/fireflies/ground/flowers still animate on top.
If either is missing, the procedural sky+mountains stay.

Crossfade is driven by time-of-day in `js/world.js`:
- night fully visible when tod < 0.18 or tod > 0.85
- day fully visible between tod 0.32 and 0.7
- linear crossfade across dawn/dusk

### `static/portrait.png` — The Static antagonist

Recommended: ~256x384, transparent background, dark robot silhouette
with a single red eye. Drawn at 60x90px on the horizon when sanity
< 30. Rendered with an additive red glow behind it so the eye reads
even from a flat sprite. Falls back to the hand-drawn vector silhouette
in `js/story.js drawStatic` if missing.
