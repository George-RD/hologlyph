# Tasks: v2-embodiment

- [ ] Source a permissively licensed head mesh meeting topology/UV/size requirements; record licence and provenance
- [ ] Author or derive the 24 rig-schema morphs (15 visemes, 9 expressions); validateRig passes with zero warnings
- [ ] Run the asset pipeline (Meshopt + KTX2); document the exact invocation; GLB under the 536 KB budget
- [ ] Record dec.default-asset-delivery (commit binary vs fetch-on-build) and wire the chosen delivery path
- [ ] Demo loads the real bust by default with placeholder as fallback; speak round-trip shows viseme motion
- [ ] Viseme e2e test: recorded provider fixture replayed through SpeechEngine -> MotionEngine with mock clock
- [ ] Text-skin fit pass on real head UVs (grid density, base colour, emissive ramp) with numeric non-black check
- [ ] Packaging readiness: README quickstarts per adapter, exports map verified, CHANGELOG seeded
- [ ] Full gate: tsc clean, vitest green, build clean, cairn hook all exit 0, headless demo smoke test
- [ ] Append any new cairn friction observations to meta/cairn-feedback.jsonl
