# Design: 2026-07-18-text-skin-embodiment-fixes

## Approach

Keep the text content on one shared CanvasTexture and sample it in the TSL
material from bind-pose position and normal attributes. Three axis projections
are sampled and blended by squared absolute bind normal components. Each axis
uses the existing row-staggered horizontal flow, so content advances without
moving the mapping off the surface. Glyph opacity carries sampled luminance;
analytic key and fill shading plus the fresnel rim provide the visible surface
cue while the base opacity remains near zero.

The eye meshes remain authored geometry. The shell renders first with depth
writing, and transparent front-sided eye materials render after it with depth
testing and depth writing so interior and far-side eye geometry is hidden.

## Changes

ADDED:
- `meta/decisions/triplanar-surface-mapping.md` records the accepted mapping
  change and the measured authored UV density spread.
- Pure triplanar and row-flow mapping tests.

MODIFIED:
- `src/shaders/materials.ts` for bind-space triplanar projection, row flow,
  shading, filtering, and depth settings.
- `src/text-skin/grid.ts` and `src/text-skin/index.ts` for readable texture
  density and default GPU flow.
- `src/core/engine.ts` for eye depth ordering.
- `test/shaders.test.ts` for mapping and material contracts.

REMOVED:
- Runtime dependence on authored UV sampling for text skin projection.

RENAMED:
- None.
