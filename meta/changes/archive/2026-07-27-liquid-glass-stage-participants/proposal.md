# Proposal: liquid-glass-stage-participants

## Motivation

Item 7 of `dec.liquid-glass-architecture`, rung 4 of the backdrop ladder. This
is what turns "a glass head on a page" into "a fluid that interacts with the
page", and it is what the owner's squeeze-past and migrate-and-re-emerge ideas
require.

The head knows nothing about the host layout today, so it cannot collide with
anything. Both prerequisites have now landed: `todo.liquid-glass-tier1-pool`
gave it a water surface (2026-07-26) and `todo.liquid-glass-fluidity-driver`
gave it a body that can be pushed around (2026-07-27).

## Scope

- Two declarative markers on elements the host already owns:
  `data-hologlyph-obstacle` and `data-hologlyph-body`.
- Batched rect measurement, invalidated by `ResizeObserver`,
  `IntersectionObserver` and a passive scroll listener rather than polled.
- Results written back as CSS transforms and nothing else.
- Growing `FLUID_MODES` from one global mode to one plus three participant
  slots, each localised to the height its element presses at, so two obstacles
  facing each other dent both sides instead of cancelling.
- Feeding the same participants to the tier 1 pool as soft Dirichlet dents.
- `Engine.refreshStage()` for markers that arrive after mount.
- A lab page and a measured headless smoke script.
- `dec.liquid-glass-participants` recording the contract and its limits.

## Out of scope

- Tier 4 topology change (migrate and re-emerge). That stays where
  `dec.liquid-glass-architecture` put it, in
  `todo.liquid-glass-topology-fluid`.
- Ray-casting participants against the mesh. Participants are resolved against
  the body's radial profile on world Z 0, the same profile the pool waterline
  uses.
- Any change to the shipped default look. `fluid.amount` still ships at 0 and
  `pool.amount` still ships at 0, so both halves of this coupling are inert
  until a lab slider or a host config opens them.
- The owner's pool ruling. The pool half is built behind the pool's own
  existing gate rather than waiting on it.
