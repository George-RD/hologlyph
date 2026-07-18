# Proposal: 2026-07-18-lifecycle-repair

## Motivation

Lifecycle work currently leaves race windows and leaks: renderer init can publish a
renderer after disposal, repeated Engine mounts can replace avatars and observers,
KTX2 workers are not released, and authored materials displaced by the text skin
are leaked. The public Engine surface also lacks a shared resize operation.

## Scope

- Make renderer init/dispose and repeated Engine mounts generation-safe.
- Dispose KTX2 loader workers and displaced authored materials and textures.
- Add `Engine.resize(width, height): void` and delegate renderer sizing, pixel ratio,
  and camera projection updates through the existing RendererHost.
- Add regression coverage for each change with mocked happy-dom seams.

## Out of scope

- Changes to `element/`, adapters, text-skin, or tools/evals.
- Rendering feature changes unrelated to lifecycle and resize ownership.
