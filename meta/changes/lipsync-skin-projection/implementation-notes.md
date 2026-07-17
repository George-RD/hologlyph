# Implementation notes: lipsync-skin-projection

## 2026-07-17 (SpeechVisemes)

- `src/speech/visemes.ts` (new) and `src/speech/adapters/demo.ts` (rewritten) implement demo-mode visemes.
- Deviation from design.md wording: `VisemeFrame.time` is utterance-relative (seconds since `onstart`), not per-boundary. The timer records `utteranceStartMs` on `onstart` and `boundaryStartMs` on each `onboundary`; each frame time is `(boundaryStartMs - utteranceStartMs + cursor * VISEME_MS) / 1000`. This keeps timestamps monotonic across multiple words instead of resetting to 0 per boundary.
- Silence frame is only emitted when the boundary word produced a non-empty viseme sequence (`sequence.length > 0`); punctuation-only boundaries emit nothing, so the mouth is not spuriously closed mid-word.
- Renamed `ENERGY_TICK_MS`/`ENERGY_DECAY` to `VISEME_TICK_MS` and added `VISEME_MS = 75`; the 30 ms poll interval is retained.
- `wordAt` follows the contract exactly: when `charLength > 0` it slices without word-character validation; otherwise it scans forward from `charIndex` and returns `''` on whitespace/punctuation.
- Tests in `test/speech.test.ts` extended (now 20 passing). `test/speech-e2e.test.ts` uses the provider adapter only and asserts nothing about demo energy, so no update was required; its 2 current failures are in `src/motion` (MotionSmoothing peer, in progress), not this slice.
 
 ## 2026-07-17 (BustEyeSplit)
 
 - Fixed defect 4 (eyes reading as closed blobs): `tools/asset-pipeline/build-bust.ts`
   now partitions the eyeball faces (material groups M_ScleraLeft/M_IrisLeft/
   M_ScleraRight/M_IrisRight) into a SEPARATE `eyes` glTF mesh + node sharing the
   bust's skin (same joints/weights, so gaze-bone rotation still moves them). The
   eyes mesh has two primitives/materials, `eye_sclera` (light, faint emissive for
   a lit look) and `eye_iris` (dark), each grouping both left and right verts by
   material. The bust keeps all 27 canonical morph targets; the eyes carry none
   (glTF requires uniform morph counts per mesh).
 - Verified design assumption: no shipped canonical morph displaces an eyeball
   vertex by more than 1e-5 of normalised units (the per-vertex eyeball-delta
   guard logged nothing at that threshold), so dropping eye verts from the bust's
   morph arrays loses no visible articulation; eyes stay rigid and move only via
   the eye_l/eye_r bones.
 - Determinism preserved: vertices stay in ascending source order and triangles
   are material-uniform, so each partition is clean and the two-step pipeline
   (build-bust + optimize --simplify 0.5) stays byte-deterministic; the regen
   byte-equality guard passes. Simplify at 0.5 keeps both eye primitives (sclera
   ~1009 verts, iris ~1226 verts after optimisation) and does not merge or drop
   them, so no optimizer exclusion was needed.
 - `test/asset-bust.test.ts` extended with structural assertions: a dedicated
   `eyes` node/mesh exists, the eyes mesh has exactly two zero-target primitives
   with the eye_sclera/eye_iris materials, the bust mesh still carries all 27
   canonical targets, and every eye vertex weights fully to eye_l or eye_r. This
   records the eyes-only generation before the mouth-material split.

 ## 2026-07-17 (SkinProjection)

- Reworked `src/shaders/materials.ts` (defect 3 plus the translucent/glow look): `buildSkinMaterial` no longer samples `uv()`. It builds a cylindrical object-space projection in TSL from `positionLocal`, wraps both texture axes with `RepeatWrapping`, derives translucency from sampled luminance, and adds an emissive glow plus a cool fresnel rim. `V_REPEAT` (3.5), `BASE_OPACITY` (0.35), `GLOW_GAIN` (1.4), `RIM_GAIN` (0.12) are exported named constants; `cylindricalUV` (pure same maths) is exported for tests. The `ScrollUniform` contract (`.value` uniform) is unchanged; metalness/roughness were tuned from 0.1/0.6 to 0/0.4 for a translucent hologram. Module stays happy-dom safe (no GPU work at load).
 - `test/shaders.test.ts` extended (now 17 passing): pure `cylindricalUV` checks cover front-facing u=0.5, x-sign symmetry, seam continuity across -z, u in [0,1) at the exact back seam, and v scaling by `BUST_HEIGHT`/`V_REPEAT`; material checks assert `transparent = true` and `RepeatWrapping` on both axes. `bunx tsc --noEmit` stays clean.
 - `positionLocal` morph finding (read-only source inspection, no GPU): `positionLocal` is a single shared varying node (`Position.js`) that MorphNode mutates in place via `mulAssign`/`addAssign` during vertex-stage setup (`MorphNode.js`), and NodeMaterial calls `morphReference(object).toStack()` before the fragment setup reads the value (`NodeMaterial.js`). Because the projection enters via `colorNode`/`emissiveNode` in the fragment stage, it interpolates the post-morph `positionLocal`, so the cylindrical grid DOES subtly follow morph displacement (e.g. jaw motion). This matches the design.md "either behaviour is acceptable" note. The grid is therefore projected in rest space when at rest and deforms slightly with speech, which reads as a projected hologram.
 
 ## 2026-07-17 (BustMouthMaterials)
 
 - Split ICT `M_GumsTongue` faces into a `mouth_interior` primitive and
   `M_Teeth` faces into a `teeth` primitive inside the morph-bearing `bust`
   mesh. Both primitives carry all 27 canonical morph targets, the existing
   skin joints/weights, and deterministic source-order indices. Dedicated
   materials keep the mouth dark (`[0.04,0.03,0.035,1]`, roughness 0.9) and
   teeth light (`[0.75,0.74,0.7,1]`, roughness 0.35) instead of applying the
   translucent text skin.
 - `src/core/engine.ts` now preserves `mouth_interior` and `teeth` materials
   when applying the text skin. Named ordinary morph meshes and unnamed
   placeholder materials still receive the skin. `test/core.test.ts` covers
   both keep-material names plus ordinary and unnamed meshes.
 - The asset test now aggregates morph displacement across bust primitives,
   since mouth/teeth legitimately have near-zero deltas for some visemes while
   the face primitive drives the morph. Structural checks require three bust
   primitives with 27 targets each and two zero-target eye primitives.
 - Optimisation did not merge or drop any primitive. Final layout is bust:
   `bust`, `mouth_interior`, `teeth`; eyes: `eye_sclera`, `eye_iris`. The final
   GLB before the jaw/teeth tuning was 1147548 bytes (~1.09 MiB), below the
   1.5 MiB budget. The tuned final size is recorded below.

## 2026-07-17 (integration, main session)

- Restored the `dispose()` -> `_handle?.cancel()` call the demo adapter rewrite
  had dropped (interval and live utterance leaked past engine teardown);
  regression test added asserting `speechSynthesis.cancel()` fires and viseme
  emission stops.
- Removed the `jaw_open` coupling from `weightsForViseme`: the authored viseme
  targets already embed their own jawOpen deltas (VISEME_RECIPE), so the
  coupling double-opened the mouth (the original Potato Head defect in a new
  form). Frames now pin `jaw_open` to 0.
- Replaced the cylindrical projection with a frontal planar projection after
  headless captures showed crown pinching and chest fanning; `planarUV`,
  `U_SCALE`, `V_SCALE`, `PLANAR_DENSITY` replace `cylindricalUV`/`V_REPEAT`.
- Replaced `drawText` line cycling with a continuous repeating character
  stream (`textStream`): cycled lines stacked spaces into dark vertical
  barcode channels. The repeat unit is space-padded until its length no
  longer divides cols so successive rows phase-shift.
- Reworked test/speech-e2e.test.ts to play viseme frames at their REAL
  timestamps (16 ms steps clamped to each frame window) instead of asserting
  instantaneous weight 1; thresholds derived from the smoothing time
  constants (canonical 100 ms windows converge to ~0.85).
- Mouth interior follow-up: gums/tongue and teeth split into dedicated bust
  primitives with `mouth_interior`/`teeth` materials; engine keeps those
  materials when applying the skin. Vowel jaw deltas restrained in a second
  rig round after captures showed an oversized `aa` and fang-like teeth.
- Headless visual verification (Playwright + system Chrome against the vite
  dev server): grid continuity across face/neck/chest, translucent base,
  glyph glow, open eyes, distinct pp/aa/oh silhouettes captured and inspected.
 
 ## 2026-07-17 (BustJawTeethTuning)
 
 - Tuned the six authored jawOpen recipe weights for natural weight-1 speech:
   `viseme_aa` 0.55, `viseme_ee` 0.35, `viseme_oh` 0.4, `viseme_th` 0.4,
   `viseme_dd` 0.35, and `viseme_kk` 0.35. Other viseme recipe values remain
   unchanged. The recipe is exported without running the CLI on import, so the
   exact values have a focused regression assertion.
 - Darkened teeth to `baseColorFactor [0.4,0.39,0.37,1]`, roughness 0.6, with
   no emissive factor. This keeps teeth shaded rather than bright vertical
   highlights; `mouth_interior` is unchanged.
 - Regenerated and optimised the GLB. Final size is 1130360 bytes (~1.08 MiB),
   under the 1.5 MiB budget. Layout and primitive counts are unchanged:
   bust has `bust`, `mouth_interior`, `teeth` with 27 targets each; eyes has
   `eye_sclera` and `eye_iris` with zero targets. Targeted asset/core tests
   pass 29/29, including byte-equal regeneration, and TypeScript is clean.
 
 ## 2026-07-17 (BustMouthGeometry)
 
 - Superseded the separate `teeth` primitive and material. ICT `M_Teeth` faces
   now join the deterministic `mouth_interior` source/remap, so the bust mesh
   has only `bust` and `mouth_interior` primitives, each carrying all 27
   canonical targets. The runtime keep-set now contains only `mouth_interior`;
   teeth-named materials receive the text skin if encountered.
 - Regenerated through `build-bust.ts` and `optimize.ts --simplify 0.5`.
   Final GLB size is 1094436 bytes (~1.04 MiB), under 1.5 MiB. The eyes mesh
   remains two zero-target primitives, `eye_sclera` and `eye_iris`. Targeted
   asset and core tests pass 29/29, including byte-equal regeneration, and
   TypeScript is clean.
