# Proposal: liquid-glass-chromium-lens

## Motivation

Item 5 of `dec.liquid-glass-architecture`, the Chromium half of rung 3 on the
backdrop ladder.

Item 4 shipped true per-pixel lensing on every engine by rasterising a subtree
the host names. The price of working everywhere is that the pixels are frozen:
a CSS animation behind the head does not move in the refraction, and neither
does a value someone is typing. Chromium behind
`--enable-blink-features=CanvasDrawElement` can paint real DOM into a canvas at
vsync, measured in `demo/html-in-canvas-spike.html` at 8.33 ms per frame over
480 frames, which is the only route to a lens that is actually live.

It is Chromium-only, flag or trial gated, origin-trialled Chrome 148 to 150,
and it silently drops cross-origin images. So it is an enhancement, never
load-bearing, and its absence is the normal case.

## Scope

- A capability probe for both halves of the flag, at the prototype, costing
  nothing on the mount path of a head that refracts nothing.
- A second gate on the shape of the named subtree: an immediate child of a
  `<canvas layoutsubtree>`, which is the only arrangement the platform allows
  and the only one the spike measured.
- A live `LensSource` that uploads the subtree every frame and produces the
  same binding the snapshot lens does, so nothing downstream knows which one it
  is holding.
- Engine selection between the two, with a host-supplied rasteriser always
  choosing the snapshot path.
- A warning when the head covers an interactive control inside the refracted
  subtree, because hit-testing follows the undistorted layout box.
- Lab page `demo/live-lens-lab.html` and smoke script
  `tools/smoke/live-lens-shot.mjs`, which runs the page with the flag on and
  with it off.

## Out of scope

- Any new public API. `refract="#hero"` and `engine.setLensSource` are
  unchanged; the enhancement engages by detection, not by a new switch.
- Uploading through `texElementImage2D` into a raw GL texture. Reasons in
  `design.md`.
- Making the head refract the page BEHIND it. That is still impossible, and
  rungs 2 and 4 are where the rest of the ladder lives.
- Anything that changes the shipped head. `bun run eval` must stay at its
  current baseline, and it does.
