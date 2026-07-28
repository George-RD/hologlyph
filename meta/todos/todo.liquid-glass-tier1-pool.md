---
node: hologlyph.runtime.shaders
status: done
created: 2026-07-25
---

# Tier 1 fluid: pool, ripples, meniscus at the waterline

Order 3 (`dec.liquid-glass-architecture`). No prerequisite; may run in
parallel with the other unblocked items.

Recommended first fluid step (`dec.liquid-glass-architecture`). Lab prototype
first; nothing lands in `src/` without owner approval of the lab, the same
pattern the feature-shading lab followed.

`dec.renderer-posture` deferred "the heavy vertex surface-tension displacement
and ripple heightmap" to a later phase. This is that phase, at its cheapest
useful size.

Today the waterline is a hard clip: `src/shaders/emergence.ts` pairs a clipping
plane at the world origin with a root-group translation. Tier 1 keeps that
machinery and dresses it.

Work:

1. GPU ping-pong height field for the pool surface, 256 squared, with damping.
2. Scroll velocity and emergence changes inject ripples; `prefers-reduced-motion`
   damps them, consistent with the rest of the library.
3. Analytic meniscus where the bust crosses the plane: pull the surface up
   around the intersection contour and add a bright contact ring.
4. Bounded outward vertex displacement on the head so the surface breathes.
   Outward-bounded matters: the occlusion mask at renderOrder 0 only keeps
   bounding the internals while the shell never intrudes past them.
5. Internals fade out below the waterline rather than melting.

Explicitly not in tier 1: melting the head into the pool, squeezing around
obstacles, any implicit surface. Those are tiers 2 and 3.

Acceptance: a lab page showing the head emerging from a rippling pool with a
visible meniscus, scroll-coupled, under about 1 ms of added GPU time, with
visemes and expressions untouched and reduced motion respected.

## CUT 2026-07-27

**CUT 2026-07-27** by `src.owner-look-2026-07-27`. `pool.amount` stays 0
permanently and the pool is not a direction to revisit.

> "thats not at all what i was getting at, so we can cut hte pool"

The code is deliberately not deleted. `poolRadialProfile` and `PoolProfile`
supply the bust's bind extent, which `dec.liquid-glass-melt` consumes through
`VFXEngine.setBodyExtent`, and `poolWaterlineRadius` still floors the
compositor outline. The profile is built at avatar load and is not gated on
`pool.amount`, so cutting the look leaves the helpers standing.
