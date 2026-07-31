# Implementation notes: silhouette-hull-halo

- The current compositor frame was captured with frost enabled before rebaking at
  `/tmp/hull-shots/before.png`.
- The compositor remains gated at `amount: 0` in shipped configuration. This
  change prepares an owner comparison and does not claim product readiness.
- The baked hull's only runtime consumer is the compositor path. Because
  `compositor.amount` remains 0 in shipped configuration, this change has no
  effect on a shipped feature today; it prepares a re-judgement of the
  owner-rejected compositor rung.
- The 32-direction choice is bounded by the existing 60-point browser
  measurement. The 252-point option remains unadopted because no comparable
  1 ms evidence exists and the projector uses insertion sort.
- The post-rebake material audit and final asset hash are recorded after direct
  verification, not inferred from the hull-only source change.

- The former bare `bun run build-asset` default wrote raw data directly to the
  shipped asset, while the documented optimisation command consumed a separate
  `.build` path. That sequence could optimise stale data over the asset. The
  build default now writes `.build/hologlyph-bust.raw.glb`, creates its parent
  directory, and the documented package flow names that raw intermediate before
  optimisation writes `assets/hologlyph-bust.glb`.

- The rebaked GLB SHA-256 is
  `1f28c3b4cec2a53bef53255b3bf1cf50fb737ec399f4d7d68af99dded028d0e8`.
- The rebaked asset has 60 baked hull points and is 1,147,056 bytes, leaving
  425,808 bytes below the 1.5 MiB delivery budget. Seven 2,000-update samples
  of the real `SilhouetteProjector` against the shipped 60-point hull measured
  a 0.00182 ms median update (range 0.00152 to 0.00201 ms), under the 0.1 ms
  test ceiling.
- Frames are `/tmp/hull-shots/before.png` and `/tmp/hull-shots/after.png`.
  Both were captured with the compositor layer live, the page field pinned to
  phase 0, motion frozen, and the head, neck, and eyes explicitly reset to the
  same neutral rotations. The 32-point baseline projected 12 screen-space
  vertices; the 60-point rebake projected 15. My honest visual judgement is
  that the 60-point edge follows the neutral head's upper sides more closely,
  but the broad left-side frosted wedge remains conspicuous. The frames do not
  establish that the halo is solved; compositor activation stays owner-gated
  pending the requested judgement.
- The explicit evaluation capture URL was
  `http://127.0.0.1:5173/hologlyph/engine.html`; its score was overall pass.
  `bun run eval` itself cannot target that URL because its package command
  appends arguments to `score.mjs`, and its hard-coded `localhost:5173` default
  resolved to an unrelated local service during this run.
