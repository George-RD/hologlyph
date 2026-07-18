# Design: 2026-07-18-lifecycle-repair

## Approach

Keep the existing module boundaries and solve all fixes by sequencing and ownership
guards inside current contracts:

- `RendererHost` keeps a single in-flight init promise and a post-init disposed
  check so teardown during async `init()` cannot leak a created renderer.
- `Engine` mounts serialise through a generation token and per-generation local
  candidate state so only the latest successful mount attaches avatar/material and
  observers.
- `AssetLoader` releases and clears its KTX2Loader instance in `dispose()`.
- `Engine` tracks displaced materials, disposes each unique material once, and
  recursively disposes their texture maps at teardown.
- `Engine` gains `resize` on its contract and delegates to `RendererHost.setSize`,
  preserving pixel ratio clamping and camera aspect updates.

## Changes

ADDED:
- Lifecycle tests for disposal races, mount supersession, and disposal of
  displaced materials/loader resources.
- `Engine.resize()` contract and implementation.

MODIFIED:
- `src/contracts.ts` to add `resize` to `Engine`.
- `src/renderer/renderer-host.ts` for init concurrency and disposal safety.
- `src/core/engine.ts` for serialised mounts, avatar local candidates, observer
  uniqueness, and displaced material cleanup.
- `src/asset/loader.ts` for KTX2 worker disposal.
- `test/core.test.ts`, `test/asset.test.ts`, and `test/renderer.test.ts` with
  new regression coverage.

REMOVED:
- No removed components.

RENAMED:
- No renames.
