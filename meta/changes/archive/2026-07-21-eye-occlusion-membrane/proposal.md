# Remove the eye occlusion membrane from the shipped bust

## Why

The ICT-FaceKit topology closes each eye opening with an auxiliary shadow
card (`M_EyeOcclusion`) that hugs the eyeball across the palpebral aperture.
build-bust.ts folds it into the bust primitive with the head material, so the
text skin renders across the opening and any opacity boost paints skin over
the eyeball (raycast-verified: every ray through the aperture hits bust
geometry 1-13 mm in front of the sclera, including dead centre). Under a text
skin the card is pure damage: the eyes can never read as eyes.

## What

Drop the `M_EyeOcclusion` face group in build-bust.ts assembly, regenerate
the shipped GLB, and pin the fix with a geometry oracle: no bust vertex may
sit inside the forward aperture cap in front of either eyeball. The other
auxiliary groups (`M_EyeBlend`, `M_LacrimalFluid`, `M_EyeLashes`) are
evaluated separately on visual evidence before any further removal, since
`M_EyeBlend` seals the lid-eyeball seam and lashes carry blink deltas.

## Affected nodes

- hologlyph.asset.pipeline (build-bust.ts)
- assets/hologlyph-bust.glb (regenerated)
- test/asset-bust.test.ts (new oracle)
