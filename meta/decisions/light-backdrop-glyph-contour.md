---
id: dec.light-backdrop-glyph-contour
nodes:
  - hologlyph.runtime.shaders
status: accepted
date: 2026-09-15
---
# Light backdrops route contour through glyphs

## Context

`dec.glass-backdrop-adaptive` made backdrop luminance change glyph ink, glow, opacity and rim response while preserving the approved dark-page look. On a white host page the thickness and surface-opacity terms are now visually dominant: the head reads as a grey shaded mesh with text printed over it.

The owner wants the contour to remain text-led. Bright-background adaptation should change the colour and coverage of the glyph field rather than reveal a separately shaded surface underneath it.

## Decision

Keep `inkMix` as the smooth dark-to-light adaptation signal. At `inkMix = 0`, retain the existing dark-background alpha path. As `inkMix` rises, route feature opacity, Fresnel coverage, mid-tone reinforcement and Beer-Lambert thickness through sampled glyph luminance. Thickness can strengthen glyph coverage in thick regions, but must not fill the spaces between glyphs on a fully light backdrop.

The colour path remains backdrop-adaptive dark ink on bright pages. The change is where contour coverage is spent, not a new theme or a second material.

## Consequences

- The approved dark-page look remains the reference and should not move.
- White and bright pages should stay visible between glyphs instead of exposing a grey shell.
- Mid-tone pages interpolate between the two behaviours rather than switching modes.
- Feature and thickness cues remain available, but they increase glyph presence instead of painting solid facial regions.
- The existing transparent canvas, host background detection and public `HeadConfig.skin.backdrop` surface stay unchanged.
