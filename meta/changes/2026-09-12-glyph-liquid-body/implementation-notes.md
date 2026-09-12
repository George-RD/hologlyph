# Glyph mouth and liquid body

Status: draft PR #98, stacked on the source-labelled mouth in #96. The public demo and integration branches are unchanged. This is not visual parity approval.

## Owner intent

Teeth and tongue are made from smaller coloured letters, like the eyes, with a dark mouth cavity. The head becomes liquid, can be disturbed and steered across the page, and re-forms at its travelled position. The reference is a visual target, not evidence of the current renderer.

## Recovery, 12 September

The previous implementation passed its pure solver tests but its browser images contained a nearly black head at liquid amount zero. The existing visual evaluator correctly failed. The saved `surfaceProbe` controls isolated the regression: replacing the normal graph recovered the glyph face; disabling depth testing did not.

Colour must read the resolved `normalView`, not directly evaluate the custom `normalNode` that itself depends on `normalView`. Front and back retain their own original normal chains. The wrapper also now evaluates the original normal outside separate conditional branches: `normalView` is a cached variable in Three r178, and the conditional wrapper left the off path flat-shaded. The final controlled actual/reference capture is pixel-identical, not just visually similar.

The position wrapper previously hid its input graph in a closure. Explicit bounded node expressions preserve the upstream skinning/morph/legacy deformation edges, and the existing live-flow wiring test passes again. Vertex wave sampling uses an explicit typed LOD.

Placement now carries the complete rig through a scene transform, not just its rendered vertices. Authored eye trim is hidden during deformation and restored with the re-formed head. The scene binding restores prior culling/visibility and hierarchy on disposal. Legacy stationary pool/collider logic is suspended when its original-space profile is no longer applicable; the compositor hull and interior glyph field are suspended while deforming.

## Observed evidence at bcb89a1

- CI run 34715560511: type-check, lint, tests and build passed. Mobile state and six-viewport interaction checks, visual scoring and its negative control passed.
- Mouth run 34715560485, artifact 10303894273: the controlled liquid-off head had mean pixel difference 0 from the original material graph.
- The same browser run captured dark/light oral close-ups, intermediate collapse states, slosh, release, re-formation, pointer drag, mobile framing and reduced motion. No browser errors were recorded.
- After travel and re-formation, the solver position and the rig carrier both equalled `[0.41372288845878, 0.36168496672178885, 0]` (the solver exposes only X/Y). Authored trim returned visible. Reduced-motion state was amount 0 with wave energy 0.
- `mouth-anatomy/liquid/collapse-100.png` still shows a recognisably flattened head boundary, with a pointed facial projection and lateral lobes. This fails the visual escalation criterion in `dec.liquid-glass-melt`. Passing regression checks does not make this a convincing liquid perimeter.

The final oral tuning after those captures reduces over-fine tooth/tongue sampling and raises stroke illumination without restoring an enamel fill. It needs its own exact-head browser capture; the bcb89a1 images are evidence for the preceding runtime, not that later tuning.

## Model boundary and next required work

This branch implements a damped, fixed-step surface-wave model on the existing mesh, plus inertial placement. It does not implement a moving free boundary, separate blobs merging, detached droplets or a volumetric solver. The unperturbed reference collapse has a positive unit Jacobian; exact volume conservation of the complete animated, wave-perturbed mesh has not been established.

The next liquid slice must free the boundary from the face topology while preserving the proven placement/lifecycle and the rig's speech path. Judge the handover in motion and the full-liquid perimeter before extending collisions or adding decorative effects. A WebGPU-only solver is not assumed: the fallback and mobile cost need an explicit decision backed by a small prototype.

## Verification environment

The connected GitHub source and existing CI are available. This session's local container cannot resolve GitHub and the public archive download failed, so there is no complete local checkout or dependency installation. No local project-wide gate or Cairn run is claimed. No workflow or gate was weakened.

Keep the PR a draft until the current exact-head checks, rendered visual acceptance and the authoritative Cairn gate are complete. Owner approval of the look remains outstanding.
