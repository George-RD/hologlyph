# Tasks

- [x] Preserve source-labelled teeth and tongue, replacing surface fill with a finer live glyph field.
- [x] Implement fixed-step surface waves, inertial steering and reversible amount control.
- [x] Restore the liquid-off head and guard it with a real pixel comparison.
- [x] Carry the whole rig through placement, including teardown, culling restoration and eye-trim handling.
- [x] Exercise the real renderer on dark/light backgrounds, pointer interaction, mobile framing and reduced motion.
- [x] Add solver-owned host bounds for the carrier origin, including released momentum, resizing, re-formation and reduced-motion placement.
- [x] Add 29 bounds regressions and confirm that removing per-step containment causes failures.
- [ ] Review the final oral density/illumination capture against the concept.
- [x] Replace the inherited face perimeter with an independent moving closed surface.
- [ ] Inspect the final rig/surface handover in both directions with a fixed camera.
- [x] Derive host insets from the full-liquid footprint, including perspective depth and malformed-input rejection.
- [ ] Resolve arbitrary liquid-specific obstacles before unrestricted embedding; deferred beyond the connected-boundary slice in #99.
- [ ] Verify the final free-boundary renderer on dark, light and patterned backgrounds, including interrupted transitions and explicit backend/mobile observations.
- [x] Run the full local language battery and authoritative Cairn scan/hook on the completion candidate.
- [ ] Complete current-head repository CI and inspect the final visual evidence before merging.

The completed renderer-capture items refer to the historical evidence recorded in
`implementation-notes.md`, not visual approval of the current or future branch
head. Bounds runtime verification is recorded separately under the 13 September
continuation. Final gate and merge evidence is recorded on PRs #98 and #99. The local
completion gate is not a claim that their pending renderer review has passed.
