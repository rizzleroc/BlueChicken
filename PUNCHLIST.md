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
- **Atmosphere & post-FX pass:**
  - *Bloom* — vendored version-matched three r160 post-processing addons;
    EffectComposer (RenderPass → UnrealBloomPass → OutputPass) via
    `composer.render()`. OutputPass re-applies the existing ACES grade, so
    bloom only adds a soft glow on bright emissive/additive pixels (strength
    0.5 / radius 0.5 / threshold 0.9 — sky & snow stay un-washed).
  - *Golden-hour grade* — dusk retuned to warm amber/honey/peach.
  - *Animated water* — flat pond disc → tessellated radial-grid surface with
    shore-tapered cross-wave ripples; shifting normals make the glints dance
    (and bloom turns them to sparkle).
  - Verified day/dusk/night render, functional, soak, mobile, and the facing
    regression — all green, zero errors.
- **Painterly ground** — the meadow texture was a smooth radial gradient that
  read as a flat green bullseye once mapped across the 56-unit disc. Rewrote
  `_makePaintedGroundTexture` with large-scale tonal mottling (varied greens),
  a soft trampled centre clearing, retained fine grass/flower detail, and edge
  darkening so the rim sinks into the field. Reads as an organic painted meadow.
  Verified valley + care views, functional/soak/face — all green, zero errors.
- **Blue care-view facing** — Blue showed a profile/back instead of facing the
  player in care view. Root cause: her GLB is authored facing local **+X** (a
  different raw orientation than the prize set's −X), so the engine's front=+Z
  convention needs a **−90° (3π/2)** corrective `modelYaw`, not the `π` she had.
  Pinning the exact value took two wrong tries — `π/2` (left her **backwards**)
  and a transient screenshot that misled me — so I rendered all four 90° yaws in
  the *settled* care view: `0`→+X, `π/2`→away, `π`→left, **`3π/2`→faces player**.
  At 3π/2 her world-front equals `(cos h, sin h)` for every heading, so she also
  leads with her beak in the valley. Set `modelYaw: 3π/2`. Verified: settled care
  faces the player; face-orientation (now front-aware) + functional both pass,
  zero errors.
  - Also **hardened the face-orientation guard**: it previously only tested raw
    axes −X/−Z, so for Blue (+X) it mistook her *tail* for her front and passed
    only when her beak pointed backward. It now checks Blue's +X front explicitly
    (0° off heading), making it a real guard against this exact regression.
- **Daytime sky / clouds** — the day sky read flat and empty: the cloud sprites
  were cream-white-pink with no shaded form, so they dissolved into the pale
  horizon haze (`fogColors.day`). Rewrote the cloud texture as a flat-bottomed
  cumulus — cool blue-grey shaded underside + sunlit top — so the silhouette
  reads against pale sky (and still looks warm at dusk / moonlit at night).
  Spread 8 wider-than-tall clouds in the band just above the mountain ridge so
  they sit in the visible sky from the valley camera. Verified day/dusk/night
  valley + care framing; face-orientation + functional pass, zero errors.
- **Springy hop locomotion** — grounded creatures slid along the ground (only a
  tiny constant breath-bob). Added a speed-aware hop in `_tickActor`: a bounce
  (height ~0.34) whose cadence rises slightly with speed, eased in/out via
  `_hopAmt` so starts/stops aren't jarring, plus squash-stretch tied to the hop
  (tall at the apex, wide at contact) that fades to the gentle idle breath when
  standing still. Universal to all 8 prize creatures. Verified numerically (all
  grounded actors bounce 0.62→0.95 while moving, settle when idle) and via
  face-orientation + functional, zero errors.
- **Spontaneous idle hops** — a creature standing at its goal was static (breath
  only). Added staggered one-shot idle hops (`_idleHopT`/`_idleHopAt`, a 0→1→0
  arc every ~2.6–7s per actor) with their own squash-stretch, so the cast keeps
  bouncing in place when not walking. Verified all grounded creatures fire idle
  hops while still (hopAmt≈0, arc reaches 1.0); face + functional pass, zero
  errors.
- **Spontaneous idle hops** — a creature standing at its goal was static (breath
  only). Added staggered one-shot idle hops (`_idleHopT`/`_idleHopAt`, a 0→1→0
  arc every ~2.6–7s per actor) with their own squash-stretch, so the cast keeps
  bouncing in place when not walking. Verified all grounded creatures fire idle
  hops while still (hopAmt≈0, arc reaches 1.0); face + functional pass, zero
  errors.
