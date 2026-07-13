# Tasks: v2-embodiment

- [ ] Export ICT-FaceKit Light head-bust (MIT, primary per res.head-asset-alternatives; backup: MPFB2 bundled CC0 data only); record licence and provenance
- [ ] Canonicalise the 27 rig-schema morphs (15 visemes, 12 expressions) via a committed glTF-Transform script; Blender donor transfer plus sculpt for donor-less morphs; validateRig passes with zero warnings (res.morph-authoring, specs/morph-authoring-detail.md)
- [ ] Run the asset pipeline (Meshopt + KTX2); document the exact invocation; GLB under the accepted 1.5 MB delivery target (dec.performance-budget)
- [ ] Record dec.default-asset-delivery (commit binary vs fetch-on-build) and wire the chosen delivery path
- [ ] Demo loads the real bust by default with placeholder as fallback; speak round-trip shows viseme motion
- [ ] Viseme e2e tests: espeak-ng-generated strictly-Polly speech-mark JSONL fixture through the provider adapter with mock clock (14 reachable morphs), plus a canonical VisemeFrame timeline fixture asserting all 15 morphs are drivable (res.viseme-provider-format, res.local-tts-dev)
- [ ] Text-skin fit pass on real head UVs (grid density, base colour, emissive ramp) with numeric non-black check
- [ ] Packaging readiness: README quickstarts per adapter, exports map verified, CHANGELOG seeded
- [ ] Full gate: tsc clean, vitest green, build clean, cairn hook all exit 0, headless demo smoke test
- [ ] Append any new cairn friction observations to meta/cairn-feedback.jsonl
