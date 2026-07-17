---
node: hologlyph.asset.pipeline
status: done
created: 2026-07-13
satisfies: v2-embodiment
---

# Author 27 Canonical Morphs

Canonicalise the 27 rig-schema morphs (15 visemes composited from expression deltas, 12 expressions pruned/renamed) via a committed glTF-Transform script per specs/morph-authoring-detail.md; Blender sculpt for donor-less morphs as fallback only. validateRig passes with zero warnings and asserts all 27 targets in the shipped GLB.

Retention (see design.md expressiveness expansion path): keep a full-fidelity intermediate carrying every source delta for the selected asset (ICT's ARKit shapes on the primary route, MPFB2's FACS units on the backup) plus any authored shapes, the composition recipe, the pinned upstream commit and licence, and the pipeline version, under tools/asset-pipeline/. The package.json `files: [dist]` allowlist already keeps that directory out of the published package (verify with `npm pack --dry-run`). If raw binaries bloat the repo, use a fetch plus hash manifest. Prune to the 27 canonical targets only in the shipped GLB. Add a test that regenerates the 27 shipped targets from the retained source.

Resolved 2026-07-17: 27 canonical targets composited from ARKit deltas in build-bust.ts (viseme_sil/exp_relaxed zero-delta by design); validateRig conformant with zero missing morphs/bones (test/asset-bust.test.ts); full-fidelity intermediate retained via --full (57 source deltas, gitignored, reproducibly regenerable from the pinned manifest); regen-from-source guard test included; npm pack verified dist plus licence notices only.
