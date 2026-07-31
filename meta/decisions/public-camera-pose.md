---
id: dec.public-camera-pose
nodes:
  - hologlyph.runtime.core
  - hologlyph.runtime.renderer
status: accepted
date: 2026-07-31
---
# Public camera pose

## Context

The engine owns a Three.js camera inside `RendererHost`. Hosts need to frame the
head, but exposing that camera would let them invalidate renderer state. Five
development labs already reached into `EngineImpl.sysRenderer.camera`, while the
deployed studio could not safely provide the same controls.

## Decision

`Engine` exposes a declarative `ViewPose`, accepted at construction and updated
by `setView`. The resolved pose is readable through `engine.view`; the Three.js
camera remains renderer-owned.

The pose defaults to yaw 0, height 0.05, distance 2.4, look-at 0, and 35 degree
field of view. It resolves to the existing default camera exactly. Partial
updates merge with the live pose. Distance clamps to 0.6 through 12, height and
look-at clamp to -2 through 3, field of view clamps to 10 through 80, and yaw
wraps to (-PI, PI]. Non-finite input is rejected before any renderer state
changes.

## Rationale

A pose is the smallest stable host contract. It expresses framing rather than
renderer mechanics, preserves ownership of aspect and projection updates, and
can be re-applied after renderer lifecycle work. Reading the resolved values
lets a host build controls without importing a library-only default constant.

Using the existing head-configuration reconciliation pattern makes separate
partial calls durable rather than treating each as a fresh camera preset.

## Consequences

- `EngineOptions` can frame an avatar before its first paint.
- Resize retains framing while updating aspect and projection.
- Avatar replacement retains framing after its scene work completes.
- Labs use `setView` and no longer reach through the engine implementation.
- Camera roll, lateral target offsets, and raw projection settings remain
  renderer concerns until a separate contract decision justifies them.
