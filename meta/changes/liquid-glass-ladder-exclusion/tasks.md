# Tasks: liquid-glass-ladder-exclusion

- [x] `dec.liquid-glass-rung-exclusion` and `todo.liquid-glass-ladder-exclusion`
- [x] Failing engine tests in `test/core.test.ts`: suppression, restoration on
      drop, restoration at `lens.amount: 0`, unresolved capture keeps the
      layer, failed rasteriser keeps the layer
- [x] `EngineImpl.lensContributing()` and the gate in `applyCompositorGlass`
- [x] Move the `applyCompositorGlass` call after the lens sync in `frame`
- [x] Document the exclusion on `HeadLensConfig`, `HeadCompositorConfig`,
      `setLensSource` and in the README ladder section
- [x] `demo/ladder-lab.html` plus its `demo/LAB-STATUS.md` entry and a row in
      `todo.liquid-glass-owner-look-session`
- [x] `tools/smoke/ladder-shot.mjs` and its `tools/smoke/README.md` entry
- [x] Resolve next unit of work 3 in `meta/decisions/liquid-glass-architecture.md`
- [x] Full gate: `bunx tsc --noEmit`, `bunx vitest run` (570 pass),
      `bun run lint` (1 pre-existing demo warning), `bun run build`,
      `bun run eval` (overall pass), `cairn hook all` (pass)
- [x] Browser smoke: 11 of 11 legs pass against real Chrome, and 3 fail with
      `lensContributing()` forced off
- [ ] Adversarial review, PR into `glass`, squash-merge
