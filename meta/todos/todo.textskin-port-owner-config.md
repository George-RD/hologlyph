---
node: hologlyph.runtime.shaders
status: open
created: 2026-07-21
---

# Port the feature-shading system into src/ seeded by the owner config

The feature-shading lab (demo/index.html (the lab/landing page)) carries the whole
approved shading system as demo scaffolding: baked vertex masks (aLips with
mouth-line falloff, aEyelid, aBrow, aCavity, aNose, aSocket), zone opacity
boosts, socket shadow/mask, lip/brow hue terms, tone controls, eye
micro-text material (sclera rings + iris polar flow), glyph-fit uniforms,
and blink hold.

Do it properly: bake masks in buildLoadedAvatar, expose the uniforms behind
a typed head-config surface on buildSkinMaterial/contracts, TDD with pins
seeded from meta/sources/src.owner-approved-look-2026-07-21.md (the
ratified defaults), eval baseline recalibrated once against the accepted
look. Requires a decision artefact for the config surface shape.
