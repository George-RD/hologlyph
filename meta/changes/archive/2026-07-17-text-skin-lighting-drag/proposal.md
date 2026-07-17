# Proposal: text-skin-lighting-drag

## Motivation

The bust rendered flat: the emissive glyph glow washed out scene lighting, so
facial topography (nose, brow, eye sockets) did not read through the text skin.
Glyphs were also too small at PLANAR_DENSITY 124, and the demo offered no way
to move the head with the mouse.

## Scope

- Modulate glyph luminance with a monochrome skin-shading term so 3D features
  read through the text.
- Larger glyphs (lower planar projection density).
- Pointer-drag head rotation in the demo, backed by a new MotionEngine seam.

## Out of scope

- Head-follows-mouse idle behaviour (drag only).
- Shader-override public surface.
- Recentre or reset gesture for the dragged pose.
