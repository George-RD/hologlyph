# Implementation notes

## Deviations and discoveries

- The plan scoped dropping only M_EyeOcclusion. The aperture oracle still
  failed on vertical offsets after that drop; a per-group ray-triangle probe
  on the source OBJ showed four stacked M_EyeLashes cards crossing the
  aperture above and below centre (M_Face never appeared in the first four
  hits, so no lid skin was implicated). Lashes were added to the drop set on
  that evidence. M_EyeBlend and M_LacrimalFluid stay.
- A geometric radial cutout (distance to eye centre) CANNOT discriminate the
  membrane from the eyelids: lids hug the eyeball at almost the same radius.
  The lab's earlier aperture-mask workaround ate lid skin (owner screenshot).
  The topological material-group boundary is the correct discriminator; the
  lab workaround now defaults to 0 and is superseded.
- Raycasting a loaded SkinnedMesh in vitest requires skeleton.update() after
  updateMatrixWorld(true); boneMatrices are otherwise zeroed and every vertex
  collapses to the origin (false RED).
- Blink verification in the lab could not pin morph influences from outside:
  the frame loop eases exp_blink toward its own target every frame. Added a
  deterministic "blink hold" slider (lab-only) instead of chasing stochastic
  idle blinks; also proved closure headlessly (blink=1 flips the central ray's
  first hit from eye_sclera to bust lid skin).
- Shipped GLB shrank 1.03 MB -> 1010 KB from the dropped face groups.
- cairn hook required the new research note to carry a non-empty sources list
  with a conformant source artefact (file/verification/type fields;
  `verified` additionally demands sha256, so the session-evidence source is
  `unverified`).
