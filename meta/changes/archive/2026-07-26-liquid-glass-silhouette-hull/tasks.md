# Tasks: liquid-glass-silhouette-hull

- [x] Bake a per-joint outer polytope in `tools/asset-pipeline/silhouette-hull.ts`
      from support half-spaces, with the morph reachability model derived from
      how MotionEngine composes weights.
- [x] Retire joints whose geometry provably stays inside the primary polytope
      under any rotation of their own bone, and record them for provenance.
- [x] Make the bake byte-deterministic (closed-form directions, ordered triple
      enumeration, fixed rounding, sorted output) and run it last in
      `optimize.ts`, after every geometry transform.
- [x] Write the hull into the glTF scene extras and regenerate the shipped GLB.
- [x] Add the `SilhouetteHull` contract and read it onto `LoadedAvatar`,
      returning null for any asset that does not carry a readable one.
- [x] Add `SilhouetteProjector`: preallocated buffers, per-group skin matrix,
      monotone-chain polygon, CSS `clip-path` emission, degrade when the camera
      is inside the hull.
- [x] Unit tests: hull parsing and rejection, cube projection against a known
      ortho camera, pose tracking, CSS output, missing joint, buffer identity.
- [x] Acceptance: every skinned and morphed shipped vertex inside the polygon
      across eight poses crossed with four morph states, plus a negative
      control that fails with a five per cent undersized hull.
- [x] Confirm the regenerated GLB is geometrically identical to the previous
      one (accessor-by-accessor digest) so no visual eval is implicated.
- [x] Verify: `bunx tsc --noEmit`, `bunx vitest run`, `bun run build`,
      `bun run lint`, `cairn hook all`.
- [x] Independent review; findings fixed or recorded.
