# Proposal: implement-v1

## Motivation

The blueprint declares 12 ghost modules (all `src/` and `tools/` paths are empty). This change implements v1 of the hologlyph library: a web-native, text-skinned talking-head widget delivered as a custom element with framework wrappers.

## Scope

- All 8 runtime modules: core, renderer, text-skin, shaders, motion, speech, audio, behavior.
- Asset loader (GLB + shared rig schema) and offline asset pipeline tool.
- Web component `<hologlyph-head>` and React/Vue/Svelte thin wrappers.
- Package tooling: TypeScript, Vite build, Vitest tests, demo page.

## Out of scope (per accepted decisions)

- Heavy surface-tension/ripple shader simulation (deferred, dec.renderer-posture).
- On-device Kokoro TTS adapter (deferred, dec.speech-architecture).
- Arbitrary-rig import (deferred, dec.asset-rig-schema).
- Shipping binary GLB assets; loader consumes any rig-schema-conformant GLB.
