---
id: res.dom-backdrop-capture
date: 2026-07-25
nodes: [hologlyph.runtime.shaders, hologlyph.runtime.renderer, hologlyph.runtime.core]
sources: [src.dom-capture-survey-2026-07-25]
---

# Refracting the host page: what the platform actually allows

Question: the hologlyph canvas is transparent and sits over a host page. Can the
head refract the real page content behind it?

## Verdict

No browser API as of 2026 lets a page sample its own rendered backdrop into a
WebGL or WebGPU texture at 60 fps without a user permission prompt. Every route
fails on one of: prompt required, cannot sustain 60 fps, or the pixels are
readable only by the compositor and never by script.

| Mechanism | Prompt | Live at 60 fps | Readable by WebGL | Verdict |
| --- | --- | --- | --- | --- |
| Element/Region Capture via `getDisplayMedia` | Yes, mandatory picker | Yes | Yes | Dead for a drop-in library |
| DOM rasterisers (`snapdom`, `modern-screenshot`, `html2canvas`) | No | No, 10 to 150 ms per capture | Yes | Snapshot only |
| SVG `foreignObject` plus `drawImage` | No | No | Yes, if untainted | Snapshot only, breaks on cross-origin subresources and non-embedded fonts |
| `backdrop-filter: blur()` | No | Yes | No | Live, compositor only |
| `backdrop-filter: url(#feDisplacementMap)` | No | Yes | No | Chromium only, WebKit 245510 open |
| Firefox `element()` / `-moz-element()` | No | Yes | No | Firefox only, CSS only |
| View Transitions snapshots | No | n/a | No | Pseudo-element pixels are not exposed (csswg-drafts#10568) |
| Houdini paint worklet | No | n/a | No | `PaintRenderingContext2D` is write-only |

The screen-capture spec is explicit: the user agent "MUST let the end-user
choose which display surface to share out of all available choices every time,
and MUST NOT use any MediaTrackConstraints to restrict or select a specific
choice without user interaction".

## What liquidGL actually does

`naughtyduk/liquidGL` (MIT, 775 stars) is cited as solving this. It does not.
Read at `package/liquidGL.js`:

- Line 8: `import html2canvas from "html2canvas";`
- Lines 452 to 464: `html2canvas(this.snapshotTarget, { ... scale, ignoreElements })`
- Lines 496 to 510: `gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas)`
- Lines 272 to 274, the whole refraction model:
  `offsetAmt = (edge * u_refraction + pow(edge, 10.0) * u_bevelDepth)`, a 2D UV
  displacement weighted by distance to a rounded-box SDF. Not an IOR trace.

It snapshots the whole document once, then scrolling only moves the sampled UV
window, which is why scroll sync is free. Static content and video work;
CSS animations behind the pane do not, unless each element is registered and
individually re-rasterised (throttled to 33 ms). `position: fixed` elements are
excluded. Initial capture blocks the main thread for 100 to 500 ms on a complex
DOM. `snapdom` is the faster modern replacement for the rasterising step.

## The hybrid that does work

Live page content can be refracted by the compositor even though script cannot
read it: put a `backdrop-filter` layer under the canvas and confine it to the
head silhouette with `clip-path`. WebKit 142662 and Firefox 1579957 both record
this combination failing historically, so it was measured rather than assumed.

Spike: `demo/backdrop-clip-spike.html`, driver `tools/smoke/backdrop-clip-spike.mjs`.

- Google Chrome 2026, real GPU, DPR 2: clip-path clips the filter. Pixel probe
  inside the rect but outside the blob changed by 0 with the filter toggled;
  the blob centre changed by 38. Rewriting a 60-point polygon every frame with
  vsync disabled: 0.44 to 0.59 ms per frame at blur radii 16 and 64, and 0.59 ms
  with the glass covering the full viewport.
- Safari 26 on macOS 27, real window capture: renders correctly, blob-shaped
  frosted glass over sharp page text.
- Firefox: unverified. The Playwright build crashes on this host in both headed
  (GPU helper failure) and headless (`RenderCompositorSWGL failed mapping
  default framebuffer`) modes.
- Playwright WebKit: inconclusive, headless composites no filter at all. Not a
  substitute for real Safari.

Caveat on the timings: the first run was vsync-locked at 8.33 ms across every
mode including the no-filter baseline, which proves only that it fits in a
frame. The sub-millisecond figures come from the uncapped run, where a static
clip path produces no damage and therefore stays throttled; only the animated
rows measure real cost.

## Consequence for the fluid direction

The silhouette polygon is the contract between the two halves. A metaball or
fluid surface produces the same 2D outline that a rigid bust does, so the live
CSS glass follows whatever shape the simulation takes, including a blob
squeezing around page elements. The outline must come from an offline-baked
low-poly hull projected through the head pose on the CPU. Reading canvas alpha
back per frame to derive it would stall the GPU harder than the effect costs.
