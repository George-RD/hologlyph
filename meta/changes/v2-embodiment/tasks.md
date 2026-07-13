# Tasks: v2-embodiment

- [ ] Export MakeHuman/MPFB2 CC0 head-bust (backup: Blender Studio Stylized Head); verify faceunits01 sits in the CC0 assets tree; record licence and provenance (res.asset-sourcing)
- [ ] Canonicalise the 27 rig-schema morphs (15 visemes, 12 expressions) via a committed glTF-Transform script; Blender donor transfer plus sculpt for donor-less morphs; validateRig passes with zero warnings (res.morph-authoring, specs/morph-authoring-detail.md)
- [ ] Run the asset pipeline (Meshopt + KTX2); document the exact invocation; GLB under the accepted 1.5 MB delivery target (dec.performance-budget)
- [ ] Record dec.default-asset-delivery (commit binary vs fetch-on-build) and wire the chosen delivery path
- [ ] Demo loads the real bust by default with placeholder as fallback; speak round-trip shows viseme motion
- [ ] Viseme e2e test: hand-authored Polly speech-mark JSONL fixture plus Polly-to-canonical parser, replayed through SpeechEngine -> MotionEngine with mock clock (res.viseme-provider-format)
- [ ] Text-skin fit pass on real head UVs (grid density, base colour, emissive ramp) with numeric non-black check
- [ ] Packaging readiness: README quickstarts per adapter, exports map verified, CHANGELOG seeded
- [ ] Full gate: tsc clean, vitest green, build clean, cairn hook all exit 0, headless demo smoke test
- [ ] Append any new cairn friction observations to meta/cairn-feedback.jsonl
