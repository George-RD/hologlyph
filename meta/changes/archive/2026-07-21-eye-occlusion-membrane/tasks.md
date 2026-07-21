# Tasks

- [x] Failing test: no bust vertices inside the forward aperture cap of either eyeball (raycast oracle; RED reproduced "got bust" at dead centre)
- [x] build-bust.ts: skip M_EyeOcclusion faces during assembly (named constant + rationale)
- [x] Also drop M_EyeLashes: source ray-triangle probe showed four stacked lash cards occluding the aperture above/below centre; under a text skin they render as text wisps. M_EyeBlend and M_LacrimalFluid retained (never occlude; blend seals the lid seam)
- [x] Regenerate assets/hologlyph-bust.glb via build + optimize (--simplify 0.5); 1010 KB, budget OK, byte-determinism regen test green
- [x] Full gate chain: tsc, vitest (228), build, lint, cairn hook all (exit 0)
- [x] Visual smoke: lab with membrane cutout OFF shows iris/pupil through the real lid opening at socket mask 1; blink closes fully (blink-hold slider capture + headless raycast closure proof: open ray hits eye_sclera first, blink=1 ray hits bust lid first)
