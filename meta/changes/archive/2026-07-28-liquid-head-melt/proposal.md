# Proposal: liquid-head-melt

## Motivation

The owner ran the look session over the six gated liquid-glass labs on
2026-07-27 and ruled against most of it. The pool is cut. Tier 3 fluid reads as
"just a gravity effect" where "it all bulges". The stage participants are "a bit
weird" and "doesnt hit the mark". The compositor frost is "a weird patch behind
the head". Interior glyphs stay but leak out of the body at high drift. Of the
two backdrop rungs the lens is preferred.

What the owner actually asked for is different from all of it:

> "I want to be able to morph the whole head, from a flat puddle, up into the
> head. And i want to be bale to make the head squeeze and move between things."

Three things follow. The rulings have to be recorded before anything is built on
them by accident. The feature-shading port into `src/` has never been checked by
eye against the hand-rolled page it came from, and the owner asked for that
comparison. And the liquid direction needs a spike that answers the ask rather
than the one that missed.

## Scope

- `src.owner-look-2026-07-27`: the rulings, verbatim, as a source artefact.
- `dec.liquid-glass-melt`: the liquid direction is a vertex melt on the real
  bust, not a surfaced particle field, with an escalation criterion that says
  when that call is wrong.
- Demote the todos that missed; open todos for the two defects the session
  surfaced (`todo.interior-glyph-containment`, `todo.silhouette-hull-halo`).
- `demo/compare-lab.html`: the old hand-rolled head beside the library head.
- A `melt` feature: `src/shaders/melt.ts` plus contracts, uniforms and the
  material composition, gated at `melt.amount: 0` where it is an exact identity.
- `demo/melt-lab.html`: the real bust collapsing to a puddle and rising back,
  judged with the real glass and glyphs.

## Out of scope

- The squeeze. It is the melt driven by the stage colliders and is built only
  once the melt is approved, because building it on an unapproved melt repeats
  the mistake that produced tier 3.
- Deleting the pool, fluid or stage code. `poolRadialProfile` is load bearing
  for the melt, and the collider plumbing is what the squeeze reuses.
- Any change to a shipped default. Every gated feature stays at 0 and
  `bun run eval` must pass against the existing baseline unrecalibrated.
- The particle field in `todo.liquid-glass-topology-fluid`. It stays the answer
  if the escalation criterion fires, and it is a separate change with its own
  decision artefact.
