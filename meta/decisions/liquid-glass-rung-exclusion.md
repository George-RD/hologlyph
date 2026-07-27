---
id: dec.liquid-glass-rung-exclusion
nodes:
  - hologlyph.runtime.core
status: accepted
date: 2026-07-27
informed_by:
  - res.liquid-glass-direction
  - src.owner-vision-2026-07-25
---
# One rung at a time: the lens stands the compositor layer down

## Context

`dec.liquid-glass-architecture` describes the backdrop as a ladder. Rung 2 is
the compositor layer: a `backdrop-filter` div behind the canvas, clipped every
frame to the projected silhouette hull, showing the live page frosted. Rung 3
is the lens: a named subtree rasterised (or, on Chromium, uploaded live) into a
texture the interior glass pass samples with a per-pixel displacement, so the
page behind the head actually bends.

Both rungs answer the same question, "what is behind the glass". Each shipped
alone, each gated off, and each was judged alone. Nothing ever said what a page
that turns both on should see, and the ladder listed it as unfinished business:
"nothing stops a host doing both and the result is currently undefined by
anything except the draw order".

Draw order is a poor answer, and it is not even a stable one.

The lens raises the interior pass's alpha from its own `a` to `a + (1 - a) * w`
for lens amount `w` (`src/shaders/materials.ts`). At `w = 1` the head is opaque
and the frost behind it is invisible, but the layer is still in the tree, still
being clipped to a fresh `clip-path` string every frame the head moves, and
still costing the compositor a backdrop capture on every scroll. The host pays
rung 2 in full and sees none of it.

Between 0 and 1 it is worse than wasteful. The frost shows through in
proportion to `1 - w`, so the page appears twice at once: once blurred, tinted
and exactly aligned behind the canvas box, and once sharp, displaced by the
surface normal, and cropped to whatever subtree the host named. Two copies of
the same content at two different offsets is the definition of a double image.
It does not read as depth. It reads as a bug.

A third thing decided the shape of the rule. The lens is asynchronous. A
rasterised snapshot costs 10 to 150 ms of main thread and arrives after mount;
`binding` is null until it lands and null again if the rasteriser fails or the
optional peer is missing. So "is the lens on" is not a configuration question,
and answering it from configuration alone would leave a page with a broken
rasteriser showing neither rung.

## Decision

The rungs are mutually exclusive at any one head, the higher one wins, and the
test is contribution rather than intent.

The engine suppresses the compositor layer exactly while the lens is
contributing pixels. Three terms, all of which must hold: the glass layering
is active, `LensSource.binding` is non-null, and `lens.amount` is above zero.
Suppression is the same path as `compositor.amount: 0`, so the layer is
removed from the DOM rather than hidden, no `clip-path` string is built, and
the hull is not projected. When the lens stops contributing, for any reason,
the layer is rebuilt on the next frame.

The glass term is the one that is easy to miss, and it was missed on the first
pass. The lens substitutes on the INTERIOR wall, the only pass deep enough to
replace what is behind the head, and `applyGlassLayering` sets
`interiorMesh.visible = false` outright at `skin.glass.amount: 0`, or on a rig
with no body mesh to clone. So a bound texture with the glass off paints
nothing at all, exactly as `HeadLensConfig` already documented, and standing
rung 2 down for it leaves the head showing neither rung. The engine reads
`glassLayeringActive`, the flag `applyGlassLayering` set earlier in the same
frame, rather than re-deriving the condition, so the two cannot drift.

`applyCompositorGlass` therefore moves after the lens sync in the frame loop.
Both `createPageLens` and `createElementLens` publish `binding` from inside
`sync()`, so reading it before that call would gate this frame's layer on last
frame's lens.

## Rationale

Contribution, not intent, because that is what makes the ladder degrade the way
the ladder is supposed to degrade. `dec.liquid-glass-architecture` already
holds that the Chromium lens "must never be load-bearing" and that its absence
is the normal case. The same discipline one rung down means a host that names a
subtree, on an engine where the rasteriser will not load, keeps the frost it
would have had. Gating on `lensSource !== null` instead would take rung 2 away
on the strength of an intention that never produced a pixel, and leave a
browser that cannot do either rung showing the bare drop-in look.

The price is one visible transition at mount: the frost draws, the snapshot
resolves a hundred milliseconds later, the frost is removed and the lens takes
over. That is one step in the right direction, from a blurred page to a
refracted one, and it is strictly better than the alternative failure, which is
a page that never gets frost because a capture it was never told about did not
happen.

The higher rung wins rather than the lower because the host had to ask for it.
Rung 2 is free and needs no host contract; rung 3 costs a named subtree, an
optional peer, and a periodic main-thread capture. A host that paid that did
not pay it to be composited behind a blur.

Exclusive rather than blended, because there is no blend that means anything.
The two rungs do not decompose into layers of one image: the frost is aligned
with the canvas box and the lens is displaced by the surface normal, so any mix
of them is the same content at two offsets. There is no weight at which that
reads as one surface.

Suppression removes the layer rather than hiding it for the reason the amount
gate already removes it: an invisible `backdrop-filter` element still costs the
compositor a backdrop capture on every scroll, which is the expensive half of
the feature.

## Consequences

- `compositor.amount` is no longer the only thing that decides whether the
  layer exists. Reading the config back does not tell a host what is on screen,
  and the documented rule is now "the compositor layer shows unless the lens is
  showing".
- A host that wants the frost while a lens is bound has one lever: set
  `lens.amount` to 0. The lens then keeps its texture and its capture schedule,
  and costs a rasterisation nobody looks at, so the honest way to do it is
  `setLensSource(null)`.
- The transition at mount, frost then lens, is real and visible on a page that
  enables both. It is one frame, in the direction of more fidelity, and it is
  what the owner look session should judge rather than a mid-sentence swap.
- Every other pair in the programme stays independent. The pool, the interior
  glyphs, the fluid and the stage participants all shade the same surface and
  compose additively; only these two rungs answer the same question twice.
- The owner look session (`todo.liquid-glass-owner-look-session`) now has one
  fewer variable: rung 2 and rung 3 are judged as alternatives, never as a
  blend, which is how its table already framed them.
