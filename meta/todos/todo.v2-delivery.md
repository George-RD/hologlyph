---
node: hologlyph.asset.loader
status: open
created: 2026-07-13
satisfies: v2-embodiment
---

# Decide And Wire Asset Delivery

Resolve dec.default-asset-delivery (commit the optimized GLB vs fetch-on-build; default commit), record the decision artefact, and wire the chosen delivery path through the loader and engine avatarUrl default. If the GLB (or generated fixture/scripts) lands in a new directory (e.g. assets/), add the path claim to cairn.blueprint with its decision artefact so cairn scan stays clean; if fetch-on-build wins, document the output location instead.
