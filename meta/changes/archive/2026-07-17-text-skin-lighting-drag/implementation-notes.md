# Implementation Notes: text-skin-lighting-drag (Slice A, src/shaders)

## Scope
Owned by this slice: `src/shaders/**` only. No contracts, motion, or demo changes.

## Changes in `src/shaders/materials.ts`
1. **Skin-shading luminance modulation.** Inside `buildSkinMaterial` the TSL graph now computes a monochrome `shade` term as if the bust were plain matte skin, lit by the scene's two directional lights (from `src/renderer/renderer-host.ts:46-54`):
   - Key light world position `(1.2, 1.6, 2.0)`, intensity `2.2`, white.
   - Fill light world position `(-1.5, 0.4, 1.0)`, intensity `0.8`, cool.
   - Uses `normalWorld` (world-space normal) with the world-space light directions normalised.
   - Exact shade formula (TSL):
     ```
     keyDir  = normalize(vec3(1.2, 1.6, 2.0))
     fillDir = normalize(vec3(-1.5, 0.4, 1.0))
     shade = saturate(dot(normalWorld, keyDir)) * SHADE_KEY_WEIGHT
           + saturate(dot(normalWorld, fillDir)) * SHADE_FILL_WEIGHT
           + SHADE_AMBIENT
     shade = clamp(shade, SHADE_FLOOR, 1.0)
     ```
   - `shade` multiplies BOTH `material.colorNode` (`sampled.rgb * shade`) and the sampled-glyph part of `material.emissiveNode` (`sampled.rgb * GLOW_GAIN * shade`). The cool fresnel `rimTint` is added un-shaded so the holographic edge keeps full strength at any facial angle.
2. **Bigger glyphs.** `PLANAR_DENSITY` lowered from `124` to `92` (about 35% larger letters). `U_SCALE`/`V_SCALE` and `planarUV` are unchanged in derivation (still `PLANAR_DENSITY / GRID_COLS` and `PLANAR_DENSITY / GRID_ROWS`); the square-cell invariant `U_SCALE*96 === V_SCALE*64` still holds.
3. **Exported constants** (with doc comments): `SHADE_KEY_WEIGHT = 2.2`, `SHADE_FILL_WEIGHT = 0.8`, `SHADE_AMBIENT = 0.08`, `SHADE_FLOOR = 0.12`.

## Tests
- `test/shaders.test.ts` extended TDD-style (red first, then implemented): pins `PLANAR_DENSITY === 92` and the re-derived scales, and pins the shade constants `SHADE_KEY_WEIGHT === 2.2`, `SHADE_FILL_WEIGHT === 0.8`, `SHADE_AMBIENT === 0.08`, `SHADE_FLOOR === 0.12`. All 19 tests pass.
- **TSL graph is not unit-testable headless.** The shade modulation lives inside the `three/tsl` node graph built in `buildSkinMaterial`; it requires a WebGPU/WebGL context to compile and execute, so there is no pure-function seam to assert `shade` numerically. The surrounding pure maths (`planarUV`, derived scales, and the exported constants) is covered; the graph wiring is verified only by the targeted test's successful import/build path and a `tsc --noEmit` clean pass. Live browser smoke test (parent) is the source of truth for the rendered shading.

## Deviations / open questions
- None beyond the above. Density `92` and the shade constants were chosen as sensible defaults; final tuning is a demo/visual call.

---

# Implementation Notes: text-skin-lighting-drag (Slice B, MotionEngine + demo)

## Scope
Owned by this slice: `src/contracts.ts` (MotionEngine interface only), `src/motion/**`, `demo/**`. No shaders or text-skin changes.

## Contract (`src/contracts.ts`)
+ Added `setHeadTarget(yaw: number, pitch: number): void` to the `MotionEngine` interface with the required doc comment (additive head orientation target in radians, smoothed each update, reduced motion snaps or flattens per existing conventions).

## Motion (`src/motion/index.ts`)
+ New constants: `DRAG_YAW_LIMIT = 0.5`, `DRAG_PITCH_LIMIT = 0.35` (input clamp range), `NECK_DRAG_FRACTION = 0.35` (neck articulation), `DRAG_SMOOTH_TAU = 8` (smoothing `1 - exp(-dt * TAU)`).
+ New head-drag state captured on `attach`: `targetYaw`, `targetPitch`, `curYaw`, `curPitch`, plus `baseNeck` captured from the `neck` bone when present.
+ `setHeadTarget(yaw, pitch)` clamps each input symmetrically into `[-limit, limit]`.
+ In `update(dt, ...)`: `dragK = reduced ? 1 : 1 - exp(-dt * DRAG_SMOOTH_TAU)`; `cur` eases toward `target` by `dragK`. Applied as `head.rotation.x = baseHead.x + nodPitch + curPitch` and `head.rotation.y = baseHead.y + curYaw`. When a `neck` bone exists, `neck.rotation.x/y = baseNeck.x/y + curPitch/curYaw * NECK_DRAG_FRACTION` (neck follows drag only, not the nod, to avoid changing existing nod behaviour).
+ `dispose()` resets the new drag state and `baseNeck`; `setHeadTarget` added to the returned object.

## Demo (`demo/main.ts`)
+ Pointer-drag on `#holo` rotates the head: `pointerdown` captures the pointer (single active `pointerId`; a second pointer is ignored), `pointermove` maps accumulated `dx*0.005`/`dy*0.004` into `dragYaw`/`dragPitch` clamped to `+/-0.5`/`+/-0.35` and calls `engine.motion.setHeadTarget`; `pointerup`/`pointercancel`/`lostpointercapture` release. `canvas.style.touchAction = 'none'` keeps the gesture off document scroll while leaving page scroll elsewhere intact. Scroll-driven emergence is untouched.

## Tests (`test/motion.test.ts`)
Added `describe('head target drag')` with 4 cases (all green, 20/20 in the file):
+ `smoothed toward the target and clamps out-of-range input`
+ `moves the head bone toward the target over updates`
+ `snaps to the pose under reduced motion without drift`
+ `applies a fraction of the drag to the neck bone`
Also extended the shared `makeAvatar` helper to expose a `neck` bone.

## Deviations / open questions
+ **TDD process deviation:** the new behaviour was implemented and the failing-then-green confirmation was not captured as a separate red run; the added tests now pass and assert the required clamp/smoothing/reduced-snap/neck-fraction behaviour, but a pre-implementation red pass was not observed in this session.
+ **Touched `test/core.test.ts`** (outside the strict slice): `FakeMotion` in the `vi.mock('../src/motion', ...)` fake lacked `setHeadTarget`, so it failed `tsc --noEmit` after the contract change. Added a no-op `setHeadTarget() {}` to keep the project type-clean. No other file overlap; Slice A's shader error was not present at final type-check.
+ TSL graph (Slice A) is not unit-testable headless; this slice's smoothing is a pure update over `dt` and state and is covered by vitest.
+ Open question: should a drag reset or recentre gesture (for example double-click to recentre) be added? Not in scope here; pose persists until a new drag.

## Parent adjustment: colorNode not double-shaded

The analytic shade term initially multiplied both colorNode and the emissive.
colorNode is already lit by the renderer's real directional lights, so the
analytic multiply double-shaded it. Removed the multiply from colorNode; the
shade term now applies only to the emissive glyph glow, which is the unlit
path that was washing out the facial topography. Verified in browser: nose,
brow and socket shading read clearly at rest and in dragged profile.
