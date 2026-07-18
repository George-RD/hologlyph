# Tasks: 2026-07-18-eval-textskin-repair

- [x] Add fail-closed baseline validation and tests in `tools/evals/score.mjs` and `test/evals-score.test.ts`.
- [x] Implement deterministic flow capture by using `setMotionFrozen` during flow pair in `tools/evals/capture.mjs`.
- [x] Thread reduced-motion into text-skin scrolling with tests in `src/text-skin/index.ts`, `src/contracts.ts`, `src/core/engine.ts`, and `test/text-skin.test.ts`.
- [x] Update eval README and close-loop artifacts, then run `bunx tsc --noEmit`, `bunx vitest run`, and `bun run lint`.
