# Implementation notes

- The stage owns rendering geometry through a `ResizeObserver`, so the fixed rail is excluded from the renderer's aspect calculation and focus transitions resize continuously.
- The studio owns no renderer internals. Framing is one public `Engine.view` state shared by sliders and direct manipulation.
- Speech uses `engine.speak()` and the engine-owned viseme pipeline. The generation guard prevents a cancelled utterance completing late from resetting a newer one.
- Gaze writes are coalesced to one animation frame and suppressed for an active camera drag.

- Residual-centroid check at 1440×900, against a 1072 px canvas: reduced and immediately frozen captures have a centred threshold bounding box (0 px). Their threshold-pixel centroids shift from roughly 0 px at threshold 30, to +6.77/+6.44 px at 55, and +9.85/+9.32 px at 110. That threshold dependence, plus identical reduced and frozen measurements, identifies brighter camera-right glyph and lighting pixels as the measurement mass, not residual gaze or idle yaw. The visual silhouette is centred and the ±8 px threshold-55 bound remains appropriate; the experiment does not claim to prove internal geometry symmetric.
- The responsive rail uses one literal `rail-visible` state rather than separate focus and mobile classes. It is initialised visible on desktop and hidden below 760 px; crossing the breakpoint preserves the state, so desktop focus can always reopen controls on mobile.
- The smoke originally targeted a non-existent `studio.html`; Vite history fallback returned the studio document with status 200, masking the mistake. The oracle now targets `index.html` and asserts the resolved `/hologlyph/index.html` pathname.
- The presentation CSS was re-indented and expanded to the existing stylesheet style: one declaration per line, with comments recording the stage-inset alignment decision and narrow-stage constraint.
