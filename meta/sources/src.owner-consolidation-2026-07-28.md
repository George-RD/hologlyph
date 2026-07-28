---
id: src.owner-consolidation-2026-07-28
file: ./meta/sources/src.owner-consolidation-2026-07-28.md
type: owner direction
verification: unverified
date: 2026-07-28
---

# The melt is approved, the glass is the default, and there is one environment

Given on 2026-07-28, after the owner walked `demo/melt-lab.html` and the studio.

## The melt direction is approved

> "the head liquid/melting is the right direction!"

And, on the floating eyeballs recorded as `todo.melt-internals`:

> "i was aware of the eyeballs/internals thing, i could see, which is why i just
> approved the directio here!"

**Ruling.** The melt is promoted from experimental spike to the active liquid
direction. `dec.liquid-glass-melt` was already accepted on the strength of the
escalation criterion not firing; this is the owner confirming it by eye, with the
known defects in view rather than hidden. It is **active development, not ready**:
`melt.amount` still ships at 0 and the melt lives in the studio's developer tier.

The two known gaps stand as recorded and neither is an argument against mesh
displacement: the internals do not melt with the shell
(`todo.melt-internals`), and the puddle has no thickness at exactly
`amount: 1`.

## The glass is the default, not a lab feature

> "I wanted to consolidate the glass system, as i think its good now, so that is
> the new default?"

**Ruling.** Yes. `skin.glass.amount` already shipped at 1; what changes is its
status. The glass is no longer something shown in a lab beside alternatives, it
is the head. The alternatives that were shown beside it were all ruled against
on 2026-07-27 (`src.owner-look-2026-07-27`).

Worth recording because it is not obvious from the config: the glass is a
continuous dial above 0 and a **mode switch at exactly 0**. Crossing 0 makes
`applyGlassLayering` drop the interior wall mesh, flip `transparent` across the
mask, the interior and the authored internals, and recompile. That threshold is
deliberate, because the single-list reordering is visible through an open mouth
even when the interior draws nothing.

## One environment

> "Idea being not having to maintain different environments."

> "As its confusing for me to have to open all sorts of websites when checking."

**Ruling.** One URL. The site root is the studio, and everything that used to be
its own page is folded into it: the melt into a developer tier, the 2026-07-27
rulings into a notes tier.

What that displaces:

- The previous root was `demo/index.html`, a **second renderer** hand-rolled in
  TSL rather than built on the library engine. It becomes
  `demo/handrolled.html`, stays in the repo as the owner-approved-look reference
  and as the left half of `compare-lab.html`, and leaves the deployed set. Two
  implementations of one head is the thing being consolidated away.
- `demo/outcomes.html` is deleted outright; its content is the studio's notes
  tier.
- `demo/compare-lab.html` and the nine `*-lab.html` feature spikes stay in the
  repo but out of the deployed set. Each spike is superseded by a tier in the
  studio, and several reach into `EngineImpl` privates, which is why they never
  shipped.
- `demo/engine.html` stays deployed but unlinked. It is the target of
  `tools/evals/capture.mjs`, so the visual eval needs it at a stable URL.

## What the next session is for

> "Next session, i plan to do an overhaul of the studio, using impeccable skill,
> to best show off the head."

Owner-led, with the design skill loaded, tracked as
`todo.studio-showcase-overhaul`. Today's change organises the surface; that one
is about presentation. It is blocked in practice on
`todo.public-camera-pose`, because a page whose purpose is to show the head off
currently cannot frame it.
