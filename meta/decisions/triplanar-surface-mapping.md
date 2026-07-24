---
id: dec.triplanar-surface-mapping
nodes:
  - hologlyph.runtime.shaders
status: accepted
date: 2026-07-18
informed_by:
  - res.rendering-stack
related:
  - dec.renderer-posture
---

# Triplanar Surface Mapping

## Context

The ratified frontal planar projection keeps the glyph grid continuous, but
stretches glyphs into horizontal streaks on cheek and side surfaces at grazing
angles. Authored UV sampling was evaluated first on the shipped bust. Across
15,725 bust triangles, UV-area to object-area density had a p10 of 0.0501, a
median of 0.3146, and a p90 of 1.2488, a 24.9x p90/p10 spread. That uneven
texel density, plus separate islands for face and non-face surfaces, would
make character scale inconsistent and risk row-flow seams.

## Decision

Use bind-space triplanar projection with normal-weighted coordinate interpolation for the
skin shader. Interpolate projection coordinates across axis planes weighted by absolute
bind-pose normal components raised to a configurable sharpness exponent (default 5.5),
sampling the text skin once per fragment. Keep authored UVs out of the runtime text path.

## Rationale

Triplanar mapping removes grazing-angle stretch without inheriting the measured
UV density variation or island seams. Bind-pose positions and normals keep the
mapping attached during head rotation, while blending makes transitions
continuous. A single texture sample at the interpolated coordinate preserves
legible glyphs across the full bust without blending multiple letterforms.
The prior planar decision is superseded only for runtime
sampling; the continuous GPU canvas and row-flow architecture remain intact.

## Consequences

The shader performs one texture lookup per fragment using interpolated projection coordinates.
Row flow uses bind-pose coordinates so content moves smoothly without detaching from the skin.
Interpolating sample coordinates before texture lookup removes cross-fading between multiple
letterforms and reduces blend-zone ghosting at grazing angles while preserving continuous text coverage. The authored
UV layout remains available for asset tooling but is not part of the runtime contract.
