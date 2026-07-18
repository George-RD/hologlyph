# Implementation notes: baseline idle motion

## 2026-07-18

- `src/motion/idle.ts` implements `IdleController`. All motion is
  deterministic via injected `rng` and `clock`; the constructor consumes rng
  for the first blink schedule and for the first weight-shift schedule.
- `src/motion/index.ts` wires idle: `idlePose` is computed each update; head
  and neck bones receive the pose through `idleHeadBlend`; blink morphs use
  `max(expression, idleBlink)` only when the expression leaves the blink at
  approximately zero (resting face). `idleHeadBlend` is set to zero
  immediately while a nod or still-posing drag is active, then eases back at
  `IDLE_HEAD_BLEND_UP_K = 1` so idle never snaps in or out.
- `MotionEngineOptions.idle` accepts the default-on value, `false` (intensity
  zero), or `{ intensity }`. Intensity is normalised to a finite value in
  `[0,1]` in both the constructor and `setIntensity`.
- Weight-shifts are scheduled 18-40 seconds apart. The first target is not
  selected on frame one, and both drift and weight-shift targets ease toward
  their values to prevent per-frame snaps.
- Deviation from a naive approach: idle head motion initially used a hard
  `0/1` switch. That perturbed exact drag and nod profiles and hard-applied an
  accumulated random drift offset when control ended. Immediate suppression
  followed by a slow return blend fixes both behaviours without disabling idle
  in production or in the established nod test.
- TDD note: `IdleController` existed before `test/motion-idle.test.ts` in this
  session, so the captured red was the engine default-on wiring test (head did
  not move until wired) plus an initially incorrect disposal assertion. The
  controller unit tests passed once the class existed; the engine-wiring
  assertion failed for the intended reason. The disposal assertion was then
  corrected because the controller now halts after `dispose()` and returns a
  zero pose.
- An earlier edit accidentally placed `idle.dispose()` outside the engine
  `dispose()` closure, which would have run at construction. It was corrected;
  the final function resets `idleHeadBlend`, calls `idle.dispose()` inside the
  closure, and preserves the `baseEyeR = null` reset.
- `test/motion-idle.test.ts` contains 15 deterministic tests covering amplitude
  bounds, Poisson blink statistics, reduced-motion damping, speaking blend-out,
  per-frame continuity, scheduled weight-shift rarity, intensity boundaries,
  disposal, default-on and disabled wiring, explicit drag priority, expression
  priority, viseme priority, and engine disposal.
- Verification: `bunx tsc --noEmit` clean, `bunx vitest run` 193 passed with
  exit code 0, and `bun run lint` clean.
