# Implementation notes

## 2026-09-15 owner feedback

On a white host background the head reads as a shaded grey bust with glyphs laid over it. The intended direction is the opposite: the glyph field should carry the contour, with backdrop adaptation changing glyph colour and coverage rather than painting the mesh surface.

The current shader has three light-background failure paths:

1. `inkMix` changes the sampled glyph colour but does not change alpha routing.
2. Beer-Lambert `bodyShare` fills the gaps between glyphs according to mesh thickness. That was unobtrusive on the approved dark page, but becomes a grey surface on white.
3. Feature opacity, Fresnel opacity and the mid-tone opacity floor also add coverage independently of the glyph sample.

The fix should preserve the dark path at `inkMix = 0`. As adaptation moves towards ink, those same contour signals should increasingly modulate sampled glyph coverage. Thickness should make glyphs more present in thick regions, not fill the gaps between them. The light path should therefore remain recognisably the same head without acquiring an opaque-looking skin.

Verification needs the existing dark, mid, light and brand backdrop browser smoke, not only the default dark visual evaluation.
