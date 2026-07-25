---
node: hologlyph.runtime.shaders
status: open
created: 2026-07-25
---

# Tier 3: implicit head, true fluid, and the viseme trade

Last stage, deliberately (`dec.liquid-glass-architecture`). Do not start before
tiers 1 and 2 are approved, and do not start without an explicit owner decision
on the trade below.

Tier 3 is what actually delivers the full vision: the head melting into the
pool, the pool migrating, blobs pinching off, the head squeezing around page
elements and re-forming. Position-based fluid or SPH with shape matching against
the head, or a full SDF head, surfaced with screen-space fluid rendering.
WebGPU compute only; must degrade to tier 1 on WebGL2.

## The trade that needs owner sign-off

Internals must join the implicit field, because an implicit outer surface no
longer bounds the rasterised internals: the occlusion mask at renderOrder 0 stops
being the outer surface, so eyeballs poke through a squeezed cheek and the mouth
cavity floats outside a melting jaw.

Voxelising a 17,520-vertex morphing mesh per frame is not affordable, so the
workable form is rig-driven analytic primitives:

- eyeball spheres placed from the `eye_l` and `eye_r` bone transforms, unioned
  into the field, reading as lenses inside the glass
- a mouth cavity ellipsoid subtracted with a smooth minimum, driven from
  `jaw_open` and the viseme weights
- `eye_trim` and iris rings dropped: surface detail with no meaning in a volume

That collapses 15 authored visemes into roughly three analytic mouth parameters.
Lip-sync fidelity is the feature this library is named for, so this is an owner
decision on a lab prototype, not an engineering call made in passing.

Compensating gain: in a volume the text stops being a surface skin and becomes
glyphs suspended inside the glass, sampled at several depths along the view ray,
which reads better as a block of glass than a decal does.

Also required: amend `dec.renderer-posture`, which currently defers compute
shaders and surface-tension simulation.

Acceptance: a lab prototype showing melt, migrate, and re-form, with a
side-by-side viseme comparison against the rasterised head so the fidelity loss
is visible and can be judged rather than discovered later.
