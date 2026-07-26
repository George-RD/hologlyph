# Tasks: liquid-glass-snapshot-lens

- [x] Add `HeadLensConfig` to the contract spine with a signed `strength`, wire
      it through `HeadConfig`, `HeadConfigOverrides` and `normaliseHeadConfig`,
      and pin the defaults in `test/shaders.test.ts`.
- [x] Write the pure projection maths in `src/core/lens.ts`: the document-space
      window, the aspect-corrected displacement scale, the window-change test
      and the debounced recapture scheduler.
- [x] Unit-test the window against the two rectangles, the v flip, the
      degenerate rects, the isotropy of the displacement, and the scheduler's
      coalescing and disposal.
- [x] Build `src/core/page-lens.ts`: injected rasteriser with a lazily imported
      `@zumer/snapdom` default, capture-time source rect, per-frame window
      sync, coalesced in-flight captures, debounced scroll recapture, and
      texture disposal.
- [x] Unit-test that a plain scroll costs nothing, that a moved head does not
      recapture, that a reflowed source does, that failures degrade, and that
      dispose is idempotent.
- [x] Add the lens term to the interior pass in `src/shaders/materials.ts`,
      displaced by `normalView.xy * aThickness`, with a derived gate that is an
      exact identity when no snapshot is bound.
- [x] Add `VFXEngine.setLens` and the uniform fan-out, including re-applying a
      live binding to a material built after an avatar replace.
- [x] Own the lifecycle in `EngineImpl`: `setLensSource`, `captureLens`, build
      on mount when a source was named first, sync each frame, tear down with
      the engine.
- [x] Engine tests: never touched without a source, bound and cleared with one,
      accepted before mount, capture failure surfaced as an engine error,
      cleared on dispose.
- [x] Add the `refract` attribute to `<hologlyph-head>`, resolved against the
      owner document, degrading on a selector that matches nothing or does not
      parse. Element tests for all four cases.
- [x] Declare `@zumer/snapdom` an optional peer, externalise it from the
      library build, and record the notice in `THIRD-PARTY-NOTICES.md`.
- [x] Lab page `demo/lens-lab.html` with an aperiodic hero, source and lens
      controls, and a recapture button. Dev-only, not in the demo build inputs.
- [x] Smoke script `tools/smoke/lens-shot.mjs`: presence floor, noise floor,
      window arithmetic, bounded compositing seam, visible displacement,
      untouched page outside, sign response, and exact restoration.
- [x] Verify: `bunx tsc --noEmit`, `bunx vitest run`, `bun run lint`,
      `bun run build`, `bun run eval`, `cairn hook all`.
- [x] Verify acceptance in a real browser: a named hero visibly lensed through
      the head, with the head-shaped difference map and the sign response to
      prove it is displacement rather than an overlay.
- [x] Fix what the browser found: the window mapping proved by arithmetic
      rather than by pixels, and the periodic lab hero replaced because a
      one-period displacement is indistinguishable from none.
- [x] Review. NOT independent: three delegated reviews were dispatched and all
      three died on a provider usage limit, so this was a self-review against
      the checklist written for them. It found four defects, all fixed: a
      disposed snapshot left bound to a live sampler, a non-idempotent
      `setLensSource`, a remount keeping a stale sample window, and a cached
      rasteriser-import rejection. An independent pass over the
      `interior.outputNode` composite in `src/shaders/materials.ts` and the
      capture lifecycle in `src/core/page-lens.ts` is still owed.
