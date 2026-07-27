# Tasks: liquid-glass-live-css-layer

- [x] Settle the Firefox blocker on primary evidence: Mozilla 1579957 and its
      dependency 1765525, both fixed before the property shipped unflagged
- [x] Spike the backdrop root before committing to a module shape:
      `tools/smoke/backdrop-root-spike.mjs`, seven ancestor shapes, Chromium
      and WebKit
- [x] `dec.liquid-glass-compositor`, recorded BEFORE building on it
- [x] Contracts: `HeadCompositorConfig`, `HeadConfig.compositor`, overrides,
      `DEFAULT_HEAD_CONFIG` gated at `amount: 0`
- [x] `normaliseHeadConfig` compositor block in `src/shaders/materials.ts`,
      with the `finiteOr` discipline
- [x] `src/core/compositor-glass.ts`: the layer, the support gate, the
      backdrop-root ancestor walk, allocation-aware outline change detection
- [x] Optional waterline floor on `SilhouetteProjector.update`
      (`src/asset/hull.ts`)
- [x] Engine: `applyCompositorGlass`, `syncCompositorGlass` after `render()`,
      projector rebuilt in `replaceAvatar`, teardown on dispose and on a canvas
      swap
- [x] Tests: `test/core-compositor-glass.test.ts`, engine lifecycle in
      `test/core.test.ts`, the floor in `test/asset.test.ts`, the config pin and
      normalisation in `test/shaders.test.ts`
- [x] Self-review found three defects; each fixed with a regression test:
      per-frame rebuild attempt, layer stranded on remount, double-scaled tint
- [x] `demo/compositor-lab.html` and `tools/smoke/compositor-shot.mjs`
- [x] `cairn.blueprint` path claim for the new test file
- [x] Close `todo.liquid-glass-firefox-verify`, mark item 6 landed, refresh the
      handover in `demo/LAB-STATUS.md` and `dec.liquid-glass-architecture`
- [x] Full gate: `bunx tsc --noEmit`, `bunx vitest run`, `bun run lint`,
      `bun run build`, `bun run eval`, `cairn hook all`, plus the browser smoke
