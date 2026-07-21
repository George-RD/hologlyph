# Design

Two asset-boundary decisions and one pipeline policy:

1. Anatomy stays, junk goes. Auxiliary ICT face shells are classified by
   what they can be under a text skin: M_EyeOcclusion, M_EyeLashes, and
   M_LacrimalFluid can only render as text-carrying cards occluding the
   eyeball (dropped in build-bust); M_EyeBlend is the caruncle, real
   anatomy, so it ships as the separately-materialised eye_trim primitive
   (mouth_interior pattern) that the runtime styles or hides.

2. eye_trim carries the full 27-target morph set because glTF requires
   uniform target counts across a mesh's primitives and it must move with
   blinks.

3. Quantisation policy: base POSITION stays float32; TEXCOORD/JOINTS/
   WEIGHTS/COLOR and all morph-target deltas quantise; EXT_meshopt
   compression (FILTER) recovers the size. Rationale and the empirical
   bisect are documented inline in optimize.ts; delivery is 1.07 MB against
   the 1.5 MB budget.
