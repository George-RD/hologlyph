---
id: dec.liquid-free-boundary
nodes:
  - hologlyph.runtime.shaders
status: accepted
date: 2026-09-13
---
# Give the full-liquid state its own closed surface

## Context

Issue #99 records a failed visual criterion in #98: flattening the authored head leaves a facial perimeter. The owner explicitly requires a non-head liquid state. The previous uncertainty about whether the head may stop being a head is resolved.

## Decision

Use a closed, low-resolution surface whose outline has no dependency on avatar vertices. Four bounded angular modes describe a connected moving boundary. Damped mode velocities respond to the actual constrained carrier acceleration and explicit impulses. Advance them inside the existing LiquidDynamics fixed step, never from a second timer. Normalise the planar area analytically and bound the sum of mode amplitudes so the radial boundary stays positive.

The existing collapse remains the first transition stage. During handover, project its shell towards the same closed surface and replace it with the dedicated mesh. Preserve the live glyph atlas and wave texture. Restore authored geometry, bones, mouth and viseme ownership on re-formation. No reference artwork or camera movement may substitute for the handover review.

Expose a conservative full-liquid footprint derived from the maximum boundary excursion and wave height. Host insetting must report when the body cannot fit, rather than returning an origin that still clips. The carrier continues to enforce the supplied origin bounds at every fixed step, including release and re-formation.

This stays within the shaders node and its existing dependencies. Add the regression tests to that node's ownership. No compute-only backend or new cross-container edge is needed.

## Scope and verification

This is a reduced-order, single connected free-surface model, not a Navier-Stokes or volumetric particle simulation. It does not support pinch-off, multiple blobs, arbitrary obstacles or exact conservation of the transitioning head's volume. The area invariant belongs to the radial footprint, not to the entire animated mesh.

Require boundedness, area, release, fixed-step, reduced-motion and disposal regressions; a negative control that removes boundary forcing; the unchanged normal-mode pixel comparison; fixed-camera transitions and interruptions on dark, light and patterned backgrounds; explicit renderer/mobile-viewport observations; the existing visual evaluator and negative control; the complete project gate and Cairn hook all before merge. Keep unverified work draft. The snapshot helper branch is tooling only and must not land in an integration branch.
