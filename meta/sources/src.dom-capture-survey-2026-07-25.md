---
id: src.dom-capture-survey-2026-07-25
file: ./meta/sources/src.dom-capture-survey-2026-07-25.md
type: platform survey and measured spike
verification: unverified
date: 2026-07-25
---

# Can a page refract its own backdrop? Survey and spike, 2026-07-25

Primary material behind `res.dom-backdrop-capture`. Two parts: published
platform sources, and measurements taken on this machine.

## Platform sources consulted

- W3C Screen Capture, `getDisplayMedia`:
  https://w3c.github.io/mediacapture-screen-share/#dom-mediadevices-getdisplaymedia
  Normative: "The user agent MUST let the end-user choose which display surface
  to share out of all available choices every time, and MUST NOT use any
  MediaTrackConstraints to restrict or select a specific choice without user
  interaction."
- MDN `BrowserCaptureMediaStreamTrack.restrictTo()`:
  https://developer.mozilla.org/en-US/docs/Web/API/BrowserCaptureMediaStreamTrack/restrictTo
- WebKit bug 245510, `backdrop-filter: url(#svg-filter)` with feDisplacementMap:
  https://bugs.webkit.org/show_bug.cgi?id=245510 (open)
- WebKit bug 142662, elements with backdrop-filter cannot be clipped:
  https://bugs.webkit.org/show_bug.cgi?id=142662 (resolved fixed)
- Firefox bug 1579957, backdrop-filter does not respect clip-path:
  https://bugzilla.mozilla.org/show_bug.cgi?id=1579957
- csswg-drafts issue 10568, exposing view-transition snapshots to script:
  https://github.com/w3c/csswg-drafts/issues/10568
- MDN `backdrop-filter`:
  https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter
- MDN SVG `foreignObject`:
  https://developer.mozilla.org/en-US/docs/Web/SVG/Element/foreignObject
- `naughtyduk/liquidGL` v1.0.6, MIT: https://github.com/naughtyduk/liquidGL
  Code read at `package/liquidGL.js` lines 8, 452-464, 496-510, 272-274.
- `zumerlab/snapdom`: https://github.com/zumerlab/snapdom

## Measurements taken

Host: macOS 27, Apple M2 Max, DPR 2. Page under test:
`demo/backdrop-clip-spike.html`, driven by `tools/smoke/backdrop-clip-spike.mjs`.

| Engine | How | Clipping result | Frame cost, animated 60-point clip-path |
| --- | --- | --- | --- |
| Google Chrome 2026 | Playwright, headed, real GPU, vsync disabled | Clips correctly: corner delta 0, centre delta 38 | 0.44 ms at blur 16, 0.46 ms at blur 32, 0.59 ms at blur 64, 0.59 ms full viewport at blur 16 |
| Safari 26 | Opened directly, window captured with `screencapture` | Renders the blob-shaped frosted glass over sharp page text | Not measured |
| Playwright WebKit 26.5 | Headless | Inconclusive: composites no filter at all | 33 ms, software raster, meaningless |
| Firefox 151 (Playwright) | Headed and headless | Not obtained | Browser fails to start on this host: GPU helper failure headed, `RenderCompositorSWGL failed mapping default framebuffer` headless |

An earlier vsync-locked Chrome run reported 8.33 ms for every mode including the
no-filter baseline, which establishes only that the effect fits inside a frame.
In the uncapped run a static clip path generates no damage and stays throttled,
so only the animated rows carry information.
