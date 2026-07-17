---
node: hologlyph.asset.pipeline
status: done
created: 2026-07-13
satisfies: v2-embodiment
---

# Optimise GLB Under Budget

Run tools/asset-pipeline/optimize.ts (Meshopt + KTX2) on the bust, re-run validateRig after compression, document the exact invocation in the pipeline README, and assert the GLB lands under the accepted 1.5 MB delivery target (dec.performance-budget). Budget and non-canonical pruning apply to the shipped GLB only; the pre-optimise full-fidelity intermediate retains every source delta (see design.md expressiveness expansion path).

Resolved 2026-07-17: optimize.ts (Meshopt, prune keepAttributes/keepLeaves, --simplify 0.5 chosen by visual keyframe comparison) produces assets/hologlyph-bust.glb at 887 KB (incl. morph normal deltas), under the 1.5 MB target; validateRig re-run on the OPTIMISED GLB by test/asset-bust.test.ts; exact invocation documented in tools/asset-pipeline/README.md.
