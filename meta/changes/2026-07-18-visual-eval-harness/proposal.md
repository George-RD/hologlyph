# Proposal: 2026-07-18-visual-eval-harness

## Motivation

Visual quality of the text-skinned avatar (glyph legibility, side coverage,
row flow) has so far been judged by eyeballing screenshots. That does not
scale to iteration: regressions such as side-projection smear or glyphs
shrinking to sub-pixel dots were only caught by a human. A deterministic,
scored eval harness lets any change to the shaders, text skin or motion be
checked against a calibrated baseline before merge.

## Scope

- New `tools/evals/` harness: `capture.mjs` (headless Playwright + system
  Chrome, deterministic views: front, both yaws via camera orbit, close-up,
  two flow frames) and `score.mjs` (dependency-free PNG decoding; metrics
  for glyph legibility, silhouette coverage per view, and flow liveness).
- Calibrated `baseline.json` and pass/warn/fail cutoffs; report written to
  `tools/evals/out/report.json`.
- `bun run eval` script; demo-only `window.__hologlyphEngine` hook in
  `demo/main.ts` for posing.
- AGENTS.md: eval documented as part of the pre-merge verification chain
  for visual work.

## Out of scope

- No src/ runtime changes.
- No CI wiring (eval needs a live dev server; it stays a local gate).
- Eye-occlusion metric (judged too fragile; documented in the README).
