---
id: dec.silhouette-hull-halo
nodes:
  - hologlyph.asset.pipeline
  - hologlyph.asset.loader
  - hologlyph.runtime.core
status: accepted
date: 2026-07-31
---
# Silhouette hull halo

## Context

The shipped 18 support directions produce 32 baked hull points. The projected
convex clip is about 1.29 times the silhouette's own convex-hull area at rest,
which made compositor frost read as a separate patch behind the head. The owner
named that halo directly. Compositor frost remains gated at `amount: 0`, so this
is preparation for a later owner judgement, not an enabled product change.

## Decision

Raise the primary support-direction count to 32 and the baked-point ceiling to
60. The measured curve predicts a 60-point hull at approximately 1.21 times the
silhouette convex-hull area. The changed-frame browser spike measured a
60-point `clip-path` rewrite at 0.44 to 0.59 ms, within the 1 ms ceiling.

The pinned neutral comparison projects 12 screen-space vertices before and 15
after. The author observed a tighter edge across the crown and upper sides, but
also a conspicuous residual pale wedge left of the jaw and shoulder. This is a
tightening step, not closure: acceptance remains pending the owner's judgement
in `demo/compositor-lab.html`.

The rebaked asset remains subject to the 1.5 MiB delivery budget and the
regenerate-from-source byte-equality guard. It uses the same upstream source,
acquisition command, consumed paths, and licence copy. Its final GLB hash is
recorded below after the deterministic rebake.

## Rationale

The runtime projector uses insertion sort, so its hull construction is O(n²) in
baked point count. The 128-direction, 252-point option has no credible 1 ms
clip-path proof and is not adopted. Thirty-two directions are the smallest
measured increment that meaningfully reduces the halo while staying inside the
existing 60-point browser evidence.

A convex polygon cannot match this non-convex bust at an area ratio of 1.00. If
an owner still reads a halo at 1.21, the next decision is a concave outline, not
further uncontrolled convex subdivision.

## Consequences

- The GLB is rebaked and its final hash and material audit are re-verified.
- The compositor remains default-off pending owner visual judgement.
- The historical 20 to 40 vertex clause in `todo.liquid-glass-silhouette-hull`
  is superseded by this 60-point ceiling.

- No shipped feature changes today: the baked hull's only runtime consumer is
  the compositor path, whose `compositor.amount` remains gated at 0. This work
  prepares a re-judgement of the owner-rejected compositor rung.

## Rebuilt asset

The deterministic rebake produced
`assets/hologlyph-bust.glb` SHA-256
`1f28c3b4cec2a53bef53255b3bf1cf50fb737ec399f4d7d68af99dded028d0e8`
(1,147,056 bytes). The source material audit was rerun after this rebake:
`eye_trim` remains 46 vertices, 168 indices, and 56 triangles, and the
recorded material properties remain unchanged.
