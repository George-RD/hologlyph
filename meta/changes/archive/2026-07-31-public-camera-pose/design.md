# Design: public-camera-pose

## Approach

Keep `PerspectiveCamera` renderer-owned. `EngineImpl` resolves a partial pose
against live state, validates finite values, clamps or wraps them, and applies
the resolved values to the renderer camera. Construction resolves the optional
initial pose before the renderer's first draw.

## Changes

ADDED:
- `ViewPose` and Engine view APIs.
- Contract tests for pose resolution and lifecycle durability.

MODIFIED:
- Core composition and renderer camera application.
- Five development labs.

REMOVED:
- Direct lab access to `EngineImpl.sysRenderer.camera`.
