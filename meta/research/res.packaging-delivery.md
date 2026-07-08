---
id: res.packaging-delivery
nodes: [hologlyph.adapter.web-component, hologlyph.adapter.frameworks, hologlyph.runtime.core, hologlyph.asset.loader, hologlyph.asset.pipeline]
sources: [src.deep-research-1, src.deep-research-2]
date: 2026-07-08
---

Both reports agree on: a framework-agnostic custom element (standardize tag to `<hologlyph-head>`) with thin React/Vue/Svelte wrappers; GLB assets with a shared rig/naming schema across default busts; offline compression via glTF-Transform/Meshopt + KTX2 (Basis) targeting GLB < 1.5 MB; strict `dispose()`/teardown discipline for SPA mounts; and a phased rollout (single bust -> production lip-sync -> second bust -> advanced scroll choreography -> bring-your-own avatar import last, because arbitrary-rig normalization cost rises sharply).

Contested: API emphasis. Report-1 frames the surface as an imperative engine API. Report-2 frames it as a declarative widget with semantic attributes/properties and advanced hooks underneath. Resolved by accepted decision `dec.api-emphasis`: declarative `<hologlyph-head>` primary, imperative engine API exposed as documented advanced hooks.
