# Proposal: 2026-07-26-liquid-glass-solid-body

Implements `meta/todos/todo.liquid-glass-solid-body.md`, item 1 of the
recommended order in `dec.liquid-glass-architecture`.

## Motivation

The head reads as a translucent shell, not a block of glass. Two cues are
missing, and both are cheap:

- you never see the inside of the far surface through the near one, so there is
  no interior to the body;
- every part of the surface occludes the page behind it equally, so a thick
  cranium and a thin nose tip look like the same material.

This is the largest look gain per unit of cost in the liquid-glass backlog and
it is independent of every backdrop question, which is why the decision puts it
first.

## Scope

- A per-vertex body thickness mask, ray-baked at avatar load beside the
  existing feature masks.
- Beer-Lambert absorption on the front surface, keyed on that thickness.
- A back-facing interior pass drawn behind the occlusion mask, tinted by the
  same absorption.
- The draw-order change the interior pass needs, and its teardown.

## Out of scope

- Chromatic split at the silhouette (item 3 of the todo). It spends blend-zone
  ghosting headroom for a subtle gain; revisit only if the metric proves it is
  free.
- Interior glyphs drifting inside the glass. That is
  `todo.liquid-glass-interior-glyphs`, which this change unblocks.
- Any host-facing configuration surface. `dec.liquid-glass-architecture` states
  that items 1 to 4 need no new public surface, so the absorption strength and
  the interior weighting are internal constants gated by the existing
  `skin.glass.amount`.
