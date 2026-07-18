# Proposal: baseline idle motion

Owner request (2026-07-17): the bust should not read as a statue. Add a
low-amplitude idle layer: breathing, micro head drift, an occasional
weight-shift, and periodic blinks. The layer must compose below expression
and viseme priority, be deterministic via the rng/clock seams, respect reduced
motion, and degrade rather than throw.

## Scope

- New `src/motion/idle.ts` exposing `IdleController`, plus wiring into
  `MotionEngine.update` and `dispose`.
- Public `idle?: boolean | { intensity }` option on `createMotionEngine`,
  defaulting on.
- No element or adapter changes; no gaze changes (a sibling agent owns gaze).

## Out of scope

- Gaze follow-pointer (separate agent).
- Threading the idle knob through `EngineOptions`/`contracts.ts`. Default-on
  already satisfies the behavioural requirement; a contracts change is
  deferred to avoid scope creep and a possible collision with sibling work.
