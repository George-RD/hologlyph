# Design: shading-lab-landing

## Approach

Capture-only landing: commit the lab exactly as owner-tuned, make the
approved config the single source of truth (source artefact), and set the
lab's boot state to it so a fresh checkout reproduces the look. No library
changes; the port into src/ stays a decision-gated TDD todo.

## Changes

ADDED:
- demo/feature-shading-lab.html, demo/feature-shading-variants.html,
  demo/TEXT-LAYERS.md, demo/LAB-STATUS.md
- tools/smoke/lab-shot.mjs, tools/smoke/feature-variants-shot.mjs
- meta/sources/src.owner-approved-look-2026-07-21.md
- meta/todos: textskin-port-owner-config, lab-control-refinements,
  background-adaptive-look

MODIFIED:
- Lab boot defaults + 'Owner 07-21' preset = owner config (was V5-era
  defaults); irisHue slider boots at the approved hue.

REMOVED:
- Dead GLOW_GAIN constant in the lab (glow lives in U.glowGain).
