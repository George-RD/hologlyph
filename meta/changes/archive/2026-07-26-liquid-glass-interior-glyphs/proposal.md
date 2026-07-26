# Proposal: liquid-glass-interior-glyphs

## Motivation

Item 10 of `dec.liquid-glass-architecture`, and the last one in the queue.

Item 1 made the head a solid block: a per-vertex thickness bake (`aThickness`)
and a back-facing interior wall at `renderOrder -1`. The block is convincing
from the outside and empty on the inside. Every glyph the head carries sits on
its surface, so the head reads as text painted onto glass rather than as glass
full of text.

Owner direction, 2026-07-25: scatter a few glyphs inside the head, suspended
between the near and far surfaces, and let them move as though they were
floating in fluid. Moving or shaking the head should drag them off course and
they should settle again afterwards.

## Scope

- A sparse field of camera-facing glyph sprites suspended in the interior
  volume, sampled from the thickness field so they gather where the body is
  thick and avoid the nose, the ears and the chin.
- Sprites sample cells of the existing text-skin canvas, so no new asset, no
  new atlas and no second texture upload.
- Motion: a spring-damper per glyph chasing a target carried by the head's own
  frame. Head movement drags them, and they settle when it stops.
- A slow drift on top so they never look frozen while the head is still.
- Depth dimming and back-to-front sorting inside the interior pass, so nearer
  glyphs occlude farther ones and the field reads as depth.
- `interior.count: 0` is the shipped default and a hard gate: nothing is
  sampled, nothing is allocated, nothing is drawn.
- Lab page `demo/interior-glyph-lab.html` with count, drift and inertia
  sliders, and smoke script `tools/smoke/interior-glyph-shot.mjs`.

## Out of scope

- Any change to the surface text skin, the visemes or the approved look.
  `bun run eval` must stay at its baseline, and it does.
- Any new public element attribute. The field is reached through
  `engine.vfx.setHeadConfig({ interior: ... })`, as the pool is.
- A fluid solver. Item 8 (`todo.liquid-glass-fluidity-driver`) may later drive
  the same positions from a velocity field; this must not depend on it, and
  does not.
- Turning the field on by default. That is an owner judgement, and this change
  exists to put something in front of the owner to judge.
