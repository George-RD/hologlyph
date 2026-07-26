# Tasks: 2026-07-26-liquid-glass-solid-body

- [x] Ray-bake a per-vertex `aThickness` mask in `src/asset/rig.ts`, grid
      accelerated, hole filled and smoothed, with vertex, triangle and
      cell-reference budgets that degrade to zero rather than stall the page.
- [x] Split the raycast out of `bakeFeatureMasks` into `bakeThickness` so only
      glass-shaded meshes pay for it; the engine owns that policy.
- [x] Apply Beer-Lambert absorption to the front surface opacity, gated by
      `skin.glass.amount`.
- [x] Build the back-facing interior wall from the same node graph, sharing
      every uniform so the two halves cannot drift.
- [x] Widen `VFXEngine.createSkinMaterial` to `SkinMaterials` and migrate all
      four callers.
- [x] Draw the interior at `renderOrder -1` and move the mask and internals
      into the transparent list so the ordering holds.
- [x] Dispose both overlay passes on avatar replace and on engine dispose.
- [x] Regression test the DDA nearest-hit rule with a probe where the far wall
      shares the origin cell (fails at 0.7526 without the fix).
- [x] Test the budgets, the split bake, and the shipped bust's thickness
      ordering (forehead more than twice nose tip and chin).
- [x] Test the draw order, the transparent flags and the overlay teardown.
- [x] Verify: `bunx tsc --noEmit`, `bunx vitest run`, `bun run lint`,
      `bun run build`, `bun run eval` (+ negative control), `cairn hook all`.
- [x] Verify acceptance in a real browser in four cases (neutral, jaw-open,
      blink, 0.6 rad orbit): at `glass.amount = 0` no pixel's luminance moves
      and at most 115 differ by at most 3/255; about 14.1% at `amount = 1`.
- [x] Two independent reviews (correctness plus adversarial on another model);
      every finding fixed or measured out and recorded in the notes.
- [x] Unwind the draw-order change at `glass.amount = 0`: it shifts the open
      mouth by about 15 luma, so it may not be unconditional.
- [x] Cap the raycast with a per-avatar intersection-test budget, support
      non-indexed geometry, and scale every tolerance to the model extent.
- [x] Second review round on the reworked code; every finding fixed, including
      the triangle preflight, unreferenced vertices, shared geometry, layering
      activation and teardown, and the capture identity.
