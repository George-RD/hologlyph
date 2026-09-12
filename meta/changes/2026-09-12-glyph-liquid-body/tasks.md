# Tasks

- [x] Preserve source-labelled teeth and tongue, replacing surface fill with a finer live glyph field.
- [x] Implement fixed-step surface waves, inertial steering and reversible amount control.
- [x] Restore the liquid-off head and guard it with a real pixel comparison.
- [x] Carry the whole rig through placement, including teardown, culling restoration and eye-trim handling.
- [x] Exercise the real renderer on dark/light backgrounds, pointer interaction, mobile framing and reduced motion.
- [x] Add solver-owned host bounds for the carrier origin, including released momentum, resizing, re-formation and reduced-motion placement.
- [x] Add 29 bounds regressions and confirm that removing per-step containment causes failures.
- [ ] Review the final oral density/illumination capture against the concept.
- [ ] Replace the inherited face perimeter with a genuinely free liquid boundary; inspect the rig/surface handover in both directions with a fixed camera.
- [ ] Derive host insets from the rendered footprint and resolve liquid-specific obstacle interactions before general embedding. Carrier-origin bounds alone do not satisfy this item.
- [ ] Verify the final free-boundary renderer on dark, light and patterned backgrounds, including interrupted transitions and explicit backend/mobile observations.
- [ ] Run the authoritative Cairn gate and obtain visual acceptance before any merge or public-demo change.

The completed renderer-capture items refer to the historical evidence recorded in
`implementation-notes.md`, not visual approval of the current or future branch
head. Bounds runtime verification is recorded separately under the 13 September
continuation. PR #98 stays draft; #99 stays open.
