# Tasks: 2026-07-18-gaze-follow-pointer

- [x] Add `ndcToGazeOffset` mapping plus follow state/methods to GazeController
- [x] Add `setGazeTarget`/`clearGazeFollow` and subtle head follow to MotionEngine
- [x] Add the two follow methods to the `MotionEngine` contract
- [x] Wire passive pointer observation and rAF throttle in the element layer
- [x] Add `test/motion-gaze-follow.test.ts` (mapping, damping, timeout, reduced, listener removal)
- [x] Keep test fakes (core, element) contract-green for the new methods
- [x] Verify `tsc --noEmit`, `vitest run`, and `bun run lint`
