# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added

- Interior glyph field, shipped gated off (`dec.liquid-glass-architecture`, item 10). `HeadConfig.interior` suspends a few hundred camera-facing glyph sprites between the near and far surfaces of the glass body, placed in the interior volume by the baked `aThickness` field and sampling cells of the same text-skin canvas the surface samples, so there is no new asset and no second texture upload. Each glyph is a spring-damper chasing a rest position carried by the head's own frame, so moving the head drags them off course and they settle again; a slow drift keeps them alive while the head is still, depth dims and desaturates them so they read as behind the surface, and they are sorted back to front inside the interior pass at `renderOrder -0.5`. `interior.count` is a hard gate and ships at `0`: nothing is sampled, nothing is allocated and no object joins the scene, so the approved look is reproduced exactly. Reduced motion removes the lag and damps the drift. Lab page `demo/interior-glyph-lab.html`, capture `tools/smoke/interior-glyph-shot.mjs`.
- Chromium HTML-in-Canvas lensing, a capability-gated enhancement to `refract` (`dec.liquid-glass-architecture`, rung 3, item 5). Where `drawElementImage` and `texElementImage2D` are both present and the named subtree is an immediate child of a `<canvas layoutsubtree>`, the lens uploads live DOM every frame instead of a frozen snapshot, so a CSS animation or a typed value refracts through the glass in real time. Absent either condition, and on every non-Chromium engine, the snapshot lens is built exactly as before: no error, no host change, no difference in what the page writes. A host-supplied `rasterise` always chooses the snapshot path. Because hit-testing follows the undistorted layout box, the engine warns when the head covers an interactive control inside the refracted subtree.
- Backdrop-adaptive glass skin: the canvas now clears to transparent so the host page shows through the head, and `HeadConfig.skin` gains `glass` (fresnel edge thickening, key-light specular, grazing-angle refraction) plus `backdrop` (host page colour, `adapt` strength, `auto` detection). The engine samples the first opaque background colour at or above its mount host, crossing shadow boundaries, and falls back to the browser canvas colour on an unstyled page. Glyphs glow on dark backgrounds, cross over to dark ink on light ones, and gain an opacity floor on mid tones. Set `skin.backdrop.adapt` to 0 to pin the previous dark-page look.
- Realistic ICT-FaceKit head bust (MIT, pinned at da5f95a607f5e6b37755b38d3385d7f2853732e5) built by a reproducible bun pipeline with sha256-verified source manifest. 27-morph rig: 15 visemes composited from ARKit deltas plus 12 expressions, functional root/neck/head/eye_l/eye_r skeleton (eyeballs skinned to eye joints), dedicated face UV island for text-skin material, smooth vertex normals plus morph normal deltas. Reaches 887 KB after Meshopt optimisation with `--simplify 0.5` via visual keyframe comparison.
- Default-avatar lazy delivery: the bust is inlined as a data: URL in a separate chunk (dist/default-avatar-*.js, ~1.2 MB raw / 720 kB gzip) reached via dynamic import. Main bundle stays 36 kB / 10.8 kB gzip. `avatarUrl: ''` forces the procedural placeholder; load failures degrade gracefully.
- Viseme e2e fixture and tests: `tools/asset-pipeline/gen-viseme-fixture.ts` drives espeak-ng to produce a deterministic Polly-shaped timeline; fixture at `test/fixtures/viseme-polly-hello.jsonl`; canonical timeline verified in `test/speech-e2e.test.ts`.
- TypeScript declarations now emitted (`tsc -p tsconfig.build.json` writes `dist/*.d.ts`); `exports` map carries `types` conditions on all subpath exports; `publint` clean.
- Asset acceptance tests (`test/asset-bust.test.ts`) validate rig conformance, morph drivability, budget, normal/UV retention, and regen-from-source (when cache present).

### Fixed

- `bakeThickness` no longer throws on a rig that ships its own `aThickness` as an ordinary glTF accessor. It flagged the upload through `attr.data`, which only exists on the interleaved buffer `bakeFeatureMasks` declares, so a legal custom rig failed the whole mount.

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
