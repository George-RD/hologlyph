# Implementation notes: v2-embodiment

Running log per skill://implementation-notes. Keep entries to 2-3 lines.

## Deviations

- **Asset route runs in Node, not Blender.** Blender is not installed on this
  workstation. The design makes glTF-Transform the MAIN morph-authoring pipeline
  and Blender the "fallback only" (dec.head-asset-source), so this is within the
  ratified route, not Route C procedural. ICT-FaceKit ships the neutral head plus
  all ARKit expressions as OBJ files with UVs (pinned commit
  da5f95a607f5e6b37755b38d3385d7f2853732e5, MIT), so deltas, viseme composites,
  skinning, and face-UV unwrap are all computed in a committed bun script
  (tools/asset-pipeline/build-bust.ts). No Blender sculpt pass; donor-less morphs
  (exp_relaxed, viseme_sil) ship as zero-delta targets per the spec.
- **Bust slice / UV re-unwrap done programmatically.** The ICT neutral mesh is
  already a head-bust extent (head plus partial neck, no torso), so no crop was
  needed. The dedicated face island is a frontal planar projection into
  u [0, 0.68]; the back of the head gets its own mirrored island (u [0.70, 0.98])
  and interior/thin groups (teeth, gums, lacrimal, occlusion, lashes, eyeballs)
  are squeezed into the right-edge strip.
- **viseme_pp recipe tuned** (mouthClose 1.0 -> 0.25): ICT's mouthClose delta
  assumes jaw-open compensation; full weight with a closed jaw folded the lips
  into a lump, caught by the keyframe render comparison.
- **Shipped GLB is decimated at --simplify 0.5** (654 KB vs 1.30 MB full): chosen
  by a 4-ratio x 7-keyframe visual comparison; r0.5 was indistinguishable from
  full at review size, answering the owner's size concern with no quality loss.
- **Delivery is Option A via a lazy inlined chunk** (owner-ratified): Vite lib
  mode inlines assets, so the default head travels as a data: URL in its own
  dynamically imported chunk instead of a sibling file; path resolution across
  consumer bundlers was judged too fragile. Main chunk stays 10.8 kB gzip.
- **Text-skin V orientation fixed in the asset UVs**, not the shader: CanvasTexture
  flipY puts the canvas top at v=1, the original mapping rendered text upside
  down (caught in the variants render).

## Discovered edge cases

- glTF-Transform `prune()` strips NORMAL/TEXCOORD_0 when no material samples
  them, and the skeleton's leaf joints; optimize.ts now passes
  `prune({ keepAttributes: true, keepLeaves: true })` (regression test added).
- ICT OBJs use `_L`/`_R` suffixes and single-file jaw/mouth shapes; more UVs than
  positions, so vertices are de-indexed by (position, uv, MATERIAL) - material is
  part of vertex identity because UV island and skin joint depend on it.
- Vite lib mode inlines `new URL(..., import.meta.url)` assets as base64 data
  URLs regardless of assetsInlineLimit; turned from a hazard into the delivery
  mechanism (see Deviations).
- vite/client's ambient `process` type shadows Node's in tests; narrowed once via
  a commented cast in test/asset-bust.test.ts.
- cairn 0.3.0 `targets:` override cannot declare a data/none language and matches
  per node id only, so the assets/ path claim carries a permanent advisory
  CAIRN_RECONCILE_LANGUAGE_UNKNOWN warning (logged to meta/cairn-feedback.jsonl).

## Questions for review

- Text-skin look: DEFAULT_GRID (cyan, 96 cols) kept after a 4-variant pass;
  demo/textskin-variants.html renders the alternatives (dense, sparse, warm
  amber) if the owner wants a different skin personality.
- The default-avatar chunk weighs ~521 kB gzip; acceptable per Option A, but a
  future dec could add a "no-default" build flavour if consumers ask.

## Summary

Deviations: 6, all conservative and within ratified decisions; most likely to be
revisited is the lazy inlined-chunk delivery (vs sibling file) if a consumer
bundler mishandles dynamic import. Edge cases: 5 logged above. Next session:
read this file, tools/asset-pipeline/README.md, and dec.default-asset-delivery
first.
