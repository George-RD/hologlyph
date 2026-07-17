# Design: text-skin-lighting-drag

## Approach

Compute an analytic matte-skin shading term in the TSL graph: half-lambert
diffuse against the scene's key and fill directional light directions in world
space, plus an ambient floor, clamped to [SHADE_FLOOR, 1]. Multiply it into the
emissive glyph glow only; colorNode stays lit by the real scene lights to avoid
double shading. The un-shaded cool fresnel rim is kept for the holo contour.
Lower PLANAR_DENSITY from 124 to 92 for roughly 35 percent larger letters.

For interaction, add MotionEngine.setHeadTarget(yaw, pitch): a clamped,
exponentially smoothed additive head orientation applied on top of nods and
gaze, with a 0.35 fraction applied to the neck bone and reduced-motion snap.
The demo maps pointer drag on the canvas to this target via setPointerCapture.

## Changes

ADDED:
- SHADE_KEY_WEIGHT, SHADE_FILL_WEIGHT, SHADE_AMBIENT, SHADE_FLOOR constants and
  the shade term in src/shaders/materials.ts.
- MotionEngine.setHeadTarget(yaw, pitch) in src/contracts.ts and
  src/motion/index.ts (drag state, smoothing, clamps, neck follow).
- Pointer-drag wiring in demo/main.ts.
- Four motion tests and shader constant pins.

MODIFIED:
- PLANAR_DENSITY 124 to 92 in src/shaders/materials.ts.
- Emissive node now multiplied by the shade term.
- test/core.test.ts FakeMotion gained a no-op setHeadTarget.

REMOVED:
- None.

RENAMED:
- None.
