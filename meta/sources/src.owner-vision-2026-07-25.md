---
id: src.owner-vision-2026-07-25
file: ./meta/sources/src.owner-vision-2026-07-25.md
type: owner direction
verification: unverified
date: 2026-07-25
---

# What hologlyph is for, in the owner's terms

Assembled from owner direction given across the shading, backdrop, and liquid
glass sessions. This is the artefact decisions are adjudicated against; it
records intent, not implementation.

## The two criteria

Stated 2026-07-25, and they override technical optimisation when they conflict:

1. It must look great.
2. It must feel authentic.

## The thing itself

A talking head, made of text and glass, that belongs to the page it is on.

Three properties, none of which is decoration on top of the others:

**The text is the skin.** Not a texture painted on a face. The face is made of
glyphs, welded to the surface in bind space so they stay put as the head moves
and speaks, shaded by the part of the face they sit on, with density and
brightness varying by feature zone. Eyes get their own text; the iris is made of
text. Scroll is a property of the material.

**It is glass, not video.** Translucent, refractive, with real thickness, so it
reads as a physical block of material resting on the page rather than a
rectangle of rendered pixels. It must hold up on any host background: dark,
light, mid-tone, branded. The owner's framing is a full block of liquid glass,
not a shell.

**It is alive, not a statue.** Base-level idle motion so it never freezes, gaze
that follows the pointer, blinks and nods, real speech with real lip-sync, and
behaviour states that drive the look as well as the motion.

## The escalation: part of the page, not on top of it

The owner's ambition beyond a well-rendered bust:

- The bust base is not a cut-off. It is a pool the head rises out of, with
  surface tension where the two meet.
- The pool ripples, and scrolling drives the ripples.
- The head can squeeze past and around elements on the page as the reader
  scrolls.
- It can submerge back into the pool, the pool can migrate, and the head can
  re-emerge somewhere else.

Asked directly whether the whole page should be built inside this effect, the
owner raised it as an option to weigh, not a preference. The answer recorded in
`dec.liquid-glass-architecture` is no for the library: it would trade away
accessibility, SEO, text selection, and find-in-page, and turn a drop-in
component into a page framework. A showcase site may do it later.

## The constraint the owner keeps returning to

It has to stay easy to adopt. Asked what happens when the head goes on
reaveshq.com, the owner's concern was whether other people would need extra
integration steps to use it. The answer that satisfies both that and the
ambition above is a ladder: one tag works everywhere, and each further
capability is an optional attribute on markup the host already owns.

## The correction the owner made

Told that full fluidity would cost lip-sync accuracy, the owner rejected the
premise: the head should still be the head, with fluidity turned up and down.

That turned out to be correct and is now the architecture. Viseme morphs are
applied before any displacement node in the vertex pipeline, so fluidity is a
parameter over an already-correct face, and can be masked per zone so the base
flows while the mouth stays crisp. See `dec.liquid-glass-architecture`.

## Known open questions

- Whether the head should ever be allowed to lose its head shape entirely
  (topology-changing fluid), which is the only stage that costs mouth accuracy.
- Day/night and background-adaptive theming beyond the shipped colour
  adaptation: prototyped in the lab, deliberately not in the library.
- Opaque core plus translucent text shell: an owner idea from 2026-07-21, still
  lab-only. The fresnel edge thickening shipped on 2026-07-25 solved the
  grazing-angle see-through it was meant to address.
