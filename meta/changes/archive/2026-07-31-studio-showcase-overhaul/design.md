# Design: studio-showcase-overhaul

## Approach

The stage owns its renderer dimensions through a `ResizeObserver`, excluding the
fixed control rail from aspect calculation. Camera framing is held in public
`Engine.view` state, so sliders and direct manipulation share one declarative
pose without reaching into renderer internals. Speech stays on the engine-owned
viseme path, while camera dragging coalesces gaze updates and temporarily
suppresses gaze follow.

## Changes

ADDED:
- Studio camera, speech, orbit, and focus controls.
- Browser smoke coverage for presentation behaviour.

MODIFIED:
- Studio stage layout, responsive rail, and renderer resize lifecycle.

REMOVED:
- Private camera framing from the studio.

RENAMED:
- None.
