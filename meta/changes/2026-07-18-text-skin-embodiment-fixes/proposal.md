# Proposal: 2026-07-18-text-skin-embodiment-fixes

## Motivation

The talking-head demo exposed several embodiment defects: projected glyphs could
float during bone rotation, dense text became illegible, shell translucency
revealed eye interiors, and grazing-angle planar projection smeared side-facing
glyphs into streaks. The skin also needs readable GPU row flow and glyph-carried
surface shading.

## Scope

- Keep glyph UVs anchored to bind-pose geometry under head and neck rotation.
- Use a legible high-resolution canvas with sharp filtering.
- Encode key, fill, and rim lighting in glyph brightness while leaving the base
  surface nearly transparent.
- Advance rows independently through GPU UV flow.
- Occlude eye interiors while retaining the hologram aesthetic.
- Replace grazing-angle runtime planar sampling with bind-space normal-weighted
  triplanar sampling, based on the accepted decision artefact.
- Add pure mapping tests and complete browser screenshots plus repository gates.

## Out of scope

- Changing the bust mesh, authored UV layout, rig, or asset pipeline.
- Adding per-glyph meshes or CPU redraws during animation.
- Changing public engine or custom-element contracts.
