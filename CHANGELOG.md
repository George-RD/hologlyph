# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added

- Realistic ICT-FaceKit head bust (MIT, pinned at da5f95a607f5e6b37755b38d3385d7f2853732e5) built by a reproducible bun pipeline with sha256-verified source manifest. 27-morph rig: 15 visemes composited from ARKit deltas plus 12 expressions, functional root/neck/head/eye_l/eye_r skeleton (eyeballs skinned to eye joints), dedicated face UV island for text-skin material, smooth vertex normals. Reaches 654 KB after Meshopt optimisation with `--simplify 0.5` via visual keyframe comparison.
- Default-avatar lazy delivery: the bust is inlined as a data: URL in a separate chunk (dist/default-avatar-*.js, ~893 kB raw / 521 kB gzip) reached via dynamic import. Main bundle stays 36 kB / 10.8 kB gzip. `avatarUrl: ''` forces the procedural placeholder; load failures degrade gracefully.
- Viseme e2e fixture and tests: `tools/asset-pipeline/gen-viseme-fixture.ts` drives espeak-ng to produce a deterministic Polly-shaped timeline; fixture at `test/fixtures/viseme-polly-hello.jsonl`; canonical timeline verified in `test/speech-e2e.test.ts`.
- TypeScript declarations now emitted (`tsc -p tsconfig.build.json` writes `dist/*.d.ts`); `exports` map carries `types` conditions on all subpath exports; `publint` clean.
- Asset acceptance tests (`test/asset-bust.test.ts`) validate rig conformance, morph drivability, budget, normal/UV retention, and regen-from-source (when cache present).
## [0.1.0]

### Added

- Renderer with WebGPU-first and WebGL2-safe fallback using a single NodeMaterial source.
- Text-skin surface driven by a CanvasTexture with GPU UV scroll.
- Motion engine with expression vocabulary and viseme-driven mouth shaping.
- Speech adapters across three modes: browser demo, cloud provider visemes, and PCM fallback.
- Behaviour state machine coordinating emerge, idle, listening, speaking, thinking, and scroll states.
- Asset loader for externalised GLB avatars with a built-in placeholder fallback.
- Declarative `<hologlyph-head>` web component as the primary public surface.
- Framework wrappers for React, Vue, and Svelte.
