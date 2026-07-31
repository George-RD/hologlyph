# Tasks

- [x] Failing tests first: probe cases, per-site clearance, drift containment,
      moving and scaled frame.
- [x] `createSurfaceProbe` in `src/shaders/interior-glyphs.ts`, exact
      point-triangle with a bounding-sphere reject and a collinear fallback.
- [x] `InteriorSites.clearances`, measured per kept site.
- [x] `interiorDriftBudgets`, clearance and sprite extent to a world radius.
- [x] `interiorDriftTargets` takes budgets and caps the offset LENGTH.
- [x] `interiorContain` after the integrator, with outward velocity removal.
- [x] Cull sites whose sprite does not fit at all, keyed on the live extent.
- [x] Index buffer through `readInteriorGeometry` and
      `InteriorGlyphFieldOptions`.
- [x] Field-level regression over a moving, scaled frame, in
      `test/shaders-interior-field.test.ts`.
- [x] Owner ruling on the bounded inertia drag, recorded as
      `dec.interior-glyph-containment`; smoke leg 3 re-expressed against the
      rigid control.
- [x] Fixed the smoke's settle detector, which returned on one quiet window and
      raced the caller's residual check.
- [x] Gates: `bunx tsc --noEmit`, `bunx vitest run` (621 tests over 29 files,
      which includes the 4 new field tests), `bun run lint`, `bun run build`.
- [x] Browser check on the real bust: `tools/smoke/interior-glyph-shot.mjs`
      green four runs in a row, 0 px outside the silhouette.
- [x] `bun run eval`: overall pass, unmoved.
- [x] `cairn scan` and `cairn hook all`, both exit 0. Scan reports the five
      `CAIRN_SOURCE_UNVERIFIED` Info findings that predate this change; they are
      owner-session transcripts and none is referenced into existence by it.
      `hologlyph.runtime.shaders` gained one path claim, paired with
      `dec.interior-glyph-containment`.
- [ ] Land into `glass` by squash-merged PR.
