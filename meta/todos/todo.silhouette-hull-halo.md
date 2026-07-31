---
node: hologlyph.runtime.shaders
status: blocked
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

## Landed tightening

`DIRECTION_COUNT` is now 32, producing 60 baked hull points and reducing the
resting convex-area ratio from 1.29x to 1.21x. In the pinned neutral compositor
comparison, the projected clip grows from 12 to 15 screen-space vertices.
`test/asset-bust.test.ts` proves the rebaked GLB stays inside the 1.5 MiB
budget and regenerates byte-for-byte from the pinned source.

## Why this remains blocked

The acceptance is an owner judgement: whether the frost edge stops reading as a
separate patch in `demo/compositor-lab.html`. The tightened crown and upper
sides track better, but the recorded comparison still has a conspicuous pale
wedge left of the jaw and shoulder. Engineering is landed; this item waits on
the owner's eye.

The convex hull is itself a floor: the bust's silhouette is not convex, so even
252 points cannot reach 1.00x. If the owner still reads a halo at 1.21x, the
recorded escalation is a concave outline, not more points on a convex hull.

## Acceptance

The frost edge tracks the head closely enough that the owner does not read it as
a separate patch, judged in `demo/compositor-lab.html`. No edge tearing while
the head moves or the page scrolls. The per-frame `clip-path` build stays inside
the 1 ms budget in `dec.liquid-glass-compositor`. Asset still under 1.5 MiB and
`test/asset-bust.test.ts` green including regen byte equality.
