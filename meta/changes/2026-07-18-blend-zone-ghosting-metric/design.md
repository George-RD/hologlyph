# Design: 2026-07-18-blend-zone-ghosting-metric

## Approach

Capture a 45-degree camera-orbit view (`yaw-0.785.png`) by reusing the
existing `orbitCamera` helper with the requested yaw. The ghosting estimator
operates only on bright glyph pixels inside the head silhouette of that view,
so background and non-glyph detail never enter the score.

### Estimator

For each row, collect the bright glyph pixels (luminance above the glyph
threshold and inside the silhouette mask) and partition them into contiguous
runs. The score is the mean per-row fraction of bright pixels that have a twin
(another bright pixel of the head silhouette) 2-6 columns away in a *different*
run. A single clean stroke contributes almost none; a ghosted copy repeats the
whole pattern at a fixed offset so nearly every pixel gains a twin. The twin
must lie in a different run so a wide stroke does not self-twin at small
offsets. Higher is worse, so the metric fails above the calibrated ratio band.

The estimator is a pure function exported from `score.mjs`, so vitest can
exercise it on synthetic PNG buffers without a browser.

### Negative control

A new `--negative-control` transform duplicates the yaw-0.785 view and offsets
it horizontally by a few pixels before recombining, so every present glyph
acquires a separated copy. The ghosting metric must classify this synthetic
view as `fail`, proving it discriminates. The clean `report.json` is never
overwritten; the control writes `report-negative-control.json`.

## Changes

ADDED:
- `tools/evals/out/yaw-0.785.png` (generated capture, gitignored)
- `test/evals-ghosting.test.ts` (pure estimator unit tests)
- `meta/changes/2026-07-18-blend-zone-ghosting-metric/`

MODIFIED:
- `tools/evals/capture.mjs` (capture the 45-degree orbit view)
- `tools/evals/score.mjs` (ghosting estimator, scoring, negative control)
- `tools/evals/baseline.json` (blend-zone ghosting baseline and bands)
- `tools/evals/README.md` (document the metric)

REMOVED:
- None

RENAMED:
- None
