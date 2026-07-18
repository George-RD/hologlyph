# Visual quality eval harness

A repeatable, headless harness for scoring the text-skinned avatar with
objective numbers rather than eyeballed screenshots. It captures a fixed set
of deterministic views from the running demo and scores them with pure Node
code (no extra image dependencies).

## Prerequisites

The harness drives the demo through a browser, so the Vite dev server must
already be running before you invoke it:

```shell
bun run dev
```

Playwright is a devDependency; install its managed Chromium once with:

```shell
bunx playwright install chromium
```

To use a real browser instead, set `HOLOGLYPH_CHROME` to its executable, e.g.
`HOLOGLYPH_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.

By default the server listens on `http://localhost:5173`. If you start it on a
different host or port, pass the URL as the first argument to the capture step.

## Usage

Run both steps in order (capture then score):

```shell
bun run eval
```

Or run them separately:

```shell
bun tools/evals/capture.mjs [url]
bun tools/evals/score.mjs
```

`capture.mjs` accepts an optional URL argument (default
`http://localhost:5173`). `score.mjs` reads the PNGs written by capture and
emits `tools/evals/out/report.json`.

## Outputs

`tools/evals/out/` holds the captured frames:

- `front.png` - head facing forward
- `yaw-plus-0.6.png` - camera orbited to the requested +0.6 rad view
- `yaw-minus-0.6.png` - camera orbited to the requested -0.6 rad view
- `close-up.png` - a tight crop used for the legibility proxy
- `flow-0.png`, `flow-1.png` - two frames one second apart for the flow metric

`tools/evals/out/report.json` holds every computed metric, its baseline value,
a pass or warn or fail status, and the screenshot paths. The process exits
non-zero if any metric fails.

## Metrics

- **Glyph legibility** - mean absolute luminance gradient over the close-up
  crop. A proxy for edge sharpness and high-frequency glyph energy.
- **Yaw legibility** - mean absolute luminance gradient restricted to the
  head-silhouette pixels of both yaw views. This is the guard for the original
  side-projection defect: smeared or stretched glyphs keep their bright-pixel
  coverage but lose edge sharpness, so only this metric catches them.
- **Coverage** - for the front and both yaw views, the fraction of
  head-silhouette pixels whose luminance exceeds the glyph threshold. This
  catches side-mapping regressions where glyphs stop landing on the turned
  head.
- **Flow** - mean absolute per-pixel luminance delta between the two flow
  frames, restricted to the head silhouette. It must be greater than zero
  (the text is scrolling, so the frame is alive) and below a ceiling (no
  strobing).
- **Eye occlusion** - skipped. Detecting a bright sphere cluster outside the
  face region proved too fragile to be a trustworthy gate, so it is documented
  here rather than scored.

## Negative control

`bun run eval:control` horizontally smears the two
yaw captures in memory (simulating planar side-projection stretch) and
requires the yaw legibility metric to fail on them. It exits non-zero if the
smeared views still pass, proving the harness detects the regression it was
built for. CI runs it after every scored eval.

## Determinism

The capture seeds `Math.random` through a Playwright init script so the
engine's gaze and saccade randomness are repeatable without changing the
library. Each view waits about four seconds after the avatar loads and about
eight hundred milliseconds after posing so motion settles before the screenshot.

## Side-view angle

The capture requests a camera orbit of plus or minus 0.6 radians around the
head origin, matching the design brief. The motion engine clamps head yaw to
plus or minus 0.5 radians (`src/motion/index.ts`, `DRAG_YAW_LIMIT`), so a true
0.6 rad view cannot be reached by rotating the head. Instead the harness orbits
the live renderer camera (initial position (0, 0.05, 2.4)) around the origin,
which needs no change to the library and honours the requested yaw angle. The
engine never resets the camera per frame, so the pose persists until the next
page reload.

## Baseline calibration

`tools/evals/baseline.json` records the known-good metric values from the
current build together with the pass or warn or fail bands. To recalibrate
after an intentional visual change, run capture once against the new build,
note the raw values printed by `score.mjs`, and update `baseline.json`. The
thresholds use ratio bands against the baseline so small, benign run-to-run
timing noise does not fail the gate.
