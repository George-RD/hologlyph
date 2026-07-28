# Design: liquid-glass-ladder-exclusion

## Approach

One predicate, in one place, on the reconciler that already owns the layer's
lifetime.

`EngineImpl.applyCompositorGlass()` is the whole gate for rung 2 today: at
`compositor.amount: 0` it disposes the layer and returns null, and above zero
it builds one and pushes config. It gains a second reason to take the closed
branch, `this.lensContributing()`, which is true when `this.lens?.binding` is
non-null and `headConfig.lens.amount > 0`.

Taking the existing closed branch is deliberate rather than adding a hide path.
The layer is removed from the DOM, so no `clip-path` string is built and, more
importantly, the compositor does not keep capturing a backdrop for an element
nobody can see. That is the same reasoning the amount gate already records.

The call moves. `applyCompositorGlass()` currently runs before the lens sync
block, and both `createPageLens` and `createElementLens` publish `binding` from
inside `sync()`, so reading it where the call sits today would gate this
frame's layer on last frame's lens. Nothing between the two points touches the
returned handle: `syncCompositorGlass` consumes it after the render, at the end
of the frame. So the call moves down to immediately after the lens block, with
a comment saying why the order is load bearing.

Contribution rather than intent is the substance of the decision, not an
implementation detail. A named source whose rasteriser has not resolved, or
whose optional peer will not load, has a null binding and keeps the frost. That
is the ladder degrading the way `dec.liquid-glass-architecture` already
requires of the Chromium rung, applied one rung down.

## Changes

ADDED:
- `meta/decisions/liquid-glass-rung-exclusion.md` (`dec.liquid-glass-rung-exclusion`).
- `meta/todos/todo.liquid-glass-ladder-exclusion.md`.
- `EngineImpl.lensContributing()`, a private predicate.
- `demo/ladder-lab.html`: both rungs on one page, one slider each, with the
  live layer state reported so the exclusion is visible rather than inferred.
- Engine tests in `test/core.test.ts` covering suppression, restoration on
  drop, restoration at `lens.amount: 0`, and the unresolved-capture case.

MODIFIED:
- `src/core/engine.ts`: the gate in `applyCompositorGlass`, the position of its
  call in `frame`, and the doc comments on both.
- `src/contracts.ts`: `HeadCompositorConfig.amount` and `setLensSource` doc
  comments state the exclusion.
- `README.md`: the backdrop ladder section states the exclusion.
- `demo/LAB-STATUS.md`: the new lab.
- `meta/decisions/liquid-glass-architecture.md`: next unit of work 3 resolved.

REMOVED:
- Nothing.

RENAMED:
- Nothing.
