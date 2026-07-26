# Tasks: liquid-glass-chromium-lens

- [x] Lift the lens source shape into `src/core/lens.ts` as `LensSource`, and
      `documentRect` with it, so the snapshot lens and the live lens share one
      interface and one measurement. `page-lens` keeps `PageLens` as an alias.
- [x] Probe the capability at the prototype, both halves, constructing no
      context: `CanvasRenderingContext2D.prototype.drawElementImage` and
      `WebGL2RenderingContext.prototype.texElementImage2D`. Off by default,
      absence normal, half-present refused.
- [x] Gate on the subtree shape: an immediate child of a
      `<canvas layoutsubtree>`. Refuse a grandchild, an ordinary parent, a
      canvas with no `layoutsubtree`, and a detached element.
- [x] Build `createElementLens`: per-frame `drawElementImage` into the source
      canvas, scaled so the texture covers exactly the element's layout box,
      one reused texture marked for re-upload, sRGB decode, the same window and
      displacement arithmetic as the snapshot lens.
- [x] Degrade on every failure: bounded retries with `requestPaint()` for a
      missing paint record, one report and a permanent stop after
      `MAX_LIVE_LENS_FAILURES`, budget reset by a good frame, a zero-sized rect
      drawing nothing rather than dividing by it, and an idempotent dispose
      that frees the texture and leaves the host canvas alone.
- [x] Select between the two in `EngineImpl.buildLens`, with a host-supplied
      rasteriser always choosing the snapshot path, and rename the field.
- [x] Warn when the head covers an interactive control inside the refracted
      subtree; stay silent on overlap alone.
- [x] Cover it: 33 cases in `test/core-element-lens.test.ts` and 5 in
      `test/core.test.ts`, the capability faked at the prototype and torn down
      in `afterEach` so it cannot leak into the snapshot-lens suite.
- [x] Lab page and smoke script, with the smoke run twice, flag on and flag
      off, and a residual-motion floor so the liveness legs are relative to the
      head's own animation rather than to zero.
- [x] Register the new test path in `cairn.blueprint`; document in `README.md`,
      `CHANGELOG.md`, `demo/LAB-STATUS.md`, `tools/smoke/README.md`.
- [x] Full gate: `bunx tsc --noEmit`, `bunx vitest run`, `bun run lint`,
      `bun run build`, `bun run eval`, `cairn hook all`, plus the browser smoke
      against Chrome 150.
