---
id: res.asset-sourcing
nodes: [hologlyph.asset.loader, hologlyph.asset.pipeline]
sources: [src.v2-research-agents]
date: 2026-07-10
---

> Correction (2026-07-13, res.head-asset-alternatives): hands-on verification of makehumancommunity/mpfb2 disproved the "faceunits01: 54 ARKit units plus visemes ship with MPFB2" claim below. Only 34 FACS expression units are bundled; the ARKit set is 52 name entries in `faceservice.py` resolved from a separately installed target pack whose licence must be re-verified at download. The primary recommendation is superseded: ICT-FaceKit Light (MIT) is now primary and MPFB2 (bundled CC0 data only) is backup. The table rows below are retained as originally reported for provenance.

Agreed: a procedurally authored or dedicated CC0 mesh beats scraping a marketplace head for a redistributable npm package. The licence must survive sublicensing because the library ships the GLB inside the package, so CC0 or an explicit no-claim asset licence is the only safe default. Anything behind a Provided Content, non-commercial, or no-sublicence wall (Ready Player Me, VRoid store content) is disqualified. v2 needs a head or bust slice, not a full body. Quad topology and a clean UV layout matter because morph authoring drives ARKit-style blendshapes and the text skin projects glyphs onto the surface. The accepted delivery target is 1.5 MB post-Meshopt (dec.performance-budget). Correction: the research brief wrongly stated 536 KB; the comparison below keeps the conservative per-asset estimates, which all sit comfortably inside the real budget. Pruning morphs and applying Meshopt plus KTX2 remains mandatory.

Contested: realism versus stylisation (a photoreal scan gives likeness but poor UVs and no morphs; a procedural stylised head gives clean topology and often ships ARKit morphs), and whether to ship morphs in the source asset or author them downstream. The rig schema (dec.asset-rig-schema) is VRM-like and does not require photorealism.

Recommendation, primary: a MakeHuman or MPFB2 exported head-bust under CC0. MakeHuman's asset licence (LICENSE.ASSETS.md) dedicates bundled assets to the public domain, and its output licence adds an explicit no-claim clause covering content created with the software, which covers a mesh redistributed in an npm package. The base mesh is quad-only (a head/bust slice is roughly 3.5-4.8k verts) and ships the faceunits01 set of 54 ARKit facial units plus visemes, which map onto the canonical rig morphs through a small name-map. Export as glTF, prune unused morphs, re-unwrap the face to a dedicated UV island, then run Meshopt and KTX2; a pruned head-bust GLB lands around 150-400 KB, well inside the 1.5 MB target. Risk is low provided no GPLv3 MakeHuman code is bundled and faceunits01 is confirmed inside the CC0 assets tree. Links: https://www.makehumancommunity.org/ , https://github.com/makehumancommunity/makehuman , https://static.makehumancommunity.org/mpfb.html

Backup: Blender Studio Human Base Meshes (CC0), specifically the separated Stylized Head (https://studio.blender.org/assets/): quad topology, UDIM UVs, compresses well under 50 KB, but ships zero facial morphs, so all 27 rig shapes come from the morph-authoring pipeline. Realistic fallback: Smithsonian 3D CC0 bust (https://3d.si.edu/), formal CC0 but photogrammetry UVs and no morphs.

| Source | Licence | Morphs included? | Est. bust GLB | UV quality | Risk |
|---|---|---|---|---|---|
| MakeHuman / MPFB2 head-bust | CC0 assets + no-claim on exports | Yes (54 ARKit face units + visemes) | ~150-400 KB pruned | Global atlas; face needs re-unwrap | Low |
| Blender Studio Stylized Head | CC0, no attribution | No | <50 KB | UDIM, clean | Very low |
| Smithsonian 3D CC0 bust | CC0 (formal) | No | well under 1.5 MB decimated | Photogrammetry atlas | Low (no morphs) |
| VRoid Studio CC0 beta samples | CC0 (beta samples only) | Yes (VRM, not ARKit) | ~200-400 KB | Good | Medium |
| Ready Player Me | Custom, no sublicence | Yes (ARKit) | n/a | Good | Disqualified |
| Three D Scans mirrors | Informal "not copyrighted" | No | well under 1.5 MB | Decent | Medium (no formal CC0) |
