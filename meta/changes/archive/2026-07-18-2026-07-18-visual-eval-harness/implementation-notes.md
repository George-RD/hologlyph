# Implementation notes: 2026-07-18-visual-eval-harness

- TDD deviation: the harness was implemented before the typed change was
  scaffolded and without a failing test first. The deliverable is tooling
  (browser capture plus image scoring) whose behaviour is exercised end to
  end by the eval run itself rather than by unit tests; the negative
  control now serves as the harness's own regression test. Recorded per
  the AGENTS.md requirement that deviations from test-first get a note.
- Requested +/-0.6 rad side views could not use head yaw: the motion API
  clamps drag yaw to +/-0.5 rad (`DRAG_YAW_LIMIT` in `src/motion/index.ts`).
  The capture orbits the camera around the origin instead; documented in
  the harness README and baseline.
- The planned eye-occlusion metric was dropped as too fragile (no robust
  way to isolate the region behind the shell edge from silhouette pixels);
  the report records it as skipped.
- No image dependencies: a small PNG decoder (zlib inflate plus manual
  unfilter) was written instead of adding pngjs. Playwright was added as a
  devDependency so the harness and smoke scripts stop hard-coding a
  machine-local module path and Chrome binary; a real browser can still be
  supplied via `HOLOGLYPH_CHROME`.
- Review found coverage alone would not catch the original side-projection
  smear (stretched glyphs keep their bright-pixel fraction). Added a
  silhouette-restricted yaw legibility gradient metric for both yaw views,
  plus a `--negative-control` mode that smears the yaw captures in memory
  and requires the metric to fail; the control writes its report to
  `report-negative-control.json` so the clean `report.json` artifact is
  never overwritten.
- Managed-Chromium captures matched the system-Chrome calibration within
  noise (legibility 7.584 vs 7.579; coverage identical to 3 dp), so the
  original baseline values were kept and only the new yaw metrics were
  calibrated (35.287 / 35.558).
- CI: new `.github/workflows/ci.yml` runs type-check, lint, tests, build,
  and the eval (capture, score, negative control) on every PR, uploading
  `tools/evals/out/` as an artifact. The macOS-only `--use-angle=metal`
  flag is applied conditionally so Linux CI falls back to SwiftShader.
- `tools/evals/out/` is generated and now gitignored.
