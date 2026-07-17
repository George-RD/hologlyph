---
node: hologlyph.asset.pipeline
status: done
created: 2026-07-13
satisfies: v2-embodiment
---

# Export ICT-FaceKit Bust

Export the ICT-FaceKit Light head-bust (MIT, primary per res.head-asset-alternatives; backup: MPFB2 bundled CC0 data only): join neutral mesh with the 53 ARKit expression deltas into shape keys, slice to a bust, re-unwrap the face to a dedicated UV island, export glTF. Record licence and provenance in tools/asset-pipeline/README.md. Provenance must be pinned and reproducible: record the exact upstream commit SHA (or release tag) of ICT-VGL/ICT-FaceKit used, the reproducible acquisition command (e.g. git clone + checkout <sha>), the path of the source files consumed, and a copy of the upstream LICENSE at that SHA in tools/asset-pipeline/; the licence verification in res.head-asset-alternatives holds for that pinned version only.

Resolved 2026-07-17: exported via the committed Node pipeline (tools/asset-pipeline/build-bust.ts) from ICT-FaceKit pinned commit da5f95a607f5e6b37755b38d3385d7f2853732e5 (MIT); sources fetched to a gitignored cache and sha256-verified against ict-source-manifest.json; licence copy at tools/asset-pipeline/ICT-FaceKit-LICENSE; provenance in tools/asset-pipeline/README.md. The ICT neutral mesh is already a head-bust extent, so no crop was needed; the dedicated face UV island is computed programmatically (face u in [0,0.68]).
