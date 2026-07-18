# Proposal: 2026-07-18-gaze-follow-pointer

## Motivation

The hologlyph should acknowledge the user's pointer position with a restrained gaze, while returning to a forward gaze when the pointer leaves or becomes idle. The existing GazeController already owns per-frame eye application and deterministic motion seams, but no pointer target reaches it.

## Scope

- Add a typed target-direction follow capability to GazeController and MotionEngine.
- Convert host-element pointer coordinates to a bounded normalised gaze direction.
- Smooth eye and subtle head participation, with timeout and pointer-leave reset.
- Honour reduced-motion settings without snapping.
- Add deterministic motion tests and happy-dom listener lifecycle coverage.

## Out of scope

- Idle or breathing behaviour changes.
- Pointer tracking outside the host element.
- New avatar rig bones or renderer changes.
