---
node: hologlyph.runtime.shaders
---

# Contract for hologlyph.runtime.shaders

VFXEngine, liquid pool emergence shader, selective bloom, emissive text. Refer to `src/contracts.ts` for primary TypeScript interface declarations.

Two features live here as a pure half plus a GPU half, and only the pure half
is re-exported from the barrel: the tier 1 pool (`pool.ts` / `pool-surface.ts`)
and the interior glyph field (`interior-glyphs.ts` /
`interior-glyph-field.ts`). `createPoolSurface` and `createInteriorGlyphField`
are imported from their own modules by `EngineImpl` and by nothing else.
