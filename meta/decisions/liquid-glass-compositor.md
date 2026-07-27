---
id: dec.liquid-glass-compositor
nodes:
  - hologlyph.runtime.core
  - hologlyph.asset.loader
status: accepted
date: 2026-07-27
informed_by:
  - res.dom-backdrop-capture
  - src.dom-capture-survey-2026-07-25
---
# Compositor glass: the backdrop root is the real constraint, not Firefox

## Context

Rung 2 of the backdrop ladder (`dec.liquid-glass-architecture`, item 6) puts
genuinely live page content inside the head: a `backdrop-filter` layer behind
the transparent canvas, confined to the projected silhouette by `clip-path`.
Everything the WebGL head draws, glyphs, fresnel, specular and ink, keeps
drawing on top. It is the only rung that shows video, animation and
cross-origin images without a rasteriser, and it is the cross-browser default
the ladder was built around.

The item has been blocked since 2026-07-25 on `todo.liquid-glass-firefox-verify`,
because Mozilla bug 1579957, "backdrop-filter does not respect clip-path", is
exactly the combination the design depends on and the repository could not
photograph a Firefox to check it. Five non-interactive capture routes were
closed across two sessions and recorded in `src.dom-capture-survey-2026-07-25`.

Two facts, both established in this session, move the ground under that
blocker.

First, **the blocker's premise is stale**. Bug 1579957 is RESOLVED FIXED, last
changed 2022-05-18, and the bug it depends on, 1765525, is VERIFIED FIXED as of
2022-06-06. Both landed before Firefox 103 shipped `backdrop-filter` unflagged
in July 2022, so no Firefox that has ever shipped the property in a release
build carries the defect. The repository had been treating a four-year-closed
bug as an open risk, and a photograph of a Firefox window would have been
weaker evidence than the tracker entry that says it was fixed and verified.

Second, **there is a live constraint in the same area that nobody had looked
for, and it is much closer to home**. Filter Effects 2 has `backdrop-filter`
sample only as far back as its BACKDROP ROOT, and several ordinary properties
promote an ancestor into one. `<hologlyph-head>` renders into a shadow root
whose host carries `contain: layout paint`. If containment promoted the host,
the layer would frost an empty backdrop and show nothing at all, in every
engine, and the Firefox question would never have been the one that mattered.

`tools/smoke/backdrop-root-spike.mjs` was written to settle it, mounting the
layer inside a shadow root exactly as the element builds it, under seven
ancestor shapes, and probing screenshot pixels with the filter on and off.
Chromium 141 against real Chrome:

| ancestor shape | centre delta | corner delta | verdict |
| --- | --- | --- | --- |
| none | 13 | 0 | live backdrop, confined |
| host `contain: layout paint` | 13 | 0 | live backdrop, confined |
| host `contain: layout` | 17 | 0 | live backdrop, confined |
| host `contain: strict` | 13 | 0 | live backdrop, confined |
| ancestor `transform: translateZ(0)` | 13 | 0 | live backdrop, confined |
| ancestor `overflow: hidden` + `border-radius` | 0 | 0 | DEAD, empty backdrop |
| ancestor `opacity: 0.99` | 0 | 0 | DEAD, empty backdrop |

Containment is safe, so the shipped element needs no style change. Two ancestor
shapes are fatal, and they are host page structures the library does not own.
The `overflow: hidden` plus `border-radius` row reproduces, independently,
exactly the case Mozilla bug 1782876 comment 3 still lists as open in Firefox
133, which is corroboration that the probe measures what it claims to.

Headless WebKit reported every row dead, including the unwrapped control, so it
composites no `backdrop-filter` at all and is not evidence either way. Real
Safari 26 passed the clip-path leg of the earlier spike; the backdrop-root leg
is unverified there.

## Decision

Land rung 2 as `compositor.*` in `HeadConfig`, gated at `amount: 0` like every
other unapproved item in the programme, with four commitments.

1. **`clip-path` goes on the filter element itself and on nothing above it.**
   The layer is a bare absolutely-positioned `div` inserted as the canvas's
   immediately preceding sibling. The library authors no wrapper, so the only
   ancestors between the layer and the backdrop root are the host's own, and
   the one the library does control, `:host`, is measured safe.

2. **Dangerous ancestors are detected and reported, never worked around.**
   On build, the module walks from the canvas to the document root once and
   warns with the offending element when it finds `opacity < 1`, a clipping
   `overflow` combined with a rounded corner, or a `filter` / `backdrop-filter`
   / `mask` that promotes a backdrop root. It still installs the layer. A page
   that wraps the head in a rounded card gets a diagnosis instead of a silent
   nothing, which is the difference between a five-minute fix and a bug report.

3. **`todo.liquid-glass-firefox-verify` is closed on the tracker evidence, not
   deferred again.** Firefox is treated as a supported engine for this feature.
   The photograph that could not be taken would have shown a fixed bug not
   reproducing, and `CSS.supports` remains the only gate: an engine without
   `backdrop-filter` installs no layer and keeps the shipped flat-colour
   adaptation, unchanged.

4. **The silhouette is clipped at the waterline in 3D, inside the projector.**
   `SilhouetteProjector.update` takes an optional world-space floor and clamps
   each hull point up onto it before projecting, rather than intersecting the
   2D polygon against the plane's vanishing line.

## Rationale

On (1), the alternative was a wrapper element owning the clip so the layer
could stay a plain rectangle. The spike says a wrapper is precisely what breaks
it: two of the three fatal shapes are wrappers. Authoring none is both simpler
and the only measured-safe option.

On (2), the choice was between silently degrading, refusing to install, and
installing with a diagnosis. Silent degradation is what makes this class of bug
expensive, because the symptom is "nothing happened" with no error anywhere.
Refusing to install would be the library overruling a host that may have good
reasons for its layout, and would also be wrong in Chromium the day Blink stops
promoting on rounded overflow. Warning and installing keeps the host in charge
and matches the degrade-don't-throw convention.

On (3), the honest options were to keep the item blocked on a photograph, or to
act on the tracker. Keeping it blocked would have cost the programme its last
unblocked engineering item in service of re-verifying a bug that Mozilla closed
and verified in 2022, on a host that has already spent two sessions failing to
photograph a browser and cannot produce GPU-path evidence even if it succeeded.
The tracker entry is the stronger evidence, and it is reproducible by anyone.

On (4), clipping in 2D means intersecting the polygon with the vanishing line
of the world plane, which is exact but needs a homogeneous line construction
and a side test, and it is the kind of code that is correct until the camera
tilts. Clamping in 3D is four lines: the hull is contractually an OUTER bound
on the body, and a point moved up onto the floor still outer-bounds the clipped
body at the same x and z, so the invariant that makes the hull usable at all is
preserved by construction. It costs one extra matrix multiply per point, which
at 32 points is not measurable.

## Consequences

The programme gains a sixth gated feature and a sixth lab, and the owner look
session (`todo.liquid-glass-owner-look-session`) gains an entry. Nothing turns
on by default: at `compositor.amount: 0` no element is created, no ancestor is
walked and no `clip-path` string is ever built.

`SilhouetteProjector.update` grows an optional third mode of failure-free
behaviour rather than a new one: passing no floor is byte-identical to today.

The library now writes one DOM node into the host's canvas parent. That is new,
and it is the first time anything outside `<hologlyph-head>` authors an element
in the host page. It is confined to `compositor.amount > 0`, removed on
dispose, and marked `pointer-events: none` so it can never intercept a click.
The canvas's parent must be a positioned containing block for `inset: 0` to
mean the canvas box; `:host` already is, and a bare-canvas host that is not
gets a warning.

Firefox moves from unverified to supported for this rung on tracker evidence.
If a real Firefox ever does leak the frost outside the clip, the fallback named
in `todo.liquid-glass-firefox-verify`, a static rounded-blob clip or dropping
to rung 1, is still available and is now a one-line change to the clip source
rather than an architecture question.

Two ancestor shapes remain fatal and the library cannot fix them from inside.
That is a documented host contract, not a defect to engineer around, and the
warning is what makes it discoverable.
