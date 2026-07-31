# Design: interior glyph containment

## Where the clearance comes from

The todo proposed reading the clearance off `aThickness`, on the belief that
the seeder places a glyph between the near and far surfaces by it. It does not:
`sampleInteriorSites` uses thickness only as a vertex-selection WEIGHT, and its
own doc comment records why, that the bake normalises thickness by the largest
chord in the mesh and so threw the scale away. There is no distance in it.

Two candidates were available without a new bake:

1. The inward slide, `hypot(dx, dz)`, the distance back to the seed vertex.
   Cheap, and wrong in the unsafe direction: it is an UPPER bound on the
   distance to the surface, because a site that slid toward the body axis is
   routinely closer to the side of the head than to the patch it came from.
2. The exact distance to the nearest point on the mesh, which needs the
   triangles.

Option 2, via `createSurfaceProbe`. Nearest-VERTEX distance was rejected for
the same reason as option 1: a triangle's interior passes closer to an interior
point than any of its corners, so it also overreports.

The probe is exact brute force behind a bounding-sphere reject: per triangle,
one squared centroid distance and a compare, with Ericson's barycentric region
walk only on triangles that could still win. Built once for at most
`INTERIOR_GLYPH_MAX` queries, on a field the shipped config never switches on,
so a BVH would be carried weight for no measurable gain.

## Two spaces, two scales

Clearances are measured in bind space; the sprite extent is in world units; the
drift is authored in the carrying frame. So:

- bind to frame: multiply by the MINIMUM scale of `bindToFrame`.
- frame to world: multiply by the MINIMUM scale of `state.frameMatrix`.
  Minimum, because a clearance measured along one axis and spent along another
  must assume the least generous conversion.
- world budget back to frame units: divide by the MAXIMUM scale of
  `state.frameMatrix`. Maximum, because a frame-space offset lying on the most
  stretched axis is the one that reaches furthest in world space.

Getting either direction the wrong way round overstates the room on a scaled
avatar. The budgets are cached against both scales AND the sprite extent, and
rebuilt when any of the three moves, which covers a config change of
`interior.size` under a stationary head as well as an avatar swap.

## Why bounding the target is not enough

`interiorDriftTargets` bounds where a glyph is ASKED to be. What a viewer sees
is `world`, which the spring integrates toward that target, under-damped on
purpose (`INTERIOR_DAMPING_RATIO` 0.55) and through a frame the head is
turning. Both the lag and the overshoot leave the bounded ball. So
`interiorContain` runs after the integrator and is the last word: it projects
each glyph back into the ball of radius `budgetsWorld[g]` about its own carried
rest position, and drops the OUTWARD radial component of its velocity so a
spring cannot hold it pinned against the wall for as long as the head keeps
turning. The tangential component survives, so a caught glyph slides.

## Why the cap is on the length

The three drift sines peak together on the diagonal, at
`sqrt(1 + 0.7^2 + 1) = 1.58` times what any one axis shows. Clamping per axis
would leave the corner of the cycle outside the skin. Below the cap the offset
is bit-for-bit what the unbounded field produced, so a default-drift head is
unchanged and reduced motion still damps.

## Degrade toward the safe end

An unreadable surface, no index and a position buffer that is not triangle
soup, yields a probe that reports 0 rather than `Infinity`. Zero clearance
freezes the glyphs at their rest positions; unbounded clearance would reinstate
the exact defect. Same reasoning for collinear triangles, which a decimated GLB
does contain: the degenerate branch measures the three edges rather than
falling back to a corner, because a corner overreports.
