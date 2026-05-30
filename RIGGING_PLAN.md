# Hatchling Rigging & Animation — Integration Plan

Goal: replace the static Tripo GLBs with **rigged, animated** versions (skeleton
+ walk/idle/peck/flap clips) driven by `THREE.AnimationMixer`, so the cast moves
with real limb/wing motion instead of the current transform-only hop + breath.

Chosen approach (user): **AI auto-rig via the whipgen/Tripo pipeline.**

> Status note: whipgen MCP was unreachable when this was written (in-process
> `whipgen_help`/`whipgen_health` both timing out at 60s). Execution waits on the
> server. This doc is the ready-to-run spec so the work drops in fast on recovery.

---

## Current asset state (verified)

- 9 GLBs in `docs/models/`: aurora, bubble, ember, glimmer, magma, mossback,
  pip, whisper, bluechicken.
- Each is **raw static Tripo output**: 1 mesh, 1 node, **0 skins, 0 animations**
  (confirmed by parsing the GLB JSON chunk).
- Orientation: Tripo's natural forward is not +X. The engine corrects per model
  via `charDef.modelYaw` (prize set −X → `π/2`; Blue authored +X → `3π/2`),
  applied as an inner wrap group at load.

## Engine integration points (world3d.js)

1. **`_loadGLB(c)` — line ~1777.** Loads the GLB, normalizes scale/center/ground,
   applies `modelYaw` via a wrap group, caches the mesh in `modelCache[c.id]`.
   - **Currently discards `gltf.animations`.** Must be changed to also stash the
     clips, e.g. `this.modelClips[c.id] = gltf.animations`.
   - The scale normalization (`root.scale.setScalar(targetHeight/height)`) and
     the centering offsets must be preserved — they keep feet on the ground and
     the contact-shadow aligned. With a skeleton, prefer scaling/centering the
     **wrap group**, not the skinned root, so bind-pose isn't distorted.

2. **Per-actor clone — line ~2304-2310 (`_buildActorMesh`-ish path).**
   ```js
   const glb = this.modelCache[charDef.id];
   const cloned = glb.clone(true);                 // ← PROBLEM for rigs
   cloned.traverse(n => { if (n.isMesh && n.material) n.material = n.material.clone(); });
   ```
   - `Object3D.clone(true)` does NOT rebind `SkinnedMesh` → `Skeleton`. All
     actors would share/break one skeleton.
   - **Fix:** use `SkeletonUtils.clone(glb)` from
     `three/examples/jsm/utils/SkeletonUtils.js` (must be vendored, version-matched
     to the r160 build already in `vendor/`). Then create a per-actor
     `AnimationMixer(clonedRoot)` and store it + actions on the actor.

3. **Tick loop — `_tickActor(actor, dt)` line ~2488.** Advance the mixer:
   `actor.mixer && actor.mixer.update(dt/1000)`.
   - Crossfade clips by state: idle ↔ walk driven by the existing `speed`/`moving`
     signal already computed for the hop; trigger peck on the existing
     bowl-peck behavior; flap for flying defs.
   - **Layering decision:** once a real walk clip drives the legs, retire the
     procedural Y-hop for rigged actors (keep it as fallback for
     sprite/procedural ones). Breath/idle-hop stay only where there's no idle clip.

4. **Fallback chain unchanged:** GLB → sprite → procedural. Actors whose rigged
   GLB fails to load must still fall back cleanly (mixer simply absent → old
   transform animation runs). No hard dependency on a clip existing.

## Vendoring

- Confirm `vendor/` three version, then add the matching `SkeletonUtils.js`
  (and ensure it's reachable from the import map / module path used by
  `realm.html`). Do NOT mix three versions — addons are version-locked.

## Per-clip animation set (target)

Per creature: `idle`, `walk` (+ maybe `run` for magma's dash), `peck`,
`flap`/`wingflap` (flying: aurora? whisper?), optional `happy`/`celebrate` for
the graduation moment.

## Fan-out execution (on whipgen recovery)

- Real parallel width = **9 creatures**, each in its own git worktree, running:
  rig → animate(clips) → export GLB → drop into `docs/models/` → verify load.
- Finer granularity available if desired: **per-creature × per-clip ≈ 9×6 ≈ 54**
  tasks (rig once per creature, then animate clips in parallel). This is the
  honest way to use more workers; 9 models don't subdivide to 16/1000 otherwise.
- Each agent verifies: GLB parses with skins>0 & animations>0, loads in-engine
  via a headless Playwright check, mixer plays without errors, face-orientation
  still passes (rig must not change forward axis vs `modelYaw`).

## Gates (every change)

`node --check world3d.js`, the functional audit (errors/graduated/survived/NaN),
face-orientation, and a valley screenshot. Deploy to `/v3/` only after green,
with the same abort-on-failure verification used for the existing deploys.
