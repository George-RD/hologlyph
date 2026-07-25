---
id: res.liquid-glass-direction
nodes: [hologlyph.runtime.shaders, hologlyph.runtime.renderer, hologlyph.runtime.core, hologlyph.asset.pipeline]
sources: [src.shojiwm-liquid-shaders-2026-07-25, src.dom-capture-survey-2026-07-25, src.owner-approved-look-2026-07-21]
date: 2026-07-25
---

# Liquid glass: two independent axes, and what each one costs

Owner direction (2026-07-25): the head should read as a block of liquid glass
that is part of the host page, eventually with fluid behaviour, a pool at the
bust base with surface tension, ripples driven by scroll, and the head
emerging from, submerging into, and squeezing around page elements.

The work splits into two axes that are often conflated. They compose (a fluid
surface feeds the same normals and the same outline that a rigid bust does) but
they are costed, risked, and shipped separately.

- **Axis 1, what the glass refracts.** Constrained by the platform, not by us.
  Settled in `res.dom-backdrop-capture`.
- **Axis 2, what shape the glass is.** Constrained by our own renderer and rig.

## Axis 1: what the glass can refract

Summary of the measured position, full detail in `res.dom-backdrop-capture`:

| Source of pixels | Live | True lensing | Engines | Cost |
| --- | --- | --- | --- | --- |
| Flat colour, auto-detected | n/a | n/a | all | zero, shipped |
| Compositor `backdrop-filter` clipped to the silhouette | yes | no | Chrome and Safari verified, Firefox unverified | 0.44 to 0.59 ms per frame |
| DOM rasteriser snapshot of a declared subtree | no, stale | yes | all | 10 to 150 ms per capture |
| Chromium HTML-in-Canvas | yes | yes | Chromium only, flag or origin trial | vsync-bound, 8.33 ms |

Two hard walls: nothing reads the page behind a transparent canvas without a
permission prompt, and HTML-in-Canvas only draws immediate children of the
canvas being drawn into, so it moves content in rather than seeing content
behind.

## Axis 2: what shape the glass is

Technique reference is `src.shojiwm-liquid-shaders-2026-07-25`: an SDF lens with
a spherical displacement profile and a chromatic split, plus an eight-wave
analytic ripple field with finite-difference normals. Both are the same family
as the fresnel-weighted refraction already shipped in `src/shaders/materials.ts`.
Nothing about the fluid look needs a technique we do not have; it needs surface
representation and, above a certain point, simulation.

Three tiers, in increasing order of cost and of damage to existing invariants.

### Tier 1: surface fluid, raster head unchanged

Pool as a GPU ping-pong height field (256 squared is ample), scroll-driven
ripples, an analytic meniscus where the bust crosses the waterline, and bounded
outward vertex displacement on the head. The existing emergence machinery
(`src/shaders/emergence.ts`, clip plane plus root offset) already defines the
waterline; today it is a hard clip.

Internals need no change. `replaceAvatar` builds three depth layers
(`src/core/engine.ts`, occlusion mask at renderOrder 0, eyeballs and
`mouth_interior` and `eye_trim` at 1, skin at 2) and that scheme holds as long
as displacement is outward-bounded, because the mask still bounds the internals.
Internals fade out below the waterline rather than melting.

Cost: one height-field pass plus a few extra vertex ops. Risk: low.

### Tier 2: hybrid, raster head above the waterline, SDF pool below

Raymarch only the pool and the transition band, blend with the rasterised head
using a screen-space smooth minimum on depth, so submerging actually melts the
head into the pool instead of clipping it. Visemes stay exact because the head
above water is still the rig.

Needs a baked thickness volume and the waterline contour. Internals still
unchanged. Cost: one half-resolution raymarch over a small screen region.

### Tier 3: implicit head, true fluid

Position-based fluid or SPH with shape matching against the head, or a full SDF
head, surfaced by screen-space fluid rendering. This is what actually delivers
squeezing around obstacles, pinching off, migrating and re-forming.

**Internals must be baked into the field**, and voxelising a 17,520-vertex
morphing mesh per frame is not affordable. The workable form is analytic
primitives driven by the rig: eyeball spheres from the `eye_l` and `eye_r` bone
transforms unioned into the field, a mouth cavity ellipsoid subtracted with a
smooth minimum and driven from `jaw_open` plus viseme weights, and `eye_trim`
and iris rings dropped as surface detail with no meaning in a volume.

The cost is the one to weigh: 15 authored visemes collapse to roughly three
analytic mouth parameters. Full liquid and exact lip-sync pull against each
other, and lip-sync is the product. A compensating gain: in a volume the text
stops being a skin and becomes glyphs suspended inside the glass, sampled at
several depths, which reads better as a block of glass than a surface decal.

WebGPU compute only, so tier 3 must degrade to tier 1 on WebGL2.
`dec.renderer-posture` already defers "the heavy vertex surface-tension
displacement and ripple heightmap" and compute shaders, which is exactly this.

## The shared contract: the silhouette

The outline polygon is what couples the two axes. The compositor glass layer is
confined to it, the fluid produces it, and the physics uses it. It must be a
low-poly hull baked offline and projected through the head pose on the CPU each
frame. Deriving it by reading canvas alpha back per frame would stall the GPU
harder than the entire effect costs.

## Integration ladder implied by all of this

Each rung is additive and optional, and each degrades to the one below:

0. `<hologlyph-head>` alone. Live compositor glass, colour adaptation. No page
   changes. This is the drop-in product `AGENTS.md` describes.
1. `backdrop="#rrggbb"` when auto-detection cannot see the real background.
2. `refract="#hero"` naming a subtree to rasterise, or the Chromium lens path
   where available, for true per-pixel lensing.
3. `data-hologlyph-obstacle` and friends: participants the fluid collides with.

Authoring the whole page inside a WebGL scene was considered and rejected as a
direction for this library: it discards accessibility, SEO, selection, and
find-in-page, and it contradicts the drop-in web-component product. HTML-in-Canvas
softens that trade on Chromium only, and even there clicks land on the
undistorted layout box, so distorted regions cannot host interactive controls.
