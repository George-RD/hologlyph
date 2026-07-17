---
node: hologlyph.asset.loader
status: done
created: 2026-07-13
satisfies: v2-embodiment
---

# Decide And Wire Asset Delivery

Resolve dec.default-asset-delivery (commit the optimized GLB vs fetch-on-build; default commit), record the decision artefact, and wire the chosen delivery path through the loader and engine avatarUrl default. If the GLB (or generated fixture/scripts) lands in a new directory (e.g. assets/), add the path claim to cairn.blueprint with its decision artefact so cairn scan stays clean; if fetch-on-build wins, document the output location instead.

Resolved 2026-07-17: dec.default-asset-delivery accepted (owner-ratified Option A). Engine loads the packaged bust by default via a lazy inlined data-URL chunk (dist/default-avatar-*.js, ~521 kB gzip; main chunk 10.8 kB gzip); avatarUrl '' forces the placeholder; failures degrade with a warning. assets/ path claimed on hologlyph.asset.loader in cairn.blueprint (advisory LANGUAGE_UNKNOWN warning accepted and logged as upstream friction).
