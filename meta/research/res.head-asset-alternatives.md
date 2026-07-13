---
id: res.head-asset-alternatives
nid: res.head-asset-alternatives
nodes: [hologlyph.asset.loader, hologlyph.asset.pipeline]
sources: [src.v2-research-agents]
date: 2026-07-13
---

This note de-risks the realistic head-bust direction (option B) for hologlyph v2 beyond
MakeHuman, and hands-on verifies one still-open MakeHuman claim. Surface realism is
irrelevant because the head is always covered by the dynamic text/glyph skin; what matters
is shape realism, clean quad topology, usable UVs, and morph targets. The rig contract
(`src/contracts.ts`) requires 27 morphs: 15 visemes (`RIG_VISEME_MORPHS`) plus 12
expressions (`RIG_EXPRESSION_MORPHS`). The accepted delivery target is a GLB under 1.5 MB
post-Meshopt + KTX2 (`dec.performance-budget`). The licence gate is strict: the mesh ships
inside an npm package, so the licence must survive sublicensing. Only CC0, public-domain
dedication, or an explicit no-claim licence qualifies. Non-commercial or no-sublicence
content is disqualified.

All licence claims below carry a primary-source link and are labelled VERIFIED (the primary
source was read directly, by this agent or its delegated scout) or REPORTED (secondary).

# 1. Verification of the MPFB2 "faceunits01" claim

The prior note `res.asset-sourcing.md` states MPFB2 "ships the faceunits01 set of 54 ARKit
facial units plus visemes". This was checked hands-on against the
`makehumancommunity/mpfb2` repository (default branch `master`) via the GitHub API and raw
file reads. The claim is inaccurate in two ways: the morph data is not bundled, and the count
is 52, not 54.

## 1.1 What the repo actually bundles (real, CC0, in-repo)

- Base mesh: `src/mpfb/data/3dobjs/base.obj` (the MakeHuman basemesh, quad topology).
- Facial expression units as real morph data: `src/mpfb/data/targets/expression/units/{caucasian,african,asian}/`
  with 34 `.target.gz` files per ethnicity (102 files total). Example filenames read from the
  tree:
  - `mouth-open.target.gz`, `mouth-compression.target.gz`, `mouth-pursing.target.gz`,
    `mouth-smile` style units (`mouth-corner-puller.target.gz`, `mouth-frown` via
    `mouth-depression.target.gz`)
  - `eye-left-closure.target.gz`, `eye-right-closure.target.gz`, `eye-left-slit.target.gz`
  - `eyebrows-left-up.target.gz`, `eyebrows-right-down.target.gz`, `eyebrows-left-inner-up.target.gz`
  - `nose-compression.target.gz`, `nose-left-dilatation.target.gz`
  - `neck-platysma.target.gz`
  These are FACS-like expression units, not ARKit-named and not visemes. They are genuine
  CC0 morph data shipped in the repo.

## 1.2 What is NOT bundled (names only, resolved from a separate pack)

- `src/mpfb/ui/operations/faceops/properties/faceunits01.json` is a UI boolean toggle:
  `{"type":"boolean","name":"faceunits01","description":"Load faceunits01 (ARKit face units, 52 shapes) shapekeys onto the base mesh with zero weight",...}`.
- `src/mpfb/ui/operations/exportops/properties/faceunits_arkit.json` is another boolean
  ("Load arkit-style faceunits").
- `src/mpfb/ui/operations/faceops/properties/visemes01.json` and `visemes02.json`, plus
  `src/mpfb/ui/operations/exportops/properties/visemes_meta.json` and `visemes_microsoft.json`,
  are UI/config toggles only. There are no viseme `.target.gz` files anywhere in `data/targets`
  (grep for `viseme` in `.target` paths returned zero hits).
- The actual 52 ARKit names and the viseme name lists live as Python constants in
  `src/mpfb/services/faceservice.py`:
  - `ARKIT_FACEUNITS` = 52 names (`browDownLeft` ... `tongueOut`)
  - `MICROSOFT_VISEMES` = 22 names (`aa_02` ... `y_iy_ih_ix_06`)
  - `META_VISEMES` = 15 names (`viseme_aa` ... `viseme_U`)
- The loader `FaceService.load_targets` (faceservice.py) is documented to "raise exception if
  target asset pack is not installed". `FaceService.is_faceunits01_installed()` probes
  `TargetService.target_full_path("cheekPuff")` and `set_expression()` loads each unit on demand
  via `TargetService.target_full_path(face_unit_name)`. A grep of the entire repo tree for
  `cheekPuff`, `mouthSmile`, `tongueOut`, `viseme_aa`, and `aa_02` returned no data files.
  These names resolve from a separately installed "target asset pack", not from this repo.

Conclusion: MPFB2 bundles a CC0 base mesh and 34 FACS expression units (real morph data), and
the asset licence plus the explicit no-claim-on-output clause (see 2.1) cover a redistributed
export. But the "faceunits01" 52 ARKit shapes and the Microsoft/Meta viseme sets are not in the
repo as data; they are name lists that require a separately installed pack whose licence must
be verified at download time (the MakeHuman community assets are CC0 per the project, REPORTED,
but they are not bundled here). The prior "54 ARKit units" figure is also wrong: the constant
holds 52.

# 2. Alternatives, licence-first

## 2.1 MPFB2 / MakeHuman (baseline, verified)
- Licence VERIFIED: `LICENSE.ASSETS.md` is the full CC0 1.0 Universal text. `LICENSE.md`
  section C states "The assets ... have been released under CC0 1.0 Universal." Section D
  states "the MakeHuman team makes no claim whatsoever over output such as: Exports to files
  (FBX, OBJ, DAE, MHX2...) ... We regard these things as your data." Code is GPLv3
  (`LICENSE.CODE.md`) but the mesh/asset output is CC0 with explicit no-claim. This survives
  sublicensing.
- Morphs: base mesh + 34 FACS expression units bundled (see 1.1). The 52 ARKit + viseme packs
  are separate (see 1.2).
- Topology/UV: quad basemesh; global atlas UV, face needs a dedicated re-unwrap.
- Size: pruned head-bust GLB lands around 150-400 KB (REPORTED from prior research).
- Effort to 27 morphs: medium. Either rely on the bundled 34 FACS units (author/map the 12
  expressions, compose the 15 visemes) or install the separate face-targets pack and verify its
  CC0 licence at download. The no-claim-on-output clause covers the export either way.

## 2.2 ICT-FaceKit (Light) (USC ICT / Meta Research)
- Licence VERIFIED: `https://raw.githubusercontent.com/ICT-VGL/ICT-FaceKit/master/LICENSE` is
  MIT ("Copyright (c) 2020 USC Institute for Creative Technologies ... to deal in the Software
  without restriction, including without limitation the rights to use, copy, modify, merge,
  publish, distribute, sublicense, and/or sell ..."). README confirms "ICT-FaceKit is released
  under the MIT license." MIT is sublicensable and survives npm redistribution.
- Morphs: the Light model ships a base topology (26,719 verts, 26,384 faces, quad-based) plus
  100 PCA identity modes and **53 expression blend shapes as data** in-repo (per-vertex delta
  OBJs + `vertex_indices.json`, assembled by the bundled Blender script). The expression shapes
  use Apple ARKit naming with `_L`/`_R` splits and map cleanly to FACS units (browInnerUp,
  jawOpen, mouthSmile, eyeBlink, noseSneer, etc.). There are NO native visemes; the 15 visemes
  must be authored by composing expression deltas.
- Topology/UV: professionally retopologised quad head/bust with a documented UV layout (README
  includes a UV figure and per-region vertex/polygon index tables). Includes eyes, teeth, gums,
  tongue geometry.
- Size: neutral OBJ is about 2.56 MB; the full mesh with 27 pruned morphs compresses well under
  the 1.5 MB GLB target after Meshopt (REPORTED estimate; plausible given the compact delta
  representation).
- Effort to 27 morphs: low-to-medium. Keep 12 of the 53 ARKit expressions mapped to
  `RIG_EXPRESSION_MORPHS`; author 15 visemes by blending expression deltas (e.g.
  jawOpen + mouthFunnel to viseme_ou/oh, mouthPucker to viseme_pp). No separate-pack ambiguity:
  everything advertised ships in-repo under MIT.

## 2.3 FLAME (MPI Tübingen / University of Basel)
- Licence VERIFIED (scout, primary source `https://flame.is.tue.mpg.de/modellicense.html`):
  the standard FLAME model is non-commercial research-only. The FLAME 2023 Open variant is
  CC BY 4.0, which permits commercial use but requires attribution, so it fails the
  "CC0 / explicit no-claim only" gate.
- Morphs: 5,023 verts, fixed topology, three linear shape spaces (identity 300 PCA, expression
  100 PCA, pose correctives). No discrete viseme or expression blendshapes; the 27 rig morphs
  would have to be sampled/derived (derivative work on a non-commercial licence).
- Verdict: DISQUALIFIED. Standard version is non-commercial; Open version requires attribution
  and is not no-claim.

## 2.4 Basel Face Model 2017 (University of Basel)
- Licence VERIFIED (scout, primary source
  `https://faces.dmi.unibas.ch/bfm/BFM2017_NonCommercial_License_Agreement.pdf`): section 2.1
  grants only "internal, non-commercial research" use; section 3.3 forbids "sub-license, or
  distribute the DATA ... to any third party" and forbids creating derivatives; section 3.4
  forbids "manufacture or sell products ... for any ... for-profit purposes."
- Morphs: PCA statistical model (199 identity / 100 expression PCs), 53,490 verts, 160,470
  triangles, NO UVs, NO discrete viseme/expression morphs.
- Verdict: DISQUALIFIED (non-commercial, no sublicence, no derivatives, no discrete morphs).

## 2.5 MetaHuman (Epic Games / Unreal Engine)
- Licence VERIFIED (scout, primary sources `https://www.unrealengine.com/eula/mhc` and
  `https://www.unrealengine.com/eula/content`): MetaHuman Content is "UE-Only Content" usable
  only "in conjunction with Unreal Engine" (Epic Content EULA section 5(a)); the licence is
  non-sublicensable (section 2); standalone redistribution is prohibited (section 5(c)(ii),
  section 3(a)). The mesh/rig cannot ship as a standalone GLB inside an npm package.
- Morphs: high-fidelity head with 52 ARKit blendshapes and a full rig, which is exactly why it
  is tempting.
- Verdict: DISQUALIFIED (UE-only, non-sublicensable, no standalone redistribution).

## 2.6 Poly Haven CC0 photogrammetry (e.g. Marble Bust 01)
- Licence VERIFIED (scout, `https://polyhaven.com/license`): all assets CC0, commercial use,
  redistribution, and sublicensing allowed.
- Morphs: none. Models are static scans. The head/bust entries (e.g. Marble Bust 01, about
  51.83 MB) are marble statues, not realistic human heads; scan topology and no UV-friendly
  deformation layout.
- Verdict: licence qualifies but poor fit for a deforming talking head (statue, no morphs, needs
  full retopology). Usable only as a shape reference, not a rig base.

## 2.7 3D Scan Store free head sample
- Licence VERIFIED (scout, `https://www.3dscanstore.com/terms-and-conditions-licensing`): free
  samples are "Personal use only"; commercial use and open-source/redistribution are prohibited.
- Morphs: none (photogrammetry head, about 1.9 GB, excellent quality but personal-use licence).
- Verdict: DISQUALIFIED (no commercial redistribution).

## 2.8 Sketchfab CC0 bust (e.g. Bust of Roz a Loewenfeld)
- Licence VERIFIED (scout, model page `https://sketchfab.com/3d-models/...`): CC0 Public Domain.
  Note the comparable "Classical marble bust" model is CC-BY (requires attribution, fails the
  no-claim gate).
- Morphs: none; museum sculpture bust (about 60.4k triangles), not a realistic human head.
- Verdict: licence qualifies but not a realistic human head and no morphs; unsuitable as a rig
  base.

# 3. Comparison table

| Source | Licence (verified) | Morphs included | Topology / UV | Approx. size | Effort to 27 morphs | Verdict |
|---|---|---|---|---|---|---|
| ICT-FaceKit Light | MIT (VERIFIED, raw LICENSE) | 53 ARKit expression blendshapes as data; no visemes | Retopo quad, documented UVs | neutral OBJ ~2.56 MB; GLB <1.5 MB plausible | Low-med: keep 12 expressions, author 15 visemes | QUALIFIES (primary) |
| MPFB2 bundled | CC0 assets + no-claim on output (VERIFIED, LICENSE.ASSETS.md / LICENSE.md) | Base mesh + 34 FACS expression units per ethnicity; ARKit/viseme packs separate | Quad basemesh, atlas UV (face re-unwrap) | Pruned bust ~150-400 KB (REPORTED) | Med: author/map 27 from bundled units, or install separate pack | QUALIFIES (backup) |
| MPFB2 face-targets pack (separate) | CC0 (REPORTED, not in repo) | 52 ARKit + 22 MS + 15 Meta visemes | Same mesh | n/a | Low if pack installed and licence verified | QUALIFIES only after download-time licence check |
| FLAME (standard) | Non-commercial research-only (VERIFIED scout) | PCA only, no discrete morphs | 5,023 verts, no UVs | Large | Very high + disqualified | DISQUALIFIED |
| FLAME 2023 Open | CC BY 4.0, attribution required (VERIFIED scout) | PCA only | 5,023 verts, no UVs | Large | High + fails no-claim gate | DISQUALIFIED |
| Basel Face Model 2017 | Non-commercial, no sublicence/derivatives (VERIFIED scout) | PCA only, no discrete morphs | 53,490 verts, no UVs, ~240 MB | ~240 MB | Very high + disqualified | DISQUALIFIED |
| MetaHuman | UE-Only, non-sublicensable, no standalone redistribution (VERIFIED scout) | 52 ARKit + full rig | High-fidelity, clean | Large | n/a | DISQUALIFIED |
| Poly Haven CC0 (Marble Bust 01) | CC0 (VERIFIED scout) | None (statue) | Scan topology, no morphs | 51.83 MB | All 27 authored; poor fit | Licence OK, poor fit |
| 3D Scan Store free head | Personal use only (VERIFIED scout) | None (photogrammetry head) | Scan, no morphs | 1.9 GB | n/a | DISQUALIFIED |
| Sketchfab CC0 bust | CC0 (VERIFIED scout) | None (sculpture) | 60.4k tris, no morphs | Medium | All 27 authored; not a human head | Licence OK, poor fit |

# 4. RECOMMENDATION

Primary route: **ICT-FaceKit Light (MIT)**. It is the only candidate that bundles, in a single
MIT-licensed repository, a real human head with clean quad topology, a documented UV layout,
AND 53 ARKit-named expression blendshapes as actual data. There is no "separate pack" ambiguity
and MIT unambiguously survives sublicensing inside an npm package. The only shared gap with every
other route is that no source ships native visemes, so the 15 `RIG_VISEME_MORPHS` must be
authored by composing expression deltas (jawOpen + mouthFunnel to viseme_ou/oh, mouthPucker to
viseme_pp, and so on). The 12 `RIG_EXPRESSION_MORPHS` map directly onto ICT-FaceKit expressions
(mouthSmile_L/R to exp_happy, jawOpen to jaw_open, browDown_L/R to exp_brow_down, eyeBlink_L/R to
exp_blink, noseSneer_L/R to exp_angry, mouthFunnel to mouth_round, etc.).

Concrete first step (primary): clone `ICT-VGL/ICT-FaceKit`, run the bundled Blender script
(`Blender/Scripts/ICTFaceKit.py`) to join the neutral OBJ with the 53 expression delta OBJs into
shape keys; prune to the 12 `RIG_EXPRESSION_MORPHS`; author the 15 `RIG_VISEME_MORPHS` by
blending expression deltas; re-unwrap the face to a dedicated UV island; export glTF; run
Meshopt + KTX2; assert the GLB is under 1.5 MB.

Backup route: **MPFB2 (CC0, verified)**. It is a genuine CC0 human head with bundled FACS
expression units and an explicit no-claim-on-output clause, so it is safe for npm
redistribution. Prefer the bundled 34 FACS units over the separate face-targets pack, because the
pack is not in the repo and its licence must be verified at download time (if used, record the
licence proof in the repo).

Concrete first step (backup): install MPFB2 in Blender; export the CC0 base-mesh head-bust;
load the bundled `expression/units` `.target.gz` files; map/author the 27 rig morphs; re-unwrap
the face UV; export glTF; run Meshopt + KTX2; assert under 1.5 MB. If instead the separate
face-targets pack is installed for the 52 ARKit + viseme sets, verify and archive its CC0
licence before shipping.

Both routes require downstream viseme authoring; neither ships native visemes. FLAME, BFM 2017,
MetaHuman, and 3D Scan Store are disqualified on licence grounds (verified). Poly Haven and
Sketchfab CC0 qualify on licence but are static sculptures, not realistic deformable human heads,
so they are not recommended as the rig base.
