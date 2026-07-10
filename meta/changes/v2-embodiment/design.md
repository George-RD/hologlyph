# Design: v2-embodiment

## Approach

Everything in v2 flows through interfaces that already exist in `src/contracts.ts`; no contract changes are expected. The work is asset production, integration, and tuning, so the shape is: one sequential asset track (the bust is a hard dependency for everything else), then a short parallel wave.

## Asset track (sequential, first)

1. Source a permissively licensed head mesh. Candidates in preference order: a CC0 scan-derived bust (e.g. from a public domain scan repository), a VRoid/VRM-derived export (check licence per model), or a stylised sculpt. Hard requirements: quad-friendly topology under the 536 KB post-Meshopt budget (dec.performance-budget), UV layout usable by the projective text-skin mapping.
2. Author the 24 rig-schema morphs. Where the source lacks blendshapes, derive them: visemes via wrap-deform from an ARKit-style donor or hand-sculpt the 6 dominant visemes and interpolate the rest; expressions likewise. `validateRig` is the acceptance oracle.
3. Run `tools/asset-pipeline/optimize.ts` (Draco/Meshopt + KTX2) and record the exact command in the pipeline README.
4. Asset delivery decision: commit the optimized GLB (simplest, repo grows ~0.5 MB) versus fetch-on-build. Default: commit it; record dec.default-asset-delivery.

## Parallel wave (after asset lands)

- Demo integration: engine option `avatarUrl` default points at the bust; placeholder stays as documented fallback when load fails or URL is empty.
- Viseme e2e: capture one fixture of provider viseme metadata (hand-authored JSON is acceptable; format matches the mode-2 adapter contract), replay through SpeechEngine -> MotionEngine with a mock clock, assert blendshape weights at keyframes.
- Text-skin fit: tune `DEFAULT_GRID` density and emissive ramp against the bust UVs; screenshot-based manual check in the demo, numeric check on non-black pixel fraction like the v1 probe.

## Verification

Same gate as v1: `tsc --noEmit` clean, vitest green, `vite build` clean, `cairn hook all` exit 0, demo smoke test in headless browser with the visibility shim. Plus: `validateRig(bust)` zero warnings, post-pipeline GLB size under budget.

## Cairn friction log

Continue appending to `meta/cairn-feedback.jsonl` (same schema); upstream issues #232-#247 already track v1 findings, so only new observations get logged.
