---
node: hologlyph.runtime.renderer
status: done
created: 2026-07-25
---

# Verify the compositor glass path in Firefox

CLOSED 2026-07-27 on primary evidence, not by a photograph
(`dec.liquid-glass-compositor`).

Mozilla bug 1579957, "backdrop-filter does not respect clip-path", is RESOLVED
FIXED and was last changed 2022-05-18. The bug it depends on, 1765525, is
VERIFIED FIXED as of 2022-06-06. Both landed before Firefox 103 shipped
`backdrop-filter` unflagged in July 2022, so no Firefox that has ever shipped
the property in a release build carries the defect. This repository had been
treating a four-year-closed bug as an open risk, and a screenshot of one
Firefox window on one host would have been weaker evidence than the tracker
entry that says it was fixed and verified.

Firefox is therefore a supported engine for rung 2, and
`todo.liquid-glass-live-css-layer` landed the same day. `CSS.supports` is the
only gate: an engine without `backdrop-filter` installs no layer.

What follows is the record of the two sessions that tried to photograph it,
kept so nobody repeats them.

`backdrop-filter` confined by `clip-path` is verified in Chrome and in real
Safari 26. Firefox is unverified BY CAPTURE: the Playwright Firefox 151 build
will not start on this host, failing headed with a GPU helper error and
headless with `RenderCompositorSWGL failed mapping default framebuffer`.

Work: open `demo/backdrop-clip-spike.html` in a real Firefox and press "run
benchmark", or run `node tools/smoke/backdrop-clip-spike.mjs <url> firefox` on a
host where the build starts. Record the clipping verdict and the animated frame
cost in `src.dom-capture-survey-2026-07-25`.

Retried 2026-07-27 with a real Firefox 141.0.3 installed at
`/Applications/Firefox.app`. The page loads and renders in a headed window, so
the platform is not the obstacle; reading pixels back is. All five
non-interactive routes are closed on this host, and the table of what was tried
is in `src.dom-capture-survey-2026-07-25`: Playwright's `channel: 'moz-firefox'`
BiDi path hangs at launch, macOS Screen Recording permission is denied to the
agent process so neither the computer tool nor `screencapture` can photograph
the window, `--headless --screenshot` against the stock build fails with
`RenderCompositorSWGL failed mapping default framebuffer`,
`--remote-debugging-port` never opens a listener, and `--marionette` on a
throwaway profile likewise never accepts a connection on port 2828. The last
three share one cause: this host denies the browser a listener socket and
denies headless a GPU framebuffer.

Do not spend another session on those five. Headless would not settle it even
if it produced a PNG, because macOS headless Firefox composites through SWGL
rather than the GPU WebRender path bug 1579957 is about, so a verdict read from
it would not be evidence either way.

**What a real Firefox would still add**: a confirmation that the closed bug
does not reproduce, and the `filterAnimatedClip` mean from the HUD on Gecko.
Neither blocks anything now. If a real Firefox ever does leak the frost outside
the clip, the fallback is a static rounded-blob clip or dropping to rung 1
there, and that is now a one-line change to the clip source rather than an
architecture question.

A second, still-open Gecko bug was found while checking the first and matters
more: 1782876, `backdrop-filter` failing when a PARENT has
transform/opacity/clip-path/mask, last confirmed in Firefox 133. It is an
ancestor problem, not a self-clip problem, and the library answers it by
authoring no wrapper and by warning when a host page supplies one
(`dec.liquid-glass-compositor`).

Unblocked: `todo.liquid-glass-live-css-layer`, which has since landed.
