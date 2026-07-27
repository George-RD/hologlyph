---
node: hologlyph.runtime.core
status: done
created: 2026-07-27
---

# Rung 2 and rung 3 in the same page

Next unit of work 3 in `dec.liquid-glass-architecture`, and the only item left
in the programme that does not need the owner. Items 1 and 2 there are a look
session and a product call.

Naming a lens source raises the interior pass's alpha to `a + (1 - a) * w`, so
at `lens.amount: 1` the head is opaque and the compositor frost behind it is
invisible while still being clipped to a fresh `clip-path` every frame. Between
0 and 1 the frost shows through in proportion to `1 - w` and the page appears
twice: once blurred and aligned with the canvas box, once sharp and displaced
by the surface normal. Nothing in the codebase decides which of the two rungs a
page that turns both on is supposed to see.

Resolved by `dec.liquid-glass-rung-exclusion`: the rungs are exclusive, the
higher one wins, and the test is contribution rather than intent. The engine
suppresses the compositor layer exactly while `LensSource.binding` is non-null
and `lens.amount` is above zero, down the same path as `compositor.amount: 0`,
so the layer is removed rather than hidden. A lens that never captures, or
whose rasteriser will not load, leaves the frost exactly where it was.

## Acceptance

- With both gates open and a bound lens, no `[data-hologlyph-compositor]`
  element is in the tree and no `clip-path` is authored.
- Dropping the source, or taking `lens.amount` to 0, brings the layer back on
  the next frame.
- A named source whose capture has not resolved, or has failed, keeps the
  layer.
- `applyCompositorGlass` runs after the lens sync, since both lens
  implementations publish `binding` from inside `sync()`.
- A lab page drives both knobs against each other so the owner can judge them
  as alternatives.
