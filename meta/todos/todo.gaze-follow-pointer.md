---
node: hologlyph.runtime.motion
status: open
created: 2026-07-17
---

# Gaze Follows The Pointer

Owner request (2026-07-17): the head should look at what the user is looking
at, tracking the pointer on the page, then return to looking forward when the
pointer is idle or leaves. Seam exists: GazeController already has modes and
per-frame eye-bone application; the adapter layer (element/) would need to
observe pointer position relative to the host element and feed a target
direction. Includes head-bone participation (subtle yaw/pitch toward target),
clamped angles, and reduced-motion behaviour (snap-free, damped or disabled).
