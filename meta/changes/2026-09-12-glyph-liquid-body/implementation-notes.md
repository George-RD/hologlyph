# Glyph mouth and liquid body

Status: draft PR #98, stacked on the source-labelled mouth in #96. The public demo and integration branches are not changed.

## Owner intent

Teeth and tongue are made from smaller coloured letters, like the eyes, with a dark mouth cavity. The head becomes liquid, can be disturbed and steered across the page, and re-forms at its travelled position. The reference is a visual target, not evidence of the current renderer.

## Recovery, 12 September

The previous implementation passed the pure solver tests but its browser images contained a nearly black head at liquid amount zero. The existing visual evaluator correctly failed. The saved `surfaceProbe` controls isolated the regression: replacing the normal graph recovered the glyph face; disabling depth testing did not.

The liquid material and mouth colour were directly evaluating the custom `normalNode` graph. That graph contains `normalView`, which in Three r178 resolves `setupNormal` outside the NORMAL sub-build. Colour must read the resolved `normalView` instead. Each side of the body also needs its own original normal chain, not a shared front-facing normal.

The position wrapper hid the original graph in a closure. Replacing it with explicit bounded node expressions preserves the upstream skinning/morph/legacy deformation edges and makes the existing live-flow wiring test meaningful again. Vertex wave sampling requests an explicit LOD.

The earlier captures also show detached eye trim and an oversized, poorly framed puddle. These are unresolved visual defects, not accepted effects.

## Model boundary

This branch implements a damped, fixed-step surface-wave model on the existing mesh, plus inertial placement. It does not yet implement free-surface splitting, merging streams, detached droplets or a volumetric fluid solver. The unperturbed reference collapse has a unit positive Jacobian; exact volume conservation of the whole animated, wave-perturbed mesh has not been established.

## Verification and environment

The connected GitHub source and existing CI are available. This session's local container cannot resolve GitHub, and the public archive download also failed, so there is no complete local checkout or dependency installation. No local project-wide gate or Cairn run is claimed. Changes are isolated on the existing draft for the repository's existing checks; no workflow or gate is weakened.

Final acceptance requires type-check, lint, full tests, build, visual evaluation including its negative controls, reviewed head/mouth/liquid images on dark and light backgrounds, and the authoritative Cairn gate. Keep the PR a draft until those checks and the remaining scene/interaction work are resolved.
