# Design: glass-backdrop-adaptive

## Approach

Two independent mechanisms, both driven from `HeadConfig`.

1. Glass response (view-dependent, backdrop-independent). One fresnel term
   `pow(1 - dot(normalView, viewDir), fresnelPower)` feeds three places: an
   opacity boost at grazing angles (glass thickens at the silhouette and the
   back of the head stops showing through), the rim emissive, and the amount of
   refraction applied to the sampled glyph coordinates. A Blinn lobe against the
   scene key light adds a specular highlight tinted by `glass.tint`.

2. Backdrop adaptation (colour-dependent). `adaptToBackdrop(color, adapt)` in
   `src/shaders/glass.ts` is pure: it linearises the backdrop hex, takes the
   relative luminance, and returns `inkMix`, `inkColor`, `glowScale`,
   `opacityFloor`, and `rimColor`. The VFX engine writes those five results into
   uniforms whenever the config changes. A dark backdrop returns the identity
   adaptation, so the owner-approved look is untouched where it was approved.

The renderer stops painting a background so the host page composites through
the head; `src/core/backdrop.ts` walks the host element's ancestors for the
first opaque computed background colour and feeds it back through
`setHeadConfig` when `skin.backdrop.auto` is true.

## Changes

ADDED:
- `src/shaders/glass.ts`: pure colour maths (`parseHexColor`, `srgbToLinear`,
  `backdropLuminance`, `adaptToBackdrop`) and the `BackdropAdaptation` type.
- `src/core/backdrop.ts`: `resolveBackdropColor(element, fallback)` walk, which
  crosses shadow boundaries through `ShadowRoot.host` so a head nested in
  another component still sees the app background.
- `SkinGlassConfig` and `SkinBackdropConfig` in `src/contracts.ts`, reachable at
  `HeadConfig.skin.glass` / `HeadConfig.skin.backdrop`.
- `test/shaders-glass.test.ts`, `test/core-backdrop.test.ts`, plus blueprint
  path claims for both.
- `tools/smoke/backdrop-shot.mjs`: captures the engine over dark, mid, light,
  and brand-colour host pages.

MODIFIED:
- `src/shaders/materials.ts`: glass and adaptation uniforms, fresnel opacity and
  refraction, specular lobe, adaptive glyph ink and rim colour.
- `src/shaders/index.ts`: bind the new uniforms, recompute the adaptation on
  `setHeadConfig`.
- `src/renderer/renderer-host.ts`: transparent clear, no scene background.
- `src/core/engine.ts`: auto-detect the host backdrop on mount.
- `test/shaders.test.ts`: default-config pin extended with the new blocks.

REMOVED:
- The opaque `scene.background` colour in the renderer host.

RENAMED:
- None.
