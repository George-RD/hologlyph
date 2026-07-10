---
id: res.morph-authoring
nodes: [hologlyph.asset.pipeline, hologlyph.asset.loader, hologlyph.runtime.motion]
sources: [src.v2-research-agents]
date: 2026-07-10
---

Correction to the change brief: `src/contracts.ts` defines 27 canonical morphs (RIG_VISEME_MORPHS 15 + RIG_EXPRESSION_MORPHS 12, which includes `jaw_open` and `mouth_round`), not 24.

Agreed: a source mesh with Oculus-15 visemes needs only a prefix rename (`PP -> viseme_pp`); a mesh with ARKit-52 shapes (the most common CC0 case, including MakeHuman faceunits01) needs the 15 visemes built as weighted composites of one to three ARKit shapes each; a mesh with zero shapes needs a donor transfer (MPFB2 donor via Blender Surface Deform / ShapeKeyWrap). `validateRig` in `src/asset/rig.ts` is the acceptance oracle and degrades gracefully, so a partial rig loads while the pipeline converges on `conformant === true`.

Contested: whether a pure glTF-Transform script suffices (it can rename targets via `mesh.extras.targetNames` and composite existing vertex deltas into new targets, but cannot invent geometry); whether procedural generation is viable as a primary route (fine for `jaw_open`-class shapes, cannot model tongue, teeth, or lip contact); whether open-source auto-generators are drop-in (the MIT deformation-transfer repo depends on commercial Wrap3D; the ARKit Creator add-on needs a pre-posed rig).

Route comparison: (A) glTF-Transform remap/rename, very high reproducibility, works when shapes exist; (B) Blender authoring plus donor transfer, highest quality, medium reproducibility; (C) fully procedural, safety net only; (D) auto-generators, not reliable drop-ins.

Recommended pipeline: source a head carrying ARKit-52 or Oculus-15 shapes; canonicalise with a committed Node script under `tools/asset-pipeline/` using `@gltf-transform/core` (MIT) that renames or composites shapes into the 27 canonical names and drops non-canonical targets; where shapes are missing, transfer from an MPFB2 CC0 donor in Blender (ShapeKeyWrap, GPL-3.0, tool-not-bundled); sculpt donor-less morphs; re-run `validateRig` after `optimize.ts` because aggressive compression can damage morph targets.

Key mappings (full tables in the change specs): Oculus-15 is a direct rename to the 15 viseme names. ARKit composites, e.g. `viseme_aa` = jawOpen 1.0 + mouthStretchL/R 0.3; `viseme_ou` = mouthPucker 1.0 + jawOpen 0.4; `viseme_pp` = mouthClose + mouthPressL/R; `exp_blink_l/r` = eyeBlinkLeft/Right direct; `jaw_open` = jawOpen direct. Morphs with no clean ARKit donor, needing sculpt or zero-delta: `exp_relaxed` (absence of expression), `viseme_sil` (basis duplicate), `mouth_round` (funnel+pucker blend), and stylised `exp_happy/sad/angry/surprised` (anatomical composites may look uncanny on a stylised head).

References: Meta OVRLipSync viseme reference (https://developers.meta.com/horizon/documentation/unity/audio-ovrlipsync-viseme-reference/), Apple ARFaceAnchor.BlendShapeLocation (https://developer.apple.com/documentation/arkit/arfaceanchor/blendshapelocation), glTF-Transform (https://gltf-transform.dev/), ShapeKeyWrap (https://github.com/MykytaPetrenko/ShapeKeyWrap), MPFB2 (https://github.com/makehumancommunity/mpfb2), three.js targetNames discussion (https://github.com/mrdoob/three.js/issues/19357).
