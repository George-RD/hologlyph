---
id: dec.scroll-timeline
nodes: [hologlyph.runtime.behavior]
status: accepted
date: 2026-07-08
informed_by: [res.facial-behavior, src.deep-research-2]
---

Scroll interaction is a behavioral timeline, NOT a CSS scroll-driven animation. The cross-browser core derives normalized scroll progress in JS (IntersectionObserver for enter/exit, ResizeObserver for container layout, requestAnimationFrame for display-synced updates, Page Visibility for tab-suspend) and drives the state machine + animation mixer.

CSS scroll-driven animations are treated as an optional enhancement only: MDN/web-features still mark them "Limited availability" / not Baseline (Firefox blocked) as of mid-2026. The primary control system must not depend on them.
