# Proposal: liquid-glass-silhouette-hull

Implements `meta/todos/todo.liquid-glass-silhouette-hull.md`, item 2 of the
recommended order in `dec.liquid-glass-architecture`.

## Motivation

Rung 2 of the backdrop ladder is a `backdrop-filter` layer confined to the head
shape, and rung 4 is a set of page elements the fluid collides with. Both need
the head's screen-space outline every frame, and `clip-path` needs it as a
polygon.

There is no cheap way to ask the GPU. Deriving the outline from canvas alpha
means a readback per frame, which stalls the pipeline and costs more than the
entire effect. The decision therefore names the hull the shared contract
between the backdrop ladder and the shape stages: baked offline, projected on
the CPU per frame, never read back.

Nothing consumes it yet. It lands first because items 6 and 7 are blocked on it
and because a later metaball or fluid surface emits the same outline, so the
consumer side of the contract survives tier 3 unchanged.

## Scope

- An offline hull bake in `tools/asset-pipeline/`, written into the shipped GLB
  and covered by the existing regenerate-from-source byte-equality test.
- A `SilhouetteHull` contract, read off the loaded scene and exposed on
  `LoadedAvatar`.
- A CPU projector that turns the baked points into a screen-space convex
  polygon and a CSS `clip-path` value, with no per-frame buffer allocation.
- An acceptance oracle that skins and morphs every shipped vertex and requires
  it inside the emitted polygon, at every pose the engine can drive.

## Out of scope

- Any consumer. No CSS layer, no `clip-path` written to any element, no new
  host-facing surface: `dec.liquid-glass-architecture` states that items 1 to 4
  need none, and the projector is tree-shaken out of the bundle until item 6
  imports it.
- Tightening the outline below the 20 to 40 point budget the todo sets. The
  cost of that budget is measured and recorded, and the polygon is a strict
  outer bound at every pose, but it is 27 to 41 per cent larger in area than
  the silhouette's own convex hull. See the implementation notes.
- Clipping the outline at the waterline during emergence. Containment still
  holds, because clipping only removes fragments; the hull is simply not tight
  below the surface, which is where the pool covers it.
