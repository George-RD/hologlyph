# Proposal: studio-showcase-overhaul

## Motivation

The deployed studio needed to frame the renderer within its visible stage, make
speech and camera framing demonstrable, and replace private renderer access with
public engine controls.

## Scope

- Centre and continuously resize the renderer against the visible stage.
- Add public camera framing, orbit, gaze, speech, and compact presentation
  controls to the studio.
- Add browser smoke coverage for layout, camera interaction, speech, gaze
  suppression, and browser diagnostics.

## Out of scope

- Exposing renderer internals to the studio.
- Changing the shipped avatar or default visual treatment.
