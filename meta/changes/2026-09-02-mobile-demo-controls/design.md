# Design: mobile-demo-controls

## Head first, controls on demand

The site root is a fixed full-viewport canvas. The only persistent controls are
three touch-sized actions in a bottom dock and a studio button in the top
corner. The settings drawer, sample-line sheet and expression menu are all
closed on first paint. Their closed states use `inert` as well as visual
translation so hidden controls cannot still capture keyboard focus.

The previous consolidated studio is retained byte-for-byte at `studio.html`.
This keeps every exploratory control available without making the root page a
control panel again.

## Expression fan

The expression button anchors a seven-item radial fan. Positions are calculated
from the trigger's live viewport coordinates, then horizontally clamped so all
44-pixel-plus targets stay within narrow screens. Selection calls
`engine.setEmotion` and updates pressed state on the single canonical button
set.

## Speech

Five short captions exercise different sentence lengths and concepts. Choosing
a caption updates the visible subtitle and calls `engine.speak` from the same
user gesture. The central Say action replays the current caption. This keeps the
browser SpeechSynthesis unlock and the engine's AudioContext resume on a real
interaction rather than attempting blocked autoplay.

## Studio drawer

The compact drawer exposes only the controls useful while judging the head:
backdrop, glass amount and tint, presence, ink balance, warmth, rim and reduced
motion. Every write goes through `engine.vfx.setHeadConfig`. A link opens the
full studio for all advanced, developer and superseded controls.

## Interaction and responsive behaviour

- `100dvh` and safe-area insets keep controls clear of iPhone browser chrome.
- Pointer drag uses the existing public `engine.motion.setHeadTarget` seam.
- Escape, outside press, scrim and explicit close actions dismiss transient UI.
- Reduced-motion CSS and the engine control remain independent and explicit.
- A mobile Playwright smoke uses a deterministic SpeechSynthesis fake while
  still exercising the real demo adapter, word boundaries and viseme route.

## Files

ADDED:
- `demo/showcase.ts`
- `demo/showcase.css`
- `demo/studio.html`, copied from the previous root
- `tools/smoke/mobile-demo-smoke.mjs`

MODIFIED:
- `demo/index.html`
- `demo/vite.config.ts`
- `.github/workflows/ci.yml`
