---
node: hologlyph.runtime.shaders
status: open
created: 2026-07-27
---

# The silhouette hull is too loose, and the compositor frost shows it

Surfaced by the owner look session, 2026-07-27
(`src.owner-look-2026-07-27`), judging `demo/compositor-lab.html`:

> "its just a weird patch behind the head? though i do see objects on the page
> through the head, so thats working well"

The frosted page content works. The shape it is clipped to does not.

## The cause

Already measured and recorded in `todo.liquid-glass-live-css-layer` and in
`meta/changes/archive/*-liquid-glass-silhouette-hull/implementation-notes.md`.
The 20 to 40 point budget makes the projected polygon 27 to 41 per cent larger
in area than the silhouette's own convex hull. That surplus is the halo the
owner saw: a band of frost outside the head, aligned to nothing, which is why it
reads as a patch behind the head rather than as the head.

## The fix

`DIRECTION_COUNT` in `tools/asset-pipeline/silhouette-hull.ts:51` is currently
18. Raising it tightens the polygon on a known curve, measured in that same
implementation-notes: 60 points for 1.21x, 252 for 1.05x.

Two things this is gated on, and neither is optional:

1. A decision superseding the point budget in
   `todo.liquid-glass-silhouette-hull`. That budget was chosen against a
   per-frame `clip-path` cost, so raising it is an accepted trade, not an
   oversight to correct silently.
2. An asset rebake. The hull is baked into the GLB, so this moves the shipped
   asset and its hash, and `test/asset-bust.test.ts` guards regen-from-source
   byte equality and the 1.5 MiB budget.

Note that the convex hull is itself a floor: the bust's silhouette is not
convex, so even 252 points cannot reach 1.00x. If 1.05x still reads as a halo,
the answer is a concave outline rather than more points on a convex one, which
is a larger change.

## Acceptance

The frost edge tracks the head closely enough that the owner does not read it as
a separate patch, judged in `demo/compositor-lab.html`. No edge tearing while
the head moves or the page scrolls. The per-frame `clip-path` build stays inside
the 1 ms budget in `dec.liquid-glass-compositor`. Asset still under 1.5 MiB and
`test/asset-bust.test.ts` green including regen byte equality.
