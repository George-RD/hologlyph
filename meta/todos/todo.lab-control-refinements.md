---
node: hologlyph.runtime.shaders
status: open
created: 2026-07-21
---

# Lab control refinements (owner round, 2026-07-21)

Owner feedback on the current control set:

1. Caruncle (eye_trim): replace/augment the opacity slider with a SIZE
   control - how far the shell extends over the eyeball. Likely a shader
   cutoff along the trim primitive's lateral axis from the inner corner
   (per-vertex distance attribute baked at load), not material opacity.
2. Lips zone still shades the whole chin/mouth area rather than the
   vermilion band alone: exaggerated lipHue + low lipGate paints the chin
   red (owner screenshot, 2026-07-21). The aLips bake (viseme_pp/ou deltas
   + ellipsoidal mouth-line falloff) needs a tighter band: higher
   percentile floor, narrower vertical falloff, or a curvature-gated lip
   edge so hue stops at the lip margin.
3. Hard-edge glyph overlaps (owner close-up): doubled letterforms with a
   sharp edge where triplanar projections cross despite sharp=5.5.
   Investigate whether the row-stagger rate discontinuity (floor(row) rate
   steps) is the visible seam, and whether a per-row blend or matched rates
   inside the blend band removes it.
