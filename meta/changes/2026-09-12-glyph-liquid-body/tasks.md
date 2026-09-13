# Tasks

- [x] Preserve source-labelled teeth and tongue as a finer live glyph field.
- [x] Implement fixed-step waves, inertial steering and reversible amount control.
- [x] Guard the liquid-off head with a real pixel comparison.
- [x] Carry and restore the whole rig, culling flags and authored eye trim.
- [x] Contain targets and released/re-forming momentum with host bounds.
- [x] Add 29 bounds regressions and verify the containment negative control.
- [x] Replace the facial perimeter with an independent moving closed surface.
- [x] Derive perspective-aware footprint insets and reject malformed inputs.
- [x] Guard unusable extents and standalone materials without a bound scene.
- [x] Test near/far clipping in WebGL and WebGPU coordinate systems.
- [x] Inspect candidate glyph mouth, both handover directions, interruptions,
  released placement and re-formation on dark/light/checker desktop/mobile viewports.
- [x] Record actual backend and headless timings, without claiming on-device results.
- [x] Run the full local language battery and Cairn scan/hook on the completion candidate.
- [x] Preserve every mouth/speech check while separating jobs to fit their budgets.

## Merge gate

Completion-candidate evidence and current merge status are recorded on PRs #98
and #99. Exact-head repository CI, the full speech review, rendered visual
acceptance and the Cairn gate are required before either merge. The historical
and candidate captures in implementation-notes.md and completion-review.md do
not certify a later commit merely because it is in the same branch.

## Separate follow-up scope

Arbitrary liquid obstacles, pinch-off and multiple-blob merging are not part of
#99's connected-boundary acceptance. They remain tracked under
`todo.liquid-glass-topology-fluid`, not silently marked complete here.
