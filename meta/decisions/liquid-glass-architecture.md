---
id: dec.liquid-glass-architecture
nodes:
  - hologlyph.runtime.shaders
  - hologlyph.runtime.renderer
  - hologlyph.runtime.core
status: proposed
date: 2026-07-25
informed_by:
  - res.liquid-glass-direction
  - res.dom-backdrop-capture
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

Shape fidelity is staged, and the stages are gated on the previous one being
approved in the lab:

- Tier 1, surface fluid over the existing rig: pool height field, scroll
  ripples, meniscus at the waterline, outward-bounded displacement. Internals
  unchanged, visemes exact.
- Tier 2, hybrid: raymarched pool below the waterline blended with the
  rasterised head above it.
- Tier 3, implicit head with true fluid: WebGPU compute only, degrading to
  tier 1 elsewhere, and requiring internals to be rebuilt as rig-driven
  analytic primitives.

The silhouette hull is the shared contract between the backdrop ladder and the
shape stages: baked offline, projected on the CPU per frame, never read back
from the GPU.

Rejected: authoring the host page inside a WebGL scene. It discards
accessibility, SEO, text selection, and find-in-page, and it replaces the
drop-in product with a page framework. A showcase site may consume the engine
that way later; the library will not assume it.

## Recommended order

Cairn orders open todos alphabetically, which is not the intended sequence.
The recommended order, and why each step sits where it does:

1. `todo.liquid-glass-solid-body` - largest look gain per unit of cost, one
   extra draw call, independent of every backdrop question. Start here.
2. `todo.liquid-glass-silhouette-hull` - the shared contract. Everything from
   rung 2 upward is blocked on it.
3. `todo.liquid-glass-tier1-pool` - the owner-facing payoff: a head emerging
   from a rippling pool. Lab only until approved.
4. `todo.liquid-glass-live-css-layer` - live page content inside the head,
   cross-browser. Needs step 2, and needs
   `todo.liquid-glass-firefox-verify` resolved before it lands in `src/`.
5. `todo.liquid-glass-snapshot-lens` - opt-in true lensing everywhere.
6. `todo.liquid-glass-stage-participants` - the fluid starts touching the page.
7. `todo.liquid-glass-chromium-lens` - enhancement only, never load-bearing.
8. `todo.liquid-glass-tier3-implicit` - gated on an explicit owner decision
   about trading viseme fidelity for full fluid behaviour.

Steps 1 to 3 need no host-facing contract and no new public surface, so they
can proceed without committing to any of the integration rungs.

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

Tier 3 is deliberately last and deliberately flagged: collapsing 15 authored
visemes into roughly three analytic mouth parameters trades away the feature the
library is named for. That trade needs owner sign-off on a lab prototype, not an
engineering decision taken quietly on the way to a nicer pool.

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
- `dec.renderer-posture` deferred surface tension and compute shaders to a later
  phase. Tier 1 opens that phase; tiers 2 and 3 will need it amended.
