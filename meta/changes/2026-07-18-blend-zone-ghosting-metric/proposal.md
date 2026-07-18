# Proposal: 2026-07-18-blend-zone-ghosting-metric

## Motivation

The triplanar blend zone can show doubled glyph edges near a 45-degree
camera orbit, but the visual evaluation harness currently scores no direct
ghosting signal. A regression that widens the blend band could therefore pass
without detection.

## Scope

- Capture a deterministic `yaw-0.785.png` camera-orbit view.
- Score doubled-edge (run-aware twin-fraction) self-similarity on bright glyph
  pixels inside the head silhouette; higher is worse.
- Exercise the metric with a duplicate-and-offset in-memory negative control.
- Calibrate the accepted-build baseline and document the result.

## Out of scope

- Shader changes or triplanar weight-exponent tuning.
- Changes to runtime rendering behaviour.
