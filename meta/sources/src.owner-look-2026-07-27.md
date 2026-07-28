---
id: src.owner-look-2026-07-27
file: ./meta/sources/src.owner-look-2026-07-27.md
type: owner direction
verification: unverified
date: 2026-07-27
---

# The owner look session over the gated liquid-glass labs

The session `todo.liquid-glass-owner-look-session` asked for. Six features
shipped between 2026-07-26 and 2026-07-27, every one gated to zero and reachable
only from a lab page, walked in one sitting against the two criteria in
`dec.liquid-glass-architecture`: it must look great, and it must feel authentic.

Most of it was ruled against. The owner's words are quoted verbatim below
because later decisions are adjudicated against this artefact, and a paraphrase
would let the adjudication drift.

## Tier 1, the pool: cut

> "thats not at all what i was getting at, so we can cut hte pool"

**Ruling.** `pool.amount` stays 0 permanently. The pool is not a direction to
revisit, and no default moves. The mechanism is not deleted in the same breath:
`poolRadialProfile` and `PoolProfile` supply the bust's bind extent, which the
melt needs, and `poolWaterlineRadius` still floors the compositor outline. What
is cut is the look, not the geometry helpers underneath it.

## Tier 3, the fluid: missed

> "i turn on liquid, and its just like a gravity effect? and it all bulges"

**Ruling.** The modal solver reads as a gravity bulge, not as liquid.
`fluid.amount` stays 0. Tier 3 is superseded as the liquid direction by
`dec.liquid-glass-melt`; it is not deleted, because a per-zone displacement
field with a working normal transform is the same seam the melt composes onto.

## The ask

> "I want to be able to morph the whole head, from a flat puddle, up into the
> head. And i want to be bale to make the head squeeze and move between things."

**Ruling.** This is the liquid direction. Two asks, and they are ordered: the
puddle-to-head morph is built and judged first, and the squeeze is that same
morph driven by the stage colliders, built only once the morph is approved.
Building the second on an unapproved first is exactly what produced tier 3.

## Stage participants: missed

> "the bumping into objects is a bit weird, and doesnt hit the mark"

**Ruling.** `stage.amount` stays 0. The look is wrong, but the collider
plumbing is what the squeeze will reuse, so the code stays and the todo is
demoted rather than cut.

## The compositor layer, rung 2: rejected on shape

> "its just a weird patch behind the head? though i do see objects on the page
> through the head, so thats working well"

**Ruling.** The frosted page content itself works; the shape it is clipped to
does not. The cause is already recorded in `todo.liquid-glass-live-css-layer`:
the silhouette hull's 20 to 40 point budget leaves the polygon 27 to 41 per cent
larger in area than the true silhouette, so the frost reads as a patch behind
the head rather than as the head. `compositor.amount` stays 0 until the halo is
fixed, which is `todo.silhouette-hull-halo`.

## Interior glyphs: kept, experimental, default off

> "somewhat works, though the glyphs pop out the head when i increase drift.
> That can be an experimental feature default off"

**Ruling.** `interior.count` stays 0 and the feature is documented as
experimental. The leak is a real defect with a known fix and its own todo,
`todo.interior-glyph-containment`: the drift target has no containment, so any
glyph whose clearance to the skin is smaller than the drift amplitude
translates straight through it.

## The ladder: the lens is preferred

> "when i tick the rung options, then tha layer goes away, then i can see like
> some lens effects behind it, however i dont see the ladder bit moving through
> the head anymore, but thats obv much better than the weird flat layer behind
> it"

**Ruling.** Of the two backdrop rungs the lens wins, which is the outcome
`dec.liquid-glass-rung-exclusion` already encodes: the higher rung stands the
lower one down. The owner also observed the lens content stops moving, which is
the snapshot rasteriser's refresh cadence rather than a fault in the exclusion.
Both rungs stay at 0 by default; the ruling is about which one a host that
enables one should enable.

## The scope ruling for tier 4

Given separately, and it bounds any future particle field
(`todo.liquid-glass-topology-fluid`):

The fluid field is entered only where there is no face. Whenever there is a
head, the rig owns it, and speech runs on the 15 authored visemes. A particle
field never gets to approximate a mouth.

## What the session leaves standing

Nothing shipped changes. Every gated default stays at 0, so this artefact moves
no pixel on the live demo by itself. What it does is close five directions and
open one: the melt, recorded as `dec.liquid-glass-melt`.
