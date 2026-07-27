---
id: dec.liquid-glass-architecture
nodes:
  - hologlyph.runtime.shaders
  - hologlyph.runtime.renderer
  - hologlyph.runtime.core
status: accepted
date: 2026-07-25
informed_by:
  - res.liquid-glass-direction
  - res.dom-backdrop-capture
  - src.owner-vision-2026-07-25
---
# Liquid glass: layered backdrop, staged fluid, drop-in preserved

## Context

The owner wants the head to read as a block of liquid glass that belongs to the
host page, and eventually to behave as a fluid: a pool at the bust base with
surface tension, ripples driven by scroll, the head emerging from and
submerging into that pool, squeezing around page elements.

Two constraints are settled and measured, not assumed.

No browser API returns rendered page pixels to script without a user permission
prompt. The compositor can show live page content inside an arbitrary shape via
`backdrop-filter` confined by `clip-path`, verified in Chrome and real Safari at
0.44 to 0.59 ms per frame, but script never touches those pixels. Chromium's
HTML-in-Canvas puts live DOM in a GPU texture at vsync, but only for immediate
children of the canvas being drawn into, and it silently drops cross-origin
images and iframes, and clicks land on the undistorted layout box.

Separately, `AGENTS.md` and `dec.api-emphasis` define this library as a drop-in
web component with framework wrappers, zero peer dependencies, and a small
bundle. Anything that requires the host to hand us their page is a different
product.

## Decision

Backdrop fidelity is a capability ladder, not a choice. Each rung degrades to
the one below with no host changes and no errors:

1. Flat colour, auto-detected from the host element. Shipped
   (`dec.glass-backdrop-adaptive`).
2. Live compositor glass: a `backdrop-filter` layer confined to the head
   silhouette. Cross-browser default for the liquid look. Frost and tint only,
   no lensing.
3. True per-pixel lensing, opt-in: either a rasterised subtree the host names,
   or the Chromium HTML-in-Canvas path where the capability is detected.
4. Physics participants the host declares, which the pool and head collide with.

Two guiding criteria decide shape, in the owner's words: it must look great and
it must feel authentic. Those are not in tension, because **fluidity is a
continuous parameter applied to the rig, not a replacement for it.** The head
stays the head; how molten it behaves is turned up and down.

This is a property of the vertex pipeline, not a workaround. In three's node
material, `setupPosition` runs morph targets, then skinning, then any
`positionNode`. Viseme morphs are therefore baked into `positionLocal` before a
fluid offset ever reads it, so `positionNode = positionLocal.add(offset.mul(f))`
deforms an already-correct face. At `f = 0` the result is today's rig exactly;
at `f = 1` it is maximally molten; the mouth shape is upstream of the knob at
every value.

`f` is a field, not one number. Weight it by the same baked masks that already
drive the per-zone opacity in `buildLoadedAvatar`, so the base and neck can flow
while the mouth and eyes stay crisp, in the same frame. Behaviour state, scroll
velocity, emergence, and `HeadConfig` all just write to it.

Shape fidelity is therefore staged as:

- Tier 1, surface fluid: pool height field, scroll ripples, meniscus at the
  waterline, small outward-bounded displacement. Internals unchanged.
- Tier 2, hybrid: raymarched pool below the waterline blended with the
  rasterised head above it, so submerging melts instead of clipping.
- Tier 3, fluid as driver: a simulation, shape-matched to the rig, writes the
  displacement field behind that fluidity knob. Real sag, wobble, surface
  tension, squeeze against page obstacles, flow at the base. Fixed topology, so
  internals and the three-layer depth scheme survive untouched, and visemes
  stay exact at any fluidity.
- Tier 4, fluid as surface: a surfaced particle field that can change topology,
  which is the only thing tier 3 cannot do. Droplets pinching off, merging,
  collapsing into a puddle, squeezing through a gap narrower than the skull.

Only tier 4 costs mouth accuracy, and only because a surfaced field has to
describe the mouth with analytic primitives rather than 15 authored morphs, and
because screen-space surfacing blurs detail below the kernel radius. That cost
is acceptable precisely where it is incurred: tier 4 is entered when the shape
is no longer a head, and a puddle has no visemes to get wrong.

The tier 3 to tier 4 handover is the seam to watch. It happens at extreme
deformation, where the silhouette is already unrecognisable and heavily
refracted, which is a far more forgiving place to swap representations than
mid-conversation. Re-forming must complete before `speaking` renders visemes,
and if the handover cannot be hidden in the lab, tier 4 stays confined to full
submersion, where the pool covers it.

The silhouette hull is the shared contract between the backdrop ladder and the
shape stages: baked offline, projected on the CPU per frame, never read back
from the GPU.

Rejected: authoring the host page inside a WebGL scene. It discards
accessibility, SEO, text selection, and find-in-page, and it replaces the
drop-in product with a page framework. A showcase site may consume the engine
that way later; the library will not assume it.

## Recommended order

Cairn orders open todos alphabetically, which is not the intended sequence, so
each todo carries an `Order N` line matching this list. Read the order here,
not from `cairn brief`. Items 1 to 5 were `status: open` and mutually
independent; the rest are `status: blocked` until their prerequisite lands.

Landed so far: item 1 (2026-07-26), item 2 (2026-07-26), item 3 (2026-07-26),
item 4 (2026-07-26), item 5 (2026-07-26), item 6 (2026-07-27), item 7
(2026-07-27), item 8 (2026-07-27), item 10 (2026-07-26).

**Next unit of work, in order of how actionable it is right now.** As of
2026-07-27, with item 6 landed, item 9 is the only engineering item left in the
programme and it is gated on a product call. Read this list, not `cairn brief`.

1. **An owner look session** over the six labs that now ship gated off:
   `demo/pool-lab.html`, `demo/lens-lab.html` (with `demo/live-lens-lab.html`
   as its Chromium half, judged as one ruling), `demo/interior-glyph-lab.html`,
   `demo/fluid-lab.html`, `demo/stage-lab.html` and
   `demo/compositor-lab.html`. Nothing in the programme turns on by default
   until these are approved, and the whole point of shipping every feature at
   zero was to make this one session the gate. This is the highest-value thing
   that can happen next, and it needs the owner, not an agent. Tracked as
   `todo.liquid-glass-owner-look-session`.
2. **Item 9, `todo.liquid-glass-topology-fluid`**, is unblocked in principle
   now that item 8 has landed, but it is the one stage that gives up authored
   visemes and may never be entered. It is a product call about whether the
   head is ever allowed to stop being a head, so do not start it without an
   explicit owner decision superseding the "possibly never" clause above.
3. **Rung 2 and rung 3 in the same page.** Naming a lens source makes the head
   opaque, which would hide the compositor frost behind it. Nothing stops a
   host doing both and the result is currently undefined by anything except the
   draw order. Small, real, and nobody has looked at it.

1. `todo.liquid-glass-solid-body` - LANDED 2026-07-26. Largest look gain per
   unit of cost, one extra draw call, independent of every backdrop question.
2. `todo.liquid-glass-silhouette-hull` - LANDED 2026-07-26. The shared
   contract. The compositor glass layer and the physics participants both need
   it. The lens rungs do not: they are WebGL texture sources and never touch
   `clip-path`.
3. `todo.liquid-glass-tier1-pool` - LANDED 2026-07-26. The owner-facing
   payoff: a head emerging from a rippling pool. Shipped gated at
   `pool.amount: 0` and lab-only until the look is approved.
4. `todo.liquid-glass-snapshot-lens` - LANDED 2026-07-26. Opt-in true lensing
   on every engine: `refract="#hero"` binds a rasterised snapshot the interior
   glass pass samples displaced by the view normal and the baked thickness.
5. `todo.liquid-glass-chromium-lens` - LANDED 2026-07-26. Enhancement only,
   never load-bearing: where `drawElementImage` and `texElementImage2D` are
   both present AND the named subtree is an immediate child of a
   `<canvas layoutsubtree>`, `refract` uploads live DOM every frame instead of
   a snapshot. Either gate missing, and on every other engine, the snapshot
   lens is built exactly as before.
6. `todo.liquid-glass-live-css-layer` - LANDED 2026-07-27. Live page content
   inside the head, cross-browser: `compositor.*` puts a `backdrop-filter`
   layer behind the canvas, clipped every frame to the hull from item 2.
   `todo.liquid-glass-firefox-verify` was closed on tracker evidence rather
   than answered, and the constraint that actually shaped the module was the
   backdrop root, which nothing in this decision had anticipated
   (`dec.liquid-glass-compositor`). Shipped gated at `compositor.amount: 0`
   and lab-only.
7. `todo.liquid-glass-stage-participants` - LANDED 2026-07-27. The fluid starts
   touching the page: `data-hologlyph-obstacle` and `data-hologlyph-body`
   markers become colliders, and `FLUID_MODES` grew from one global mode to a
   four-mode basis so two obstacles on opposite sides do not cancel
   (`dec.liquid-glass-participants`). Gated by the markers themselves, so a
   page that marks nothing installs no observer and reads no rect.
8. `todo.liquid-glass-fluidity-driver` - the fluidity knob and the simulation
   that writes it. Needs item 3. No viseme cost, so no owner gate beyond the
   usual lab approval.
   Landed 2026-07-27. The simulation is a damped modal solver integrated on
   the CPU rather than a WebGPU compute pass; `dec.liquid-glass-fluidity`
   supersedes the compute clause for this tier only and records the price.
   Shipped gated at `fluid.amount: 0` and lab-only.
9. `todo.liquid-glass-topology-fluid` - the only stage that gives up authored
   visemes, and only where there is no face. Possibly never.
10. `todo.liquid-glass-interior-glyphs` - LANDED 2026-07-26. Sparse glyphs
    suspended between the near and far surfaces, dragged off course when the
    head moves and settling afterwards. Shipped gated at `interior.count: 0`
    and lab-only until the look is approved.

Items 1 to 4 need no host-facing contract and no new public surface, so they can
proceed without committing to any of the integration rungs.

## Rationale

The ladder exists because fidelity and reach are genuinely opposed here, and no
single mechanism wins. The compositor path is the only one that is live,
cross-browser, and free, so it is the default. Snapshotting is the only one that
lenses on every engine, so it is the opt-in. HTML-in-Canvas is the only one that
is both live and lensing, so it is the enhancement, and it is confined to a
capability check because it is Chromium-only, flag or trial gated, and loses
cross-origin content silently.

Tier 1 first because it is the largest perceptual jump per unit of risk: it
needs no asset change, no contract change, and no compute shaders, and it can be
judged in the lab before anything lands in `src/`.

Tier 3 sits late because it needs a simulation and WebGPU compute, not because
it endangers the face. Tier 4 sits last and stays flagged: it is the only stage
that gives up authored visemes, and it may never be worth entering outside full
submersion.

## Consequences

- Two rendering paths exist for the glass body: a CSS layer and the WebGL
  material. They must agree on the silhouette every frame, which makes the hull
  bake a dependency of the liquid look rather than an optimisation.
- The Chromium lens path must never be load-bearing. A capability check gates
  it, and its absence is the normal case.
- Firefox is unverified for the compositor path. The Playwright build will not
  start on this host, so it needs checking on a real machine before rung 2 is
  called cross-browser.
- Blend-zone ghosting has 0.078 of headroom (0.69 against a 0.768 cutoff) and
  every added distortion spends it. Tier 1 and rung 3 both need the eval rerun.
- Displacing `positionNode` does not update normals. `normalLocal` still derives
  from the undeformed attribute, so a wobble with rig normals reads as texture
  swim rather than as liquid. Shading and fresnel normals must be derived from
  the gradient of the same offset field, or from screen-space derivatives of the
  deformed world position. In `src/shaders/materials.ts` that means `normalWorld`
  in the matte shade term and `normalView` in the rim must follow the
  deformation, while `bindNormal`, which is `normalGeometry` and drives the
  triplanar glyph projection, must deliberately not: the glyphs stay anchored to
  the bind pose, which is the approved look, so the surface can flow while the
  text stays welded to the skin.
- `dec.renderer-posture` deferred surface tension and compute shaders to a later
  phase. Tier 1 opens that phase; tiers 3 and 4 will need it amended.
