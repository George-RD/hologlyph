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

Use bind-space triplanar text sampling with normal-weighted blending for the
skin shader. Blend the three axis projections by the squared absolute bind-pose
normal components, and apply the existing staggered row flow independently to
each projection. Keep authored UVs out of the runtime text path.

## Rationale

Triplanar mapping removes grazing-angle stretch without inheriting the measured
UV density variation or island seams. Bind-pose positions and normals keep the
mapping attached during head rotation, while blending makes transitions
continuous. The extra texture samples are accepted because the material
already uses one shared texture and the result preserves legible glyphs across
the full bust. The prior planar decision is superseded only for runtime
sampling; the continuous GPU canvas and row-flow architecture remain intact.

## Consequences

The shader performs three texture samples and normal-weighted blending per
fragment. Row flow must remain axis-local and use bind-pose coordinates so
content moves without detaching from the skin. Projection seams are replaced
by soft blend zones, but diagonal glyphs can cross-fade near equal axis
weights. The authored UV layout remains available for asset tooling but is not
part of the runtime contract.
