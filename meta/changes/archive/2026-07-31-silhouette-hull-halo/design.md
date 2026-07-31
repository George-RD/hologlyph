# Design: silhouette-hull-halo

## Approach

Bake 32 support directions into a 60-point convex hull. This is the first
measured tightening step, targeting 1.21 times the silhouette convex-hull area
and retaining the measured 0.44 to 0.59 ms 60-point clip-path evidence.

The compositor remains gated off. The acceptance image comparison records
whether the tighter convex outline is enough for owner judgement, without
claiming that it is product-ready.

## Changes

ADDED:
- Decision and verification record for the superseded point budget.

MODIFIED:
- Hull bake direction count, point ceiling, shipped GLB, material audit, and
  hull regression assertion.

REMOVED:
- None.

RENAMED:
- None.
