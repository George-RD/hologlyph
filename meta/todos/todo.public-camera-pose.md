---
node: hologlyph.runtime.core
status: open
created: 2026-07-28
---

# There is no public way to frame the head

Found while building `demo/studio.html`, the consolidated control surface. It is
the first demo page intended to be deployable rather than dev-only, and it is
the first to hit this.

## The gap

Framing the bust means moving the camera, and the camera is
`EngineImpl.sysRenderer.camera`. `sysRenderer` is a private field and is not on
the `Engine` contract, so there is no public route to it.

Five lab pages reach in anyway: `fluid-lab`, `interior-glyph-lab`, `melt-lab`,
`pool-lab` and `stage-lab`. They are throwaway spikes and are deliberately
excluded from `demo/vite.config.ts`, so their reaching in never ships. That is
not a precedent worth extending: `studio.html` is in the deployed set, so it was
built without camera controls instead, and the head is judged at whatever
framing the engine chose.

A host embedding `<hologlyph-head>` has the same problem, and less recourse.
"Show me the head slightly from above" is an ordinary thing to want.

## The shape of a fix

A small pose method on the `Engine` contract, not the raw camera. Exposing a
three `PerspectiveCamera` would put a three type in the public surface and let a
host invalidate the renderer's own state; a pose is declarative and clamps.

Something like `setView({ height, distance, yaw, lookAt })`, all optional, all
clamped, reconciled the way `setHeadConfig` is so it holds however it was
called. It also wants to survive a resize and an avatar replacement.

This is a contract change, so it needs a decision artefact under
`meta/decisions/` before it is built, and the deferred-seam list in
`dec.liquid-glass-architecture` is the right place to note it.

## Acceptance

`demo/studio.html` regains height, distance, orbit and look-at controls with no
reference to `sysRenderer`. The five lab pages can be migrated to it, though
that is not required. Framing survives a window resize and an avatar swap. The
shipped default view is unchanged, so `bun run eval` passes against the existing
baseline.
