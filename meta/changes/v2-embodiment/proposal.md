# Proposal: v2-embodiment

## Motivation

v1 (archived 2026-07-10) implemented all 12 blueprint modules and passes every gate, but the runtime still boots against `createPlaceholderAvatar()`: a sphere with two morphs (`jaw_open`, `exp_blink`). The library is functionally complete and visually a skull. v2 gives hologlyph a body: a real rig-schema-conformant head asset flowing through the existing pipeline, exercised end to end by the demo and the speech path.

## Scope

- Default bust asset: a redistributable (CC0/CC-BY) head mesh carrying the 15 viseme morphs and 9 expression morphs required by the rig schema (dec.asset-rig-schema), processed through `tools/asset-pipeline` (Meshopt + KTX2) into a `LoadedAvatar` that passes `validateRig` with zero warnings.
- Asset acquisition path documented and reproducible: source file, licence, and the exact pipeline invocation checked into `tools/asset-pipeline/README.md`.
- Demo upgrade: demo loads the real bust by default (placeholder remains the zero-asset fallback), speak round-trip drives visible viseme motion on the mesh.
- Cloud viseme adapter (speech mode 2) exercised against recorded provider fixtures: an e2e test replaying a captured viseme-metadata stream through `SpeechEngine` into `MotionEngine`, asserting frame timing. No live provider account is used.
- Text-skin fit pass: glyph density, base colour, and emissive tuned against the real head UVs instead of the sphere.
- Packaging readiness: README with quickstart per adapter, `exports` map verified via `publint` or equivalent, CHANGELOG seeded. Publishing to npm is explicitly out of this change and requires a separate go-ahead.

## Out of scope (unchanged deferred decisions)

- Heavy surface-tension/ripple simulation (dec.renderer-posture).
- On-device Kokoro TTS (dec.speech-architecture).
- Arbitrary-rig import beyond the shared schema (dec.asset-rig-schema).
- npm publish and any live TTS provider account.

## Blueprint impact

No new nodes. `hologlyph.asset` gains a path claim for the checked-in source asset location if binary assets are committed; otherwise assets are fetched at demo build time and the blueprint is untouched. Decision needed only if we commit binaries (repo-size tradeoff): record as dec.default-asset-delivery when resolved during implementation.
