# Proposal: liquid-glass-ladder-exclusion

## Motivation

Next unit of work 3 in `dec.liquid-glass-architecture`, and the only item left
in the liquid-glass programme that does not need the owner. Items 1 and 2 there
are a look session and a product call.

Rung 2 (the compositor `backdrop-filter` layer) and rung 3 (the lens) both
answer "what is behind the glass". Each shipped alone, gated off, and was
judged alone. A page that turns both on gets an undefined result: at
`lens.amount: 1` the head is opaque and the frost is paid for but invisible,
and between 0 and 1 the page appears twice, once blurred and aligned with the
canvas box and once sharp and displaced by the surface normal.

## Scope

- `dec.liquid-glass-rung-exclusion`: the rungs are exclusive at any one head,
  the higher one wins, and the test is contribution rather than intent.
- Engine reconciliation: suppress the compositor layer while
  `LensSource.binding` is non-null and `lens.amount` is above zero, down the
  same path `compositor.amount: 0` already takes, so the layer is removed
  rather than hidden.
- Move `applyCompositorGlass` after the lens sync in the frame loop, since both
  lens implementations publish `binding` from inside `sync()`.
- A lab page that drives both knobs against each other, so the owner can judge
  the two rungs as alternatives.
- Documented rule on the public surface: the compositor layer shows unless the
  lens is showing.

## Out of scope

- Any change to a shipped default. `compositor.amount` and `lens.amount` both
  still ship at 0, so a drop-in head is untouched.
- Blending the two rungs. `dec.liquid-glass-rung-exclusion` records why no
  blend of them means anything.
- The owner look session itself (`todo.liquid-glass-owner-look-session`) and
  tier 4 (`todo.liquid-glass-topology-fluid`). Both need the owner.
