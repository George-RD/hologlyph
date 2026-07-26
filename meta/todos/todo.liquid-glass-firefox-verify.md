---
node: hologlyph.runtime.renderer
status: blocked
created: 2026-07-25
---

# Verify the compositor glass path in Firefox

Blocker on calling rung 2 of the backdrop ladder cross-browser
(`dec.liquid-glass-architecture`).

`backdrop-filter` confined by `clip-path` is verified in Chrome and in real
Safari 26. Firefox is unverified: the Playwright Firefox 151 build will not
start on this host, failing headed with a GPU helper error and headless with
`RenderCompositorSWGL failed mapping default framebuffer`. Firefox bug 1579957
records `backdrop-filter` not respecting `clip-path`, which is exactly the
combination the design depends on, so this cannot be assumed.

Work: open `demo/backdrop-clip-spike.html` in a real Firefox and press "run
benchmark", or run `node tools/smoke/backdrop-clip-spike.mjs <url> firefox` on a
host where the build starts. Record the clipping verdict and the animated frame
cost in `src.dom-capture-survey-2026-07-25`.

Retried 2026-07-27 with a real Firefox 141.0.3 installed at
`/Applications/Firefox.app`. The page loads and renders in a headed window, so
the platform is not the obstacle; reading pixels back is. All four
non-interactive routes are closed on this host, and the table of what was tried
is in `src.dom-capture-survey-2026-07-25`: Playwright's `channel: 'moz-firefox'`
BiDi path hangs at launch, macOS Screen Recording permission is denied to the
agent process so neither the computer tool nor `screencapture` can photograph
the window, headless still fails with `RenderCompositorSWGL failed mapping
default framebuffer`, and `--remote-debugging-port` never opens a listener.

**Precise blocker**: either grant Screen Recording permission to the process
driving the session, or have a human open
`http://localhost:5173/hologlyph/backdrop-clip-spike.html` in Firefox, press
"run benchmark", and report two things: whether the frost is blob-shaped or
rectangular, and the `filterAnimatedClip` mean from the HUD.

If Firefox leaks the filter outside the clip shape, the fallback is a static
rounded-blob clip or dropping to rung 1 there. Decide that before the CSS layer
lands in `src/`, not after.

Unblocks: `todo.liquid-glass-live-css-layer`.
