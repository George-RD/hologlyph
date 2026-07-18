# Implementation notes: 2026-07-18-blend-zone-ghosting-metric

## Estimator

`blendZoneGhosting(img, mask, lumThreshold)` in `tools/evals/score.mjs` is a
pure, dependency-free function. On the 45-degree (`yaw-0.785.png`) view it
restricts to head-silhouette pixels, collects the bright (glyph) pixels per row,
partitions them into contiguous runs, and returns the mean per-row fraction of
bright pixels that have a twin (another bright pixel) 2-6 columns away in a
*different* run. A single clean stroke contributes almost none (no other run); a
ghosted copy repeats the whole pattern at a fixed offset, so nearly every pixel
gains a twin. Higher is worse, so it fails above the calibrated ratio band.

The twin must lie in a different run on purpose: a wide stroke would otherwise
self-twin at small offsets and false-positive. The negative-control transform
`duplicateAndOffset(img, offset, lumThreshold)` copies every bright glyph pixel
shifted right by `offset` (default 4) to synthesise the doubled-edge signature.

## TDD

`test/evals-ghosting.test.ts` exercises the estimator on tiny synthetic RGB
buffers (built in memory and also round-tripped through a minimal truecolour
PNG encoder/decoder). Cases: crisp single stroke near zero, artificially
doubled glyph well above crisp, decoded-buffer discrimination, the
negative-control transform pushing a clean view into the ghosted range, a thick
(width 5) single stroke near zero (guards the self-twin trap), and an empty
image returning zero without throwing. Six tests.

The red/green gate was demonstrated explicitly: the estimator was temporarily
stubbed to `return 0`, the doubled/control assertions failed (expected > 0.5,
got 0), then the real body was restored and all six passed. `score.mjs` was also
made import-safe (`if (import.meta.main) main()` and the top-level `new URL`
paths moved into `main()`) so the vitest import does not execute the file
scoring path.

## Estimator evolution (deviation worth recording)

The first prototype counted adjacent bright runs separated by a 2-6 px dark gap.
It was confounded by ordinary inter-glyph spacing: the accepted build already
scored 3.946 (high baseline) and the synthetic duplicate only reached 6.455
(warn, not fail) against a 2x band. Switched to the run-aware twin fraction,
which isolates genuine shifted copies: baseline dropped to 0.492 and the control
reached 0.832 (fail). Both are stable across repeated captures.

## Calibration (accepted build)

Repeated clean captures: `blendZoneGhosting` = 0.489, 0.486 (baseline set to
0.492). Bands mirrored from the existing lower-is-better metrics: pass ratio
1.25x (pass cutoff 0.615), warn/fail at 1.5x (fail cutoff 0.738). Negative
control (duplicate-and-offset the 45-degree view) = 0.832 -> fail, ~14% above
the fail cutoff; clean stays ~26% below the pass cutoff. The report shape gained
a `blendZoneGhosting` metric object (`value`, `path`, `baseline`, `passCutoff`,
`warnCutoff`, `status`) and the `notes` array gained a line explaining the
45-degree view.

## Recommendation (part 2)

Part 2 (sharpen the triplanar weight exponent or add a bias to trade a harder
seam for less ghosting) is **not warranted**. On the current accepted build the
ghosting value is low (0.492) and passes comfortably with ~26% headroom; the
blend zone is not objectionably wide. The metric is therefore landed as a
regression guard only. Revisit shader tuning only if a future change drives the
45-degree value toward or past the 0.615 pass cutoff.

## Artefacts touched

- `tools/evals/capture.mjs` - added the `yaw-0.785.png` 45-degree camera-orbit
  capture (appended after `flow-1` so it does not perturb the existing
  `close-up`/`flow` poses, whose camera persists from the -0.6 orbit).
- `tools/evals/score.mjs` - import-safe module; exported `decodePng`,
  `luminance`, `silhouetteMask`; added `blendZoneGhosting`,
  `duplicateAndOffset`; `highIsBadStatus` helper; blended the metric into normal
  scoring and the `--negative-control` mode (original mask preserved before the
  duplicate transform).
- `tools/evals/score.d.mts` - type declarations for the vitest suite.
- `tools/evals/baseline.json` - `blendZoneGhosting` baseline and ratio bands.
- `tools/evals/README.md` - documented the capture, metric, and control.
- `test/evals-ghosting.test.ts` - new suite.
