# Design

The discriminator for "skin that wrongly spans the eye opening" is
topological, not geometric: ICT-FaceKit names its auxiliary eye shells as OBJ
material groups (M_EyeOcclusion, M_EyeBlend, M_LacrimalFluid, M_EyeLashes).
Distance-to-eye-centre cannot work because the eyelids hug the eyeball at the
same radius as the membrane (proven in the lab: a radial cutout eroded lids).

build-bust.ts gains a DROPPED_MATERIALS set consulted during face assembly:
triangles whose group is dropped are skipped before de-indexing, so their
vertices never enter the glTF, morph targets, or UV atlas. Dropped groups:
M_EyeOcclusion (raycast through the aperture hits it before the sclera, dead
centre included) and M_EyeLashes (source ray-triangle probe: four stacked
cards occlude above/below centre; unrenderable as lashes under a text skin).
M_EyeBlend and M_LacrimalFluid are retained: they never occlude the aperture
and blend seals the lid-eyeball seam.

Oracle: test/asset-bust.test.ts raycasts through each eye aperture (centre
plus four offsets) on the shipped GLB; the first hit must be an eye
primitive. Blink integrity is covered by the existing non-zero-delta morph
test plus a closure raycast proof recorded in implementation-notes.
