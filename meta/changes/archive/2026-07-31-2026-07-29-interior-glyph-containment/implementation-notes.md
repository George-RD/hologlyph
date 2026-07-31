# Implementation notes

## Deviations from the todo

- **The todo's premise about `aThickness` is false.** It states "the seeder
  samples `aThickness` at seed time to place the glyph between the near and far
  surfaces, so the clearance is available per glyph without a new bake".
  `sampleInteriorSites` does not do that. Thickness is a vertex-selection
  weight, and the function's own doc comment says the bake normalised the scale
  away, so there is no distance in it to read. The clearance had to be measured
  geometrically instead, which is why this change plumbs the triangle index
  through `readInteriorGeometry` and `InteriorGlyphFieldOptions`. No new bake
  and no new attribute, as the todo required, but not for the reason it gave.
- **The slide length was considered and rejected.** `hypot(dx, dz)`, the
  distance back to the seed vertex, is the cheap stand-in for a clearance and is
  an UPPER bound on the distance to the nearest surface: a site that slid toward
  the body axis is routinely nearer the side of the head. Clamping to it cannot
  satisfy "no glyph crosses the silhouette". Nearest-vertex distance fails the
  same way, because a triangle's interior passes closer to an interior point
  than its corners do.

## Edge cases found while building

- **Bounding the target is not bounding the glyph.** The acceptance says "while
  the head moves". `world` is spring-integrated toward the drift target, the
  spring is deliberately under-damped, and the frame it chases through is
  turning, so both the lag and the overshoot leave any ball the target was
  clamped into. `interiorContain` therefore runs after `interiorIntegrate` and
  is the authority. It also has to drop the outward radial velocity, or a glyph
  caught during a sustained turn stays pinned to the inside of the skin, which
  is exactly the "stuck to the surface" reading the todo warned about.
- **Three spaces, and the scale conversions run in opposite directions.**
  Clearances are bind-space, the sprite extent is world-space, the drift is
  authored in the carrying frame. Converting a clearance outward uses the
  MINIMUM scale; converting a world budget back into frame units uses the
  MAXIMUM, because a frame offset on the most stretched axis reaches furthest.
  Using the minimum for both overstates the frame budget on a non-uniformly
  scaled avatar.
- **The budget cache needs the sprite size in its key.** It was first keyed on
  the frame scales alone, which leaves a stale oversized budget when
  `interior.size` is raised under a stationary head.
- **Collinear triangles.** Ericson's region tests are gated on signs a
  zero-area triangle does not produce, so the interior branch is reached with
  `va + vb + vc == 0`. Falling back to corner A there overreports; the
  degenerate branch measures all three edges.
- **Unreadable topology degrades to zero clearance, not infinite.** A probe
  over geometry with no readable triangle reports 0, which freezes the glyphs
  at rest. Reporting `Infinity` would have been "leave the drift as it was",
  which is the defect.
- **The vitest run in the harness stalled at collection** while the test file
  referenced exports that did not exist yet, with no diagnostic inside ten
  minutes. `bunx tsc --noEmit` gave the red signal in two seconds instead. Not
  a cairn issue; noted so the next session does not lose the same time.

## The look ruling, and what it cost

Bounding the integrated position bounds the INERTIA DRAG, which is an approved
look, and `tools/smoke/interior-glyph-shot.mjs` leg 3 asserted it: a yaw step
had to leave the field at least half its travel behind. Measured before this
change, 0.98 of travel; after, 0.10 to 0.20. The leg failed, correctly.

That is a product fork, not a threshold to nudge, so it went to the owner with
the numbers. The ruling on 2026-07-29 was to accept the bounded drag.
`dec.interior-glyph-containment` records it, along with three alternatives that
were weighed and rejected:

- **A runtime nearest-surface query.** Prototyped as a uniform grid over the
  triangles, then reverted: it is a collision system inside the glyph field, and
  the owner took the simpler trade instead. It stays the upgrade path.
- **Culling every site too shallow to hold the full travel.** No principled
  threshold exists, because a head can turn arbitrarily far, and the measured
  mean clearance of about 0.037 against a required 0.074 would have left almost
  no field at all.
- **Clipping glyph fragments to the body's silhouette** with a stencil or depth
  prepass. It satisfies "no pixels cross" by cutting a glyph at the outline
  rather than keeping it inside, and the hull the engine already has is convex,
  so it would still leak at the neck. Rejected on the look.

## The smoke's settle detector was flaky, and this change exposed it

Leg 3 failed intermittently on `residual`, not on the lag: `settleField`
returned on ONE quiet 500 ms window, and the caller then measured the residual
over the following second. The spring at `inertia: 0.9` converges exponentially,
so its tail is repeatedly quiet across 500 ms while still moving a multiple of
that across the next second. Containment changed the tail's shape enough to make
a pre-existing race fail about half the time.

Two quiet windows was the wrong repair, and was tried first: if both steps are
under the tolerance then the span across both is under twice it by the triangle
inequality, so the condition was free. The detector now CONFIRMS FORWARD, over
the caller's own span, and resumes polling if the field moved. Four consecutive
runs pass with residual 0.00003 to 0.00033 against a budget of 0.0004, and the
lag sits 18 to 90 times the rigid control rather than near a fixed fraction.

## Measured on the shipped bust

- 512 sites seeded, 392 to 400 drawn: about 22% of sites cannot hold their own
  sprite and are culled.
- Field construction, including the probe over the real geometry and 512
  queries: 9 ms.
- Smoke leg 2: 30450 to 30607 px changed inside the silhouette, 0 outside, at
  every run. Before the change, 37127 inside and 0 outside.
- `bun run eval`: overall pass, unmoved, as the field ships at `count: 0`.
