---
id: dec.api-emphasis
nodes: [hologlyph.adapter.web-component, hologlyph.adapter.frameworks, hologlyph.runtime.core]
status: accepted
date: 2026-07-08
informed_by: [res.packaging-delivery, src.deep-research-1, src.deep-research-2]
---

The declarative custom element `<hologlyph-head>` is the PRIMARY public surface, with semantic attributes/properties (`mode`, `speak(text)`, `setEmotion`, `setScrollProgress`, `setTextSkinSource`, `setVoiceAdapter`) and thin React/Vue/Svelte wrappers.

The imperative engine API is exposed UNDERNEATH as documented advanced hooks (custom TTS adapter, custom viseme stream, custom text-skin generator, shader-uniform overrides) so the differentiating levers are never hidden and graphics specialists retain full control.

Rationale (adjudicated from adversarial debate): embed-ability and reliable SPA teardown via `connectedCallback`/`disconnectedCallback` are the product; non-graphics developers should get a drop-in component. The reformer's valid risk (declarative-first baking a wrong abstraction, hiding low-level levers like TSL uniform graphs and viseme arrays) is answered by keeping the engine contract public as advanced hooks, not by making it primary.
