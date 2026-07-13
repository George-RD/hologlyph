# Design: v2-embodiment

## Approach

Everything in v2 flows through interfaces that already exist in `src/contracts.ts`; no contract changes are expected. The work is asset production, integration, and tuning, so the shape is: one sequential asset track (the bust is a hard dependency for everything else), then a short parallel wave.

## Asset track (sequential, first)

1. Source (decided by res.asset-sourcing): primary is a MakeHuman/MPFB2 exported head-bust under CC0 (assets are public-domain dedicated; the output licence adds an explicit no-claim clause). It ships the faceunits01 set of 54 ARKit facial units plus visemes, quad topology, ~3.5-4.8k verts for a bust slice. Backup: Blender Studio Human Base Meshes Stylized Head (CC0, zero morphs, all shapes authored downstream). Hard requirements either way: under the accepted GLB delivery target of 1.5 MB post-Meshopt (dec.performance-budget), UVs usable by the projective text-skin mapping (face re-unwrapped to a dedicated island).
2. Author the 27 rig-schema morphs (15 visemes + 12 expressions; res.morph-authoring corrected the earlier count of 24). Pipeline: canonicalise with a committed `@gltf-transform/core` script under `tools/asset-pipeline/` that renames Oculus-15 shapes directly or composites ARKit-52 shapes into the canonical names (weights in specs/morph-authoring-detail.md), drops non-canonical targets; where shapes are missing, transfer from an MPFB2 donor in Blender (Surface Deform / ShapeKeyWrap); sculpt the donor-less morphs (`exp_relaxed`, `mouth_round`, stylised expression set). `validateRig` is the acceptance oracle.
3. Run `tools/asset-pipeline/optimize.ts` (Meshopt + KTX2), then re-run `validateRig` (compression can strip or damage morph targets); record the exact command in the pipeline README.
4. Asset delivery decision: commit the optimized GLB (simplest, repo grows ~0.5 MB) versus fetch-on-build. Default: commit it; record dec.default-asset-delivery.

## Parallel wave (after asset lands)

- Demo integration: engine option `avatarUrl` default points at the bust; placeholder stays as documented fallback when load fails or URL is empty.
- Viseme e2e (decided by res.viseme-provider-format): hand-authored fixture in Amazon Polly viseme speech-mark JSONL shape (never a captured API response), a small parser mapping Polly's 17-symbol en-US alphabet onto the 15 canonical morphs (table in the research artefact), replayed through SpeechEngine -> MotionEngine with a mock clock, asserting blendshape weights at keyframes. Azure/Google/ElevenLabs rejected: 22-ID + 55-blendshape over-specification or no viseme output at all.
- Text-skin fit: tune `DEFAULT_GRID` density and emissive ramp against the bust UVs; screenshot-based manual check in the demo, numeric check on non-black pixel fraction like the v1 probe.

## Verification

Same gate as v1: `tsc --noEmit` clean, vitest green, `vite build` clean, `cairn hook all` exit 0, demo smoke test in headless browser with the visibility shim. Plus: `validateRig(bust)` zero warnings, post-pipeline GLB size under budget.

## Cairn friction log

Continue appending to `meta/cairn-feedback.jsonl` (same schema); upstream issues #232-#247 already track v1 findings, so only new observations get logged.
