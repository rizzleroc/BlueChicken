# BlueChicken Realm — Punch List

Tracking outstanding correctness/polish issues for the v3 realm.
Status: 🔴 open · 🟡 investigating · 🟢 fixed/verified

---

## 🟢 P1 — Cast face orientation (faces pointing away from camera) — FIXED

**Reported:** 2026-05-29 (user observation: "all the characters are facing away").
**Fixed:** 2026-05-29 — added `modelYaw: π/2` to all 8 prize GLB characters.

**Symptom:** In valley/cast shots the hatchlings appear to show their backs
rather than their faces.

**Mechanism (code):**
- GLB actors are rotated each frame by `mesh.rotation.y = -heading + π/2`
  (`world3d.js` `_tickActor`/`_steerToGoal`).
- Per-character corrective spin comes from `charDef.modelYaw`, applied as an
  inner wrap group at load (`_loadGLB`).
- **Only `bluechicken` defines `modelYaw` (= π).** Every prize character has
  no `modelYaw`, so if its GLB's authored "front" axis differs from the
  convention (front = +X local), it will systematically face the wrong way.

**Face-direction tracking** — turntable probe (4 copies at yaw 0/π/2/π/3π/2,
camera at +Z). Authored front = the world axis the face points at yaw 0.
`modelYaw needed = authored_front_angle − π/2`.

| character | authored front (yaw 0) | modelYaw before | modelYaw after | result |
|-----------|------------------------|-----------------|----------------|--------|
| bluechicken | −Z | π | π (kept) | ✅ faces cam (control) |
| magma     | −X | — | **π/2** | ✅ faces cam |
| glimmer   | −X | — | **π/2** | ✅ faces cam |
| ember     | −X | — | **π/2** | ✅ faces cam |
| mossback  | −X | — | **π/2** | ✅ faces cam |
| whisper   | −X | — | **π/2** | ✅ faces cam |
| aurora    | −X | — | **π/2** | ✅ (verified in lineup) |
| pip       | −X | — | **π/2** | ✅ (verified in lineup) |
| bubble    | −X | — | **π/2** | ✅ (verified in lineup) |

**Root cause:** heading rotation `mesh.rotation.y = −heading + π/2` requires the
model's front to be +Z. The prize GLBs were authored facing −X and had no
`modelYaw`, so every one faced 90° off its movement direction. Blue's working
`π` corresponds to her different authored front (−Z).

**Verification:** front-facing probe (all set to heading=π/2 → "should face the
+Z camera") — all 9 now present faces; behind-camera probe shows backs (not
double-faced). Since facing is continuous in heading, correct at one heading ⇒
correct at all.

**Unforced free-wander measurement** (2026-05-29 re-check, no rotation forced —
world face direction read straight from each actor's live `matrixWorld`,
compared to actual heading/velocity). `face − heading` should be 0°:

| character | true front axis | face − heading | verdict |
|-----------|-----------------|---------------:|---------|
| bluechicken | −Z | 0° | faces movement ✓ |
| magma / glimmer / ember / mossback / whisper | −X | 0° | faces movement ✓ |
| aurora (fly) / pip (fly) / bubble (float) | −X | 0° | faces movement ✓ |

So every actor faces the exact direction it travels. NOTE: characters face
their **movement direction**, not the camera — a character walking toward the
back of the meadow correctly shows its back. That is expected, not the bug;
the bug (face 90° off the travel path) is gone. If a future regression makes
the cast face away from travel again, run `node tests/face-orientation.mjs`
(committed regression guard) — it fails on any non-zero `face − heading`.

---

## 🟢 Done

- **Night character separation** — rim/back light floored at moonlit level so
  the cast lifts off the dark ground at night (`world3d.js`). Deployed to /v3/.
- **3D mountains** — billboard sprites → faceted low-poly snow-capped peaks
  (ring of 18 + center peak) that catch sun + moonlit rim and recede into fog.
  Verified day/dusk; zero errors.
- **Barn** — flat box + two floating roof planks → solid extruded gable-prism
  roof (sloped faces + gable ends + eaves), ridge cap, corner posts, framed
  door + window. Verified care view; zero errors.
- **Hay bales** — plain cylinders → rolled bales with twine banding + lighter
  rolled-straw end caps. Verified; Blue's hop-on-bale toys still aligned.
