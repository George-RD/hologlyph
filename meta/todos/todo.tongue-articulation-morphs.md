---
node: hologlyph.asset.pipeline
status: open
created: 2026-07-21
---

# Per-phoneme tongue articulation (owner round, 2026-07-21)

Owner wants the tongue to articulate per phoneme during speech: tip to the
upper front teeth on T/D/N/L, tip between the teeth on TH, back raise on K/G.
Currently the tongue only rides the jaw open/close.

## Why it is not a runtime tweak

Measured on the shipped bust (2026-07-21):

- The rig has no tongue bone (`RIG_BONES` = root/head/neck/eye_l/eye_r), so
  there is no bone to articulate.
- No viseme carries a tongue-specific gesture. The `mouth_interior` mesh
  (gums + tongue + teeth, one shared cavity material) deforms under the
  visemes, but `viseme_dd`, `viseme_th` and `viseme_aa` share ONE jaw-coupled
  delta pattern (palate-top static; tongue + floor move together, only scaled).
  The tongue does not tip toward the ridge for coronal/dental consonants.

## Proper fix (asset)

1. Author tongue morph targets in the pipeline (build-bust.ts): at least
   `tongue_up` (tip to alveolar ridge, for T/D/N/L/S/Z), `tongue_out` (tip
   between teeth, for TH), optionally `tongue_back` (K/G). ICT-FaceKit has no
   donor tongue shapes, so these are donor-less Blender sculpts (same path as
   the ~4 existing donor-less shapes), added as morph deltas on the mouth
   primitive only.
2. Add the new names to the rig vocabulary (contracts) if they are to be a
   library-level contract, or keep them mouth-primitive-local if runtime-only.
3. Map coronal/dental visemes to the tongue morphs in the motion engine
   (viseme -> tongue weight coupling), reduced-motion aware.
4. Re-verify: 1.5 MiB budget, regen-from-source byte equality, rig validation
   (zero warnings), speech e2e, and a visual eval baseline update.

## Interim (already shipped, landing-copy-lipsync)

The `mouth_interior` mesh is now driven by the existing morphs, so it opens
with the lips instead of freezing at bind pose. That is the jaw-coupled motion
only; it does not add articulation.

## Alternative considered (rejected for now)

Demo-only procedural tongue-tip displacement (bake a tongue-tip vertex mask,
runtime-offset it toward the teeth on coronal visemes). Visible but approximate
and demo-page-only; deferred in favour of the proper asset morphs when tackled.
