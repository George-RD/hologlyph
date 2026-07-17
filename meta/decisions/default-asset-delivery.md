---
id: dec.default-asset-delivery
nodes:
  - hologlyph.asset.loader
  - hologlyph.asset.pipeline
  - hologlyph.runtime.core
status: accepted
date: 2026-07-16
informed_by: [res.head-asset-alternatives]
---
# Default Asset Delivery

## Context

The v2 head bust ships as an optimised GLB (887 KB post Meshopt + 0.5 decimation, incl. morph normal deltas,
within the 1.5 MB target of dec.performance-budget). The design flagged one open
choice: commit the binary versus fetch-on-build, and the owner ratified that the
package IS a digital head, so the engine must load a real bust by default rather
than treating the asset as demo-only. The full-fidelity ICT source (~140 MB of
OBJs) is never committed: it is fetched to a gitignored cache and pinned by
sha256 in tools/asset-pipeline/ict-source-manifest.json.

## Decision

Three-part delivery:

1. The optimised GLB is COMMITTED at assets/hologlyph-bust.glb (repo asset for
   the demo, tests, and regeneration checks).
2. The published library inlines the bust: `src/core/default-avatar.ts` resolves
   `new URL('../../assets/hologlyph-bust.glb', import.meta.url)`, which the Vite
   library build converts to a data: URL inside a LAZY chunk (the engine reaches
   it via dynamic import). An engine created without avatarUrl loads the real
   head in every environment with zero runtime path resolution; consumers who
   pass their own avatarUrl never download the default chunk (main chunk stays
   ~10.8 kB gzip; the default-avatar chunk is ~720 kB gzip, fetched on use).
3. avatarUrl semantics: undefined loads the packaged bust; an empty string
   explicitly requests the procedural placeholder; any load failure degrades to
   the placeholder with a console warning.

## Rationale

Inlining via a lazy chunk was chosen over shipping a sibling .glb file because
`new URL(..., import.meta.url)` path resolution is fragile across consumer
bundlers (pre-bundled deps rewrite module URLs), while a data: URL travels with
the code and works everywhere three's FileLoader does. The pay-per-use chunk
keeps the v1 bundle budget intact for consumers who bring their own head.
Fetch-on-build was rejected: it adds a build-time network dependency and a
hosting concern, and the pinned source manifest already covers regeneration.

## Consequences

- Regenerate with `bun tools/asset-pipeline/build-bust.ts` then
  `bun tools/asset-pipeline/optimize.ts <raw> assets/hologlyph-bust.glb
  --simplify 0.5`, and rebuild the library so the inlined chunk refreshes.
- The npm tarball carries the head inside dist/ (~1.2 MB chunk); package files
  is ["dist", "THIRD-PARTY-NOTICES.md"], the notice being required because the
  ICT-derived bust ships inside the package.
- test/asset-bust.test.ts is the acceptance oracle for the committed GLB;
  test/core.test.ts covers the three avatarUrl delivery semantics.
