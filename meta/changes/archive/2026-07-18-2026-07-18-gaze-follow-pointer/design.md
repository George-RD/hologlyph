# Design: 2026-07-18-gaze-follow-pointer

## Approach

Extend the existing gaze pipeline so the head follows the host pointer. The
GazeController already owns per-frame eye-bone application and deterministic
motion seams; we add a `follow` target that overrides the procedural saccades
while active, damps smoothly toward the pointer, and eases back to forward when
the target goes stale or the pointer leaves. A subtle head-bone fraction follows
the eye direction, clamped well below the drag limits, and is disabled under
reduced motion (eyes-only). The element layer observes `pointermove` (passive)
on the host, maps the pointer to a normalised device coordinate, throttles the
write to one call per animation frame, and removes every listener on disconnect.

## Changes

ADDED:
- `src/motion/gaze.ts`: `FOLLOW_YAW_LIMIT`, `FOLLOW_PITCH_LIMIT`,
  `ndcToGazeOffset(ndcX, ndcY)` pure mapping and clamp, `GazeControllerOptions`
  (configurable `followTimeout`), follow state (`followTarget`,
  `followUntil`), and `setFollowTarget`, `clearFollow`, `isFollowing`.
- `src/motion/index.ts`: `setGazeTarget`/`clearGazeFollow` on the engine,
  follow head-bone fraction state and constants, integrated into the existing
  head/neck application block.
- `src/contracts.ts`: `setGazeTarget(ndcX, ndcY)` and `clearGazeFollow()` on
  the `MotionEngine` interface.
- `src/element/hologlyph-head.ts`: passive `pointermove`/`pointerleave`
  observation on the host, rAF-throttled dispatch to `engine.motion`, and
  listener teardown via the existing `_offs` array.
- `test/motion-gaze-follow.test.ts`: mapping maths, damping convergence,
  timeout return, reduced-motion, and happy-dom listener lifecycle.

MODIFIED:
- `src/contracts.ts`: `MotionEngine` gains the two follow methods.
- `src/motion/index.ts`: follow wiring; `dispose()` resets follow state.
- `meta/todos/todo.gaze-follow-pointer.md`: status `in_progress` -> `done`.
- Test fakes (`test/core.test.ts`, `test/element.test.ts`) gain the two new
  motion methods so the typed contract stays green.

REMOVED: none.

## Contract surface

`MotionEngine.setGazeTarget(ndcX, ndcY)` takes a normalised device coordinate
in `[-1, 1]` (x right, y down); the engine clamps it and converts to clamped
eye yaw/pitch. `clearGazeFollow()` marks the follow target expired so the gaze
eases back to forward/idle without snapping before procedural modes resume.

## Non-goals

Idle/breathing motion is owned by a sibling; this change does not alter
`saccade` behaviour, mood selection, or the drag head target beyond adding a
separate, additive follow fraction.
