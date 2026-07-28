---
id: dec.glass-backdrop-adaptive
nodes:
  - hologlyph.runtime.shaders
  - hologlyph.runtime.core
  - hologlyph.runtime.renderer
status: accepted
date: 2026-07-25
informed_by: [src.owner-approved-look-2026-07-21]
---
# Backdrop-adaptive glass skin

## Context

The head is a translucent text skin rendered over an opaque scene background
(`0x05070d`), so the canvas is a dark rectangle on every host page. The
approved look depends on that dark backdrop: emissive glyphs read as glow only
against darkness, and on a light or mid-tone page the same values would read as
a washed-out haze. `dec.head-config-surface` deliberately kept background,
opaque-core, and day/night controls demo-only "until separately approved".

The owner has now asked for the head to read as glass that works against
arbitrary host-page backgrounds and colours. That is the separate approval, and
it needs two things the lab prototypes never covered: the page must actually be
visible through the head, and the shading must respond to whatever colour is
behind it.

## Decision

The renderer clears to transparent (no scene background) so the host page shows
through the head, and the skin material gains two config blocks under
`HeadConfig.skin`:

- `glass`: view-dependent glass response. Fresnel edge thickening, a Blinn
  specular lobe from the key light, and a grazing-angle refraction offset that
  displaces the sampled glyph coordinates only where the surface turns away.
- `backdrop`: the host page colour plus an `adapt` strength and an `auto` flag.
  On mount the engine walks the host element's ancestors for the first opaque
  computed background colour and feeds it back through `setHeadConfig`.

Adaptation is a pure function of the backdrop colour (`src/shaders/glass.ts`):
backdrop luminance drives a glyph ink mix, an emissive gain scale, a mid-tone
opacity floor, and the fresnel rim colour. On a dark backdrop the adaptation is
the identity, so the owner-approved look is unchanged where it was approved.

## Rationale

An opaque core plus a translucent text shell (the other candidate from
`todo.background-adaptive-look`) fixes the see-through problem by hiding the
page, which is the opposite of glass. Fresnel edge thickening solves the same
grazing-angle back-of-head readability without killing the transparency, and it
is the cue that actually reads as glass rather than as film.

Adaptation lives in a pure function rather than in the shader so it is testable
without a GPU and so hosts can override the result by setting the backdrop
colour explicitly. Keeping the backdrop inside `HeadConfig` avoids a new
contract method: `setHeadConfig({ skin: { backdrop: { color } } })` is the whole
surface, and the web component inherits it through auto-detection.

## Consequences

- Supersedes the demo-only scope clause in `dec.head-config-surface` for
  background controls; opaque-core and caruncle-size controls stay demo-only.
- Hosts that relied on the canvas painting its own dark rectangle now see their
  own page behind the head. Setting `skin.backdrop.auto` to false and passing a
  colour restores a fixed look, but nothing repaints the canvas opaque.
- Eval captures now composite against the demo page CSS background, which is
  the same `#05070d`, so the silhouette clear colour is unchanged.
- Chromatic dispersion at the rim was considered and dropped: it costs two extra
  texture samples per fragment for an effect that is invisible at the shipped
  glyph density.
- Blueprint path claims added for the two new test files:
  `test/core-backdrop.test.ts` on `hologlyph.runtime.core` and
  `test/shaders-glass.test.ts` on `hologlyph.runtime.shaders`. No new module,
  container, or dependency edge.
