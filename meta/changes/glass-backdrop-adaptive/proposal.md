# Proposal: glass-backdrop-adaptive

## Motivation

The head currently renders over an opaque dark scene background, so on any host
page it is a dark rectangle rather than a floating head, and the approved
emissive look only works against darkness. The owner wants the head to read as
glass that sits well on arbitrary website backgrounds and colours.

## Scope

- Transparent renderer output so the host page is visible through the head.
- A `skin.glass` config block: fresnel edge thickening, key-light specular,
  grazing-angle refraction of the sampled glyph coordinates.
- A `skin.backdrop` config block plus a pure adaptation function mapping the
  backdrop colour to glyph ink, emissive gain, opacity floor, and rim colour.
- Engine auto-detection of the host page background on mount.
- Tests for the pure adaptation and the new uniform bindings, plus a browser
  smoke capture over dark, mid, and light pages.

## Out of scope

- Opaque-core shell and caruncle-size controls: still demo-only.
- Chromatic dispersion at the rim (dropped on cost, see the decision).
- Any change to motion, speech, behaviour, or the asset pipeline.
