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

## HTML-in-Canvas measurements

Sources: WICG/html-in-canvas README, https://html-in-canvas.dev/docs/browser-support/,
https://developer.chrome.com/blog/html-in-canvas-origin-trial (origin trial
Chrome 148 to 150, flag `chrome://flags/#canvas-draw-element`, no Firefox or
WebKit implementation announced).

Run against Google Chrome 150.0.7871.129 with
`--enable-blink-features=CanvasDrawElement`, page `demo/html-in-canvas-spike.html`,
driver `tools/smoke/html-in-canvas-spike.mjs`.

| Probe | Result |
| --- | --- |
| Live DOM into a WebGL2 texture per frame | works, 480 frames at 8.33 ms mean, 9.3 ms p95, vsync-bound |
| Draw an ancestor (`document.body`) | `InvalidStateError: Only immediate children of the <canvas> element can be ...` |
| Draw an element outside any canvas subtree | same `InvalidStateError` |
| Same-origin control region | differing 424/9216, mean rgba 57,172,255,255, canvas readable |
| Cross-origin `img` (loaded successfully) | differing 0/2304, mean rgba 51,170,255,255: silently omitted |
| Cross-origin `iframe` | differing 6400/6400, mean rgba 255,255,255,255: blank box |
| Click at the refracted position | hits the container, `activeElement` stays `BODY` |
| Focus programmatically then type | works, value becomes `ZZrefraction` |

API shape as built: `texElementImage2D` has arity 3,
`(target, internalformat, element)`, internalformat must be sized. The
six-argument form in the Chrome blog throws
`TypeError: The provided value is not of type '(Element or ElementImage)'`.
`HTMLCanvasElement` exposes `onpaint`, `requestPaint`, `captureElementImage`,
`getElementTransform`. Drawing an element with no paint record throws
`InvalidStateError: No cached paint record for element`.
