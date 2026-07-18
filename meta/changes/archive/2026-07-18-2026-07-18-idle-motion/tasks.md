# Tasks: baseline idle motion

- [x] Implement `IdleController` with breathing, drift, weight-shift, and Poisson blinks using rng/clock seams
- [x] Compose idle below expression and viseme priority; yield head motion to nods and drags via eased blend
- [x] Wire `IdleController` into `MotionEngine.update` and `dispose`; add the default-on `idle` option
- [x] TDD: cover amplitude bounds, blink scheduling, reduced-motion damping, continuity, priority, disposal, and intensity clamping
- [x] Run `bunx tsc --noEmit`, `bunx vitest run`, and `bun run lint`
- [x] Mark `meta/todos/todo.idle-motion.md` done
