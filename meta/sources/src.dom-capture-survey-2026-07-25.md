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
  Re-read 2026-07-27 through the Bugzilla REST API: RESOLVED FIXED, last
  changed 2022-05-18. Its dependency, bug 1765525, is VERIFIED FIXED as of
  2022-06-06. Both landed before Firefox 103 shipped `backdrop-filter`
  unflagged in July 2022, so no release Firefox has ever carried the defect.
  This entry was the whole basis of `todo.liquid-glass-firefox-verify`, which
  is closed on the strength of re-reading it (`dec.liquid-glass-compositor`).
- Firefox bug 1782876, backdrop-filter fails when a PARENT has
  transform/opacity/clip-path/mask-image:
  https://bugzilla.mozilla.org/show_bug.cgi?id=1782876
  UNCONFIRMED and still open, last changed 2025-01-16. Comment 3 (2025-01-04)
  reports the original cases fixed in Firefox 133 but a surviving one where a
  parent has `border-radius`, `position` and `overflow: hidden`. This is an
  ANCESTOR problem rather than a self-clip problem, and it is the live
  constraint on rung 2, not 1579957.
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
| Firefox 141.0.3 (stock, `/Applications/Firefox.app`) | Five routes attempted 2026-07-27, see below | Not obtained | Not obtained |

### Firefox retry, 2026-07-27

A real Firefox 141.0.3 is installed on this host, so the verdict was attempted
again. Every non-interactive route is closed, and the reasons are host
capability rather than the web platform:

| Route | Outcome |
| --- | --- |
| Playwright 1.61.1 `firefox` with `channel: 'moz-firefox'` (WebDriver BiDi against the stock build), headed | Hangs at `launch()`; killed at 180 s with no page |
| Headed launch plus desktop capture | macOS Screen Recording permission is not granted to this process: the computer tool returns `DESKTOP_PERMISSION_DENIED` and `screencapture` returns `could not create image from display` |
| `firefox --headless --screenshot` | Same SWGL failure as the Playwright build: `RenderCompositorSWGL failed mapping default framebuffer`, no PNG written |
| `firefox --remote-debugging-port 9223` | Process starts headed but never opens the BiDi listener, so no `browsingContext.captureScreenshot` |
| `firefox --marionette` on a throwaway profile with `marionette.port` set (retried 2026-07-27) | Process starts headed and paints the page, but port 2828 never accepts a connection inside 60 s. Same shape as the `--remote-debugging-port` failure and preceded by the same `sandbox_extension_issue_file_to_process ... Operation not permitted` line, so this host denies the browser its listener socket rather than the protocol being unavailable |

`--headless --screenshot` was retried directly against the stock build on
2026-07-27 and fails identically to the Playwright build, so that row is
confirmed rather than inferred. It would not have settled the question anyway:
headless macOS Firefox composites through SWGL, not the GPU WebRender path the
design depends on, so a clip verdict read from it would not be evidence about
bug 1579957.

The page itself loads and renders in a headed window (`demo/backdrop-clip-spike.html`
served from the demo dev server), so the only missing piece is a way to read
pixels back. `todo.liquid-glass-firefox-verify` therefore stays `blocked`, and
the blocker is now precise: it needs either Screen Recording permission granted
to the agent process, or a human to look at the window and report whether the
frost is blob-shaped or rectangular.

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

## Backdrop root spike, 2026-07-27

`tools/smoke/backdrop-root-spike.mjs`. Mounts a `backdrop-filter` layer inside
a shadow root exactly as `<hologlyph-head>` builds it, under seven ancestor
shapes, and probes screenshot pixels with the filter on and off. Chromium 141
against the installed Google Chrome, DPR 1, no dev server.

| ancestor shape | centre delta | corner delta | verdict |
| --- | --- | --- | --- |
| none | 13 | 0 | live backdrop, confined |
| host `contain: layout paint` | 13 | 0 | live backdrop, confined |
| host `contain: layout` | 17 | 0 | live backdrop, confined |
| host `contain: strict` | 13 | 0 | live backdrop, confined |
| ancestor `transform: translateZ(0)` | 13 | 0 | live backdrop, confined |
| ancestor `overflow: hidden` + `border-radius` | 0 | 0 | DEAD, empty backdrop |
| ancestor `opacity: 0.99` | 0 | 0 | DEAD, empty backdrop |

Containment on the shadow host is safe, so the shipped element needs no style
change. The two dead rows are host page structures the library does not own.
The `overflow: hidden` plus `border-radius` row independently reproduces
Mozilla bug 1782876 comment 3, in a different engine, which is corroboration
that the probe measures what it claims to.

Headless WebKit reported every row dead, including the unwrapped control, so it
composites no `backdrop-filter` at all and is not evidence either way. It joins
headless Firefox in the table of routes that cannot answer a compositing
question on this host.
