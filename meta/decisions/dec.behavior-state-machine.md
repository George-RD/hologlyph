---
id: dec.behavior-state-machine
nodes: [hologlyph.runtime.behavior, hologlyph.runtime.core]
status: accepted
date: 2026-07-08
informed_by: [res.facial-behavior, src.deep-research-2]
---

Behavior is an explicit state machine (hidden, emerging, idle/listening, speaking, thinking, reacting-to-scroll, departing/submerging), not one continuous procedural animation loop. This is easier to author, optimize, and let site owners control than improvising from the start.

Transitions are driven by: viewport visibility (IntersectionObserver), speech events (speak/stream/pause), scroll progress, and latency gaps (brief `thinking` on stalls). Capabilities: emerge-from-pool on entry, idle-listening when settled, submerge on exit (or freeze when mostly offscreen), full render suspension when the tab is hidden.
