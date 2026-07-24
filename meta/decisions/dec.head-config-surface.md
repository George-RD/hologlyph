---
id: dec.head-config-surface
nodes: [hologlyph.runtime.core, hologlyph.runtime.shaders, hologlyph.runtime.textskin, hologlyph.asset.loader]
status: accepted
date: 2026-07-23
informed_by: [src.owner-approved-look-2026-07-21, res.feature-shading-exploration]
---

# Typed head configuration

The owner-approved feature-shading values become one immutable library default exposed through a typed `HeadConfig`. Callers may provide partial overrides through `EngineOptions`, and the VFX engine updates existing uniforms in place rather than rebuilding materials.

`HeadConfig` contains visual shader and eye controls only. Text scroll speed remains owned by `TextSkinEngine`, expression remains owned by `MotionEngine`, and experimental background, opaque-core, day/night, and caruncle-size controls remain demo-only until separately approved.

Feature masks are derived once in `buildLoadedAvatar`. Missing attributes or morphs degrade to zero-weight zones rather than rejecting the avatar.
