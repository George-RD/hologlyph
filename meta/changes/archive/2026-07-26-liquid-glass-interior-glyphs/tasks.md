# Tasks: liquid-glass-interior-glyphs

- [x] `HeadInteriorConfig` in `src/contracts.ts`, wired into `HeadConfig`,
      `HeadConfigOverrides` and `DEFAULT_HEAD_CONFIG` with `count: 0`, and
      normalised in `normaliseHeadConfig` with `brightness` clamped to [0,1].
- [x] Pure half in `src/shaders/interior-glyphs.ts`: per-slice body axis,
      thickness-weighted site sampling with a uniform fallback, the spring
      constants and the allocation-free integrator, the drift field, depth dim.
- [x] GPU half in `src/shaders/interior-glyph-field.ts`: quad buffers sized to
      the sites actually sampled (at most `INTERIOR_GLYPH_MAX`), static inset
      UVs, luminance-keyed node material, billboarding, back-to-front sort,
      `renderOrder -0.5`, idempotent dispose.
- [x] Reconcile it in `EngineImpl`: sample on first activation, tear down at
      `count: 0`, push config only on change, update after the pool, dispose
      with the engine and with the avatar.
- [x] Reduced motion damps the drift and removes the lag, as everywhere else.
- [x] Cover the pure half in `test/shaders-interior.test.ts`; cover the gate,
      the lifecycle and the frame wiring in `test/core.test.ts`.
- [x] Lab page `demo/interior-glyph-lab.html` with count, drift and inertia
      sliders, a shake scenario and a frame-time readout.
- [x] Smoke script `tools/smoke/interior-glyph-shot.mjs`: silhouette floor,
      noise floor, inertness at `count: 0`, the field actually drawing, the lag
      under a shake, and reduced motion removing it.
- [x] Claim the new test path in `cairn.blueprint`; document in `README.md`,
      `CHANGELOG.md`, `demo/LAB-STATUS.md`, `tools/smoke/README.md`.
- [x] Full gate: `bunx tsc --noEmit`, `bunx vitest run`, `bun run lint`,
      `bun run build`, `bun run eval`, `cairn hook all`, plus a live browser
      look at the lab.
