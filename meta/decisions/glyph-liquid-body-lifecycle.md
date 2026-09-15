---
id: dec.glyph-liquid-body-lifecycle
nodes:
  - hologlyph.runtime.core
  - hologlyph.runtime.shaders
status: accepted
date: 2026-09-12
---
# Keep liquid simulation and placement on the existing engine lifecycle

## Context

The owner wants the glyph head to become a liquid body, travel across a page and re-form where it moved. PR #98 extends the source-labelled mouth from #96. Neither PR is approval to deploy a new look.

## Decision

The shaders module owns the fixed-step surface solver, its texture, the deformation graph and a scene-carrier binding. Core binds the complete avatar only after its bones, internal meshes and overlay passes exist, and unbinds it before replacement or disposal. The existing VFX update advances the solver. There is no independent simulation timer.

Placement is a scene transform carrying the bones and all meshes together. It must not be a vertex-only offset that leaves eye trim, culling bounds or projected outlines at the old position. CPU culling is suspended while the mesh is deforming, then its previous flags are restored. Authored eye trim is hidden during the transition and restored with the head; it is not replaced with invented geometry.

The existing stationary pool and head-based collision profile are suspended after the body changes shape or location. The baked compositor hull and interior glyph field are suspended during deformation. They must not silently claim support for a travelling free surface. Normal head behaviour at the origin is unchanged.

The experimental `liquidBody(engine.vfx)` accessor is exported for the review page and early host integration. Coordinates are model-space X/Y offsets, not page pixels. The review page owns pointer projection, camera framing and its target-placement limits. The core remains the only owner of simulation and rendering.

Tests for the new solver, renderer binding, normal regression and scene carrier belong to the existing shaders module. Add their paths to the blueprint; no new container or cross-module dependency is required.

## Limits and acceptance

This is a shallow surface-wave model, not a free-boundary volumetric solver. It does not implement pinching droplets, merging streams, or liquid collisions with arbitrary DOM shapes. Pointer target limits are not physical containment walls; released momentum still needs a bounded host placement policy before general embedding.

The existing escalation criterion in `dec.liquid-glass-melt` still applies: if the full-liquid boundary reads as flattened facial anatomy rather than a surface-tension edge, the mesh-only approach has not met the visual goal. Do not add decorative ripples and call that criterion passed.

Acceptance requires actual rendered head/mouth/liquid evidence, preservation of the liquid-off head, the existing visual evaluator and its negative controls, all project checks and the authoritative Cairn gate. Keep the work in a draft until those are met. This decision records lifecycle ownership, not visual approval.
