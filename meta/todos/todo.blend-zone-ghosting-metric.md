---
node: hologlyph.runtime.shaders
status: done
created: 2026-07-18
---

# Blend Zone Ghosting Metric

Triplanar sampling cross-fades two glyph sets where axis weights are
similar (roughly 45 degree surfaces: cheek-to-temple, jaw corners),
which reads as faint doubled or ghosted glyphs. This is a known,
accepted trade-off of the triplanar decision
(meta/decisions/triplanar-surface-mapping.md), but the visual eval
harness does not currently score it, so a regression that widens the
blend band would pass unnoticed.

Task, in two parts:

1. Add a blend-zone ghosting metric to tools/evals/score.mjs: sample a
   band of pixels where the dominant triplanar weight is weakest (can be
   approximated from a dedicated capture pose at 45 degree yaw) and score
   double-edge energy versus the calibrated baseline.
2. If the metric shows the band is objectionably wide, sharpen the
   weight exponent (squared today) or add a bias so one axis wins sooner,
   trading a harder seam for less ghosting; recalibrate the baseline and
   document in a decision note chained to the triplanar decision.
