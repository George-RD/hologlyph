# Design: 2026-07-18-eval-textskin-repair

## Approach

- Validation first in `tools/evals/score.mjs`:
  - define the exact required baseline keys for all scored metrics,
  - throw when the baseline block is missing, truncated, or contains non-positive values,
  - keep the `overall` status flow so `baseline-missing` exits non-zero.

- Motion freeze for flow capture in `tools/evals/capture.mjs`:
  - add a small helper that calls `window.__hologlyphEngine.setMotionFrozen(true|false)`,
  - run the two flow captures inside that helper's frozen window,
  - restore motion in a `finally` block and keep existing settle timings.

- Reduced-motion threading in `src/text-skin/index.ts` and `src/core/engine.ts`:
  - expose/add `setReducedMotion(reduced: boolean)` in `TextSkinEngine` and route preference updates from mount and media-query changes,
  - gate row scroll updates when reduced motion is active so motion-sensitive tests remain deterministic.

## Changes

ADDED:
- `tools/evals/capture.mjs`: `setMotionFrozen` and `captureFlowPair` helpers.
- `test/evals-score.test.ts`: baseline validation regression tests.

MODIFIED:
- `src/contracts.ts`: `Engine` and `TextSkinEngine` contract additions for `setMotionFrozen` and `setReducedMotion`.
- `src/core/engine.ts`: wire text skin reduced-motion preference and dynamic updates; implement `setMotionFrozen` with safe freeze/unfreeze behaviour.
- `src/text-skin/index.ts`: pause scroll offset advancement under reduced motion.
- `tools/evals/score.mjs`: explicit baseline key validation.
- `tools/evals/README.md`: document frozen flow capture and recalibration notes.
- `test/text-skin.test.ts`: added reduced-motion red-first test.
- `test/element.test.ts`: `FakeEngine` updated for new interface method.

REMOVED:
- None.

RENAMED:
- None.
