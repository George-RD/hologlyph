# Morph authoring research: getting hologlyph's canonical blendshapes onto a head mesh

**Status:** research synthesis for `meta/changes/v2-embodiment`
**Scope:** how to land the canonical morph targets on a head asset that may ship with zero, ARKit-52, or Oculus-15 blendshapes. Asset sourcing (which head to buy/use) is owned by a sibling. Runtime lip-sync logic is already implemented.

> **Count correction.** The brief says "24 canonical morphs". `src/contracts.ts` actually defines **27**: `RIG_VISEME_MORPHS` (15) plus `RIG_EXPRESSION_MORPHS` (12, which includes `jaw_open` and `mouth_round`). This synthesis targets all 27.

---

## 1. What the evidence agrees on

- A head mesh with **Oculus-15 visemes** is the easiest source: the names map almost one-to-one to hologlyph's viseme vocabulary, needing only a prefix rename (`sil -> viseme_sil`, `PP -> viseme_pp`, etc.).
- A head mesh with **ARKit-52** shapes is the most common "free/CC0" source (VRoid, Ready Player Me, MakeHuman exports). ARKit has no direct viseme set, so hologlyph's 15 visemes must be built as **weighted composites** of ARKit shapes (one to three source shapes each).
- A head mesh with **zero shapes** needs a donor. The strongest open route is to generate a CC0 human base with MPFB2 (which ships ARKit face units and viseme shape keys) and transfer its shapes onto the stylised target via Surface Deform or the ShapeKeyWrap add-on.
- `validateRig` (in `src/asset/rig.ts`) is the acceptance oracle: it flags missing morphs and bones but still loads, so a partial rig degrades gracefully. The pipeline goal is `conformant === true`.

## 2. What is contested

- Whether a **pure glTF-Transform script** can do the whole job. It can rename targets and combine existing vertex deltas into new targets, but it cannot invent geometry. So it is sufficient when the source mesh already carries the needed shapes; it is not a substitute for Blender when shapes are missing.
- Whether **procedural generation** is viable as a primary route. It is fine for a placeholder `jaw_open` and simple lip stretches, but it cannot model tongue, teeth, lip contact, or asymmetry. Treat it as a safety net, not the main pipeline.
- Whether **open-source auto-generators** are drop-in. The deformation-transfer repo is MIT but depends on Wrap3D (commercial non-rigid registration); the ARKit Creator add-on is MIT but needs a pre-posed rig. Neither is a one-click solution for an arbitrary head.

## 3. Route comparison

| Route | Works when | Reproducibility | Quality floor (stylised) | Effort |
|---|---|---|---|---|
| A. glTF-Transform remap/rename | Source already has the shapes, only names/combinations differ | Very high (committed Node script) | High if donor fits | Low to medium |
| B. Blender authoring + donor transfer | Source has zero/partial shapes | Medium (Blender file + script) | Highest (per-morph sculpt) | Medium to high |
| C. Fully procedural fallback | Emergency or very stylised mask | High (script) | Low to medium | Low |
| D. Open-source auto-generators | Arbitrary head, full ARKit set | Medium to low (needs registration) | High if it succeeds | Medium |

**Recommendation:** prefer Route A when a donor mesh carries shapes; otherwise Route B with a donor head plus Surface Deform / ShapeKeyWrap; keep Route C as the fallback for the last missing shapes. Route D is useful research but not a reliable drop-in.

## 4. Recommended pipeline

```
1. Source-shape convention
   - Prefer a head with ARKit-52 or Oculus-15 blendshapes (CC0/CC-BY).
   - If zero shapes: generate a CC0 donor with MPFB2, or use Apple ARKit
     reference meshes, then transfer onto the target.

2. Transform (Blender + glTF-Transform)
   - Blender: import source (+ donor if transferring); bind donor via
     Surface Deform / ShapeKeyWrap; rename or composite shape keys to the
     27 canonical names; sculpt corrections for donor-less morphs; export
     glTF/GLB with shape keys enabled.
   - Node script (@gltf-transform/core): verify mesh.extras.targetNames
     equals the canonical list; drop non-canonical targets; ensure indices
     align with primitive.listTargets().

3. Validate
   - Run validateRig(root) until missingMorphs == [] and missingBones == [].

4. Optimize
   - Run tools/asset-pipeline/optimize.ts, then re-run validateRig because
     aggressive Meshopt/Draco compression can strip or damage morph targets.
```

### Tooling with licences

| Tool | Licence / state | Role | Link |
|---|---|---|---|
| `@gltf-transform/core` | MIT, active | GLB read/write, rename/combine morph targets | https://gltf-transform.dev/ |
| ShapeKeyWrap | GPL-3.0, active | Automates Surface-Deform bind/capture/rename | https://github.com/MykytaPetrenko/ShapeKeyWrap |
| ARKit Creator Blender Addon | MIT, recent (2024/25) | Bakes 52 ARKit poses from a facial rig | https://github.com/tsikerdekis/ARKit-Creator-Blender-Addon |
| MPFB2 | GPL-3.0 code, **CC0 output**, active | Human base mesh + 34 bundled FACS expression units (correction 2026-07-13, res.head-asset-alternatives: ARKit units and visemes are NOT bundled; they resolve from a separately installed target pack, licence to re-verify) | https://github.com/makehumancommunity/mpfb2 |
| deformation_transfer_ARkit_blendshapes | MIT, research | Transfers 52 ARKit shapes from reference meshes | https://github.com/vasiliskatr/deformation_transfer_ARkit_blendshapes |
| Faceit | Commercial (~$99) | Semi-auto ARKit/FACS shape keys (not open source) | Blender Market |
| ARKitBlendshapeHelper | No licence, stale ~2023 | **Avoid** for a clean repo | - |

## 5. Mapping tables

### 5.1 Oculus-15 -> hologlyph visemes (direct rename)

| OVR source | Hologlyph name |
|---|---|
| `sil` | `viseme_sil` |
| `aa` | `viseme_aa` |
| `E` | `viseme_ee` |
| `I` | `viseme_ih` |
| `O` | `viseme_oh` |
| `U` | `viseme_ou` |
| `PP` | `viseme_pp` |
| `FF` | `viseme_ff` |
| `TH` | `viseme_th` |
| `DD` | `viseme_dd` |
| `kk` | `viseme_kk` |
| `CH` | `viseme_ch` |
| `SS` | `viseme_ss` |
| `nn` | `viseme_nn` |
| `RR` | `viseme_rr` |

Reference: Meta Horizon OVRLipSync viseme reference (https://developers.meta.com/horizon/documentation/unity/audio-ovrlipsync-viseme-reference/).

### 5.2 ARKit-52 -> hologlyph visemes (composite)

Weights are starting points and need per-model tuning.

| Hologlyph target | Approximate ARKit sources |
|---|---|
| `viseme_sil` | neutral / zero, or `mouthClose` + `mouthPressLeft`/`mouthPressRight` |
| `viseme_aa` | `jawOpen` 1.0, `mouthStretchLeft`/`mouthStretchRight` 0.3 |
| `viseme_ee` | `jawOpen` 0.5, `mouthStretchLeft`/`mouthStretchRight` 0.8 |
| `viseme_ih` | `mouthStretchLeft`/`mouthStretchRight` 1.0, slight `jawOpen` |
| `viseme_oh` | `mouthFunnel` 1.0, `jawOpen` 0.5 |
| `viseme_ou` | `mouthPucker` 1.0, `jawOpen` 0.4 |
| `viseme_pp` | `mouthClose` 1.0, `mouthPressLeft`/`mouthPressRight` 1.0 |
| `viseme_ff` | `mouthFrownLeft`/`mouthFrownRight` 1.0, `mouthLowerDownLeft`/`mouthLowerDownRight` 0.4 |
| `viseme_th` | `jawOpen` 0.6, `mouthShrugLower` 0.6, optional `tongueOut` |
| `viseme_dd` | `jawOpen` 0.5, `mouthDimpleLeft`/`mouthDimpleRight` 0.5 |
| `viseme_kk` | `jawOpen` 0.5, `mouthStretchLeft`/`mouthStretchRight` 0.4 |
| `viseme_ch` | `mouthFunnel` 0.7, `mouthPucker` 0.7 |
| `viseme_ss` | `mouthSmileLeft`/`mouthSmileRight` 0.8, slight `jawOpen` |
| `viseme_nn` | `jawOpen` 0.3, `mouthDimpleRight` 0.5 |
| `viseme_rr` | `mouthPucker` 0.8, `jawOpen` 0.3 |

ARKit reference: Apple ARFaceAnchor.BlendShapeLocation (https://developer.apple.com/documentation/arkit/arfaceanchor/blendshapelocation) and arkit-face-blendshapes.com (https://arkit-face-blendshapes.com/).

### 5.3 ARKit-52 -> hologlyph expressions / auxiliary morphs

| Hologlyph target | ARKit sources | Donor quality |
|---|---|---|
| `exp_happy` | `mouthSmileLeft`/`mouthSmileRight`, `cheekSquintLeft`/`cheekSquintRight` | composite, may need sculpt |
| `exp_sad` | `mouthFrownLeft`/`mouthFrownRight`, `browInnerUp` | composite, may need sculpt |
| `exp_surprised` | `browInnerUp`, `eyeWideLeft`/`eyeWideRight`, `jawOpen` | composite, may need sculpt |
| `exp_angry` | `browDownLeft`/`browDownRight`, `mouthFrownLeft`/`mouthFrownRight` | composite, may need sculpt |
| `exp_relaxed` | none (subtle neutral) | **no donor, sculpt or zero** |
| `exp_blink` | `eyeBlinkLeft` + `eyeBlinkRight` | direct |
| `exp_blink_l` | `eyeBlinkLeft` | direct |
| `exp_blink_r` | `eyeBlinkRight` | direct |
| `exp_brow_up` | `browInnerUp`, `browOuterUpLeft`/`browOuterUpRight` | direct/composite |
| `exp_brow_down` | `browDownLeft`/`browDownRight` | direct |
| `jaw_open` | `jawOpen` | direct |
| `mouth_round` | `mouthFunnel` + `mouthPucker` blend | composite, may need sculpt |

## 6. Morphs with no clean donor (need sculpt or procedural fallback)

- `exp_relaxed` -- ARKit has no "subtle neutral" shape; it is the absence of expression.
- `viseme_sil` -- can be the zero/basis state; if the GLB must contain it explicitly, duplicate the basis mesh (zero deltas).
- Stylised `exp_happy`, `exp_sad`, `exp_angry`, `exp_surprised` -- ARKit components are anatomical and may look uncanny on a stylised head; expect a sculpt pass.
- `mouth_round` -- not a single ARKit shape; blend `mouthFunnel` + `mouthPucker` and tweak by hand.

## 7. Notes on glTF-Transform feasibility

A pure `@gltf-transform/core` script can:

- **Rename** morph targets by rewriting `mesh.extras.targetNames` (the glTF spec has no native target-name field; Blender/three.js use this extra). See three.js morph naming discussion: https://github.com/mrdoob/three.js/issues/19357.
- **Combine** existing targets into new canonical targets by reading each `PrimitiveTarget` POSITION (and optionally NORMAL/TANGENT) accessor, computing a weighted sum, creating a new `PrimitiveTarget`, and updating `targetNames`.
- **Drop** unused ARKit targets to shrink the GLB.

It cannot create geometry from nothing, so Route A alone is insufficient when the source head has zero shapes.

## 8. Bottom line

1. Source a head with ARKit-52 or Oculus-15 shapes (CC0/CC-BY).
2. Canonicalise with a committed glTF-Transform script: rename OVR shapes, or composite ARKit shapes into the 15 visemes + 12 expressions.
3. When the source has no shapes, use Blender + ShapeKeyWrap with an MPFB2 CC0 donor.
4. Sculpt the donor-less morphs rather than generating them procedurally.
5. Keep procedural generation as a safety net only.
6. Run `validateRig` after every export and store the transform script under `tools/asset-pipeline/` for reproducibility.
