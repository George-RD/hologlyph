---
node: hologlyph.runtime.textskin
status: done
created: 2026-07-13
satisfies: v2-embodiment
---

# Text-Skin Fit On Real UVs

Tune DEFAULT_GRID density, base colour, and emissive ramp against the real bust UVs; numeric non-black pixel check plus screenshot check in the demo. Candidate moment for a brainstorm-prototypes pass: render 3-4 shading/density variants for the owner to react to.

Resolved 2026-07-17: variants pass on the real bust UVs (demo/textskin-variants.html: current defaults vs dense 128, sparse 64, warm base/hot emissive); DEFAULT_GRID kept as the best readability/density balance; V orientation fixed in the asset UVs (CanvasTexture flipY); TextSkinEngineOptions now accepts full grid overrides; numeric content-fraction oracle preserved at tools/smoke/ (bust ~15.5% of canvas vs clear colour).
