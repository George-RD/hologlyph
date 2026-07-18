# Design: 2026-07-18-visual-eval-harness

## Approach

Two-stage local pipeline mirroring the existing `tools/smoke/` pattern.
Capture drives the real demo in headless system Chrome via Playwright,
seeding `Math.random` through `addInitScript` and settling waits (about 4 s
after avatar load, 800 ms after posing) so frames are repeatable. Side
views orbit the renderer camera by +/-0.6 rad rather than turning the head,
because the motion API clamps head yaw to +/-0.5 rad. Scoring decodes the
PNGs with a dependency-free decoder (node:zlib inflate plus manual
unfilter) and computes: glyph legibility as mean absolute luminance
gradient over a close-up crop; coverage as the glyph-luminance fraction of
the head silhouette for front and both yaws (catches side-mapping
regressions); flow as silhouette-restricted mean absolute delta between two
frames one second apart, bounded above to reject strobing. Values compare
against `baseline.json`, calibrated once on the accepted triplanar build;
each metric yields pass/warn/fail and the report an overall verdict.

## Changes

ADDED:
- `tools/evals/capture.mjs`, `tools/evals/score.mjs`
- `tools/evals/baseline.json`, `tools/evals/README.md`
- `eval` script in `package.json`; `playwright` devDependency
- `.github/workflows/ci.yml` (checks + visual eval with negative control)

MODIFIED:
- `demo/main.ts` (demo-only `window.__hologlyphEngine` hook)
- `tools/smoke/*.mjs` (portable Playwright/Chromium resolution)
- `AGENTS.md` (eval in the verification chain; CI description)
- `.gitignore` (`tools/evals/out/`)

REMOVED:
- None

RENAMED:
- None
