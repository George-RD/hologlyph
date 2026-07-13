---
node: hologlyph.asset.pipeline
status: open
created: 2026-07-13
satisfies: v2-embodiment
---

# Optimise GLB Under Budget

Run tools/asset-pipeline/optimize.ts (Meshopt + KTX2) on the bust, re-run validateRig after compression, document the exact invocation in the pipeline README, and assert the GLB lands under the accepted 1.5 MB delivery target (dec.performance-budget). Budget and non-canonical pruning apply to the shipped GLB only; the pre-optimise full-fidelity intermediate retains every source delta (see design.md expressiveness expansion path).
