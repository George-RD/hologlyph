# Land the feature-shading lab and the owner-approved look

## Why

Three lab sessions (2026-07-18 to 2026-07-21) produced an owner-approved
text-skin look and a working control surface, all living as untracked demo
scaffolding. "In its current form, im way happier than yesterday" - time to
capture it durably: the lab page, its documentation, the ratified config as
a source artefact, and the boot defaults set to that config.

## What

- Commit demo/feature-shading-lab.html with boot defaults and an
  'Owner 07-21' preset equal to the owner's exported config JSON.
- meta/sources/src.owner-approved-look-2026-07-21.md: the config verbatim,
  with the owner's caveat that the control SET is still evolving.
- Commit demo/TEXT-LAYERS.md (layer explainer), demo/LAB-STATUS.md
  (session-state tracking), demo/feature-shading-variants.html (historic
  comparison grid), tools/smoke lab capture scripts.
- Todos for the agreed follow-ups: library port seeded from the config;
  caruncle size control, tighter lips band, overlap seam; background
  switcher + adaptive/opaque-core exploration.

## Non-goals

- No src/ changes: the library port is todo.textskin-port-owner-config,
  a decision-gated TDD build.
- No eval baseline change: the shipped demo look is untouched.

## Affected nodes

- hologlyph.runtime.shaders (lab scaffolding + look canon; no src change)
- meta only otherwise
