# Headless smoke checks (dev-only, not shipped)

Real-browser verification of the running engine; the numeric oracles here are
the acceptance checks for todo.v2-demo-bust and todo.v2-textskin-fit.

Prerequisites: `bun install` (Playwright is a devDependency) and its managed
Chromium (`bunx playwright install chromium`), or set `HOLOGLYPH_CHROME` to a
real browser executable. Two local servers:

```shell
bun run dev -- --port 5199 --strictPort        # vite demo server (source paths)
python3 -m http.server 8932 --directory .      # repo root (dist consumer fixture)
```

- `demo-smoke.mjs` (node): drives the demo. Asserts the behaviour state machine
  (hidden -> idle on scroll -> speaking on Speak), measures the fraction of
  canvas pixels differing from the renderer clear colour #05070d by more than a
  tolerance (bust present: expect roughly 0.15), and samples the central face
  region during speech to prove visible viseme motion (expect > 0.05 changed).
- `consumer.html` + `consumer-smoke.mjs` (node): consumes the BUILT dist like a
  package (import maps for three), creates an engine with NO avatarUrl, and
  proves the packaged default head loads via the lazy default-avatar chunk.
- `lens-shot.mjs` (bun): drives `demo/lens-lab.html` for the snapshot lens
  (`dec.liquid-glass-architecture`, rung 3). Pins the pose, then measures a
  presence floor, a noise floor, the bound sample window against the
  document-space layout arithmetic, the bounded colour-space seam, visible
  displacement (lensed against lensed, so the seam cancels), an untouched page
  outside the silhouette, the response to flipping `lens.strength`, and exact
  restoration when the source is dropped. Exits non-zero on any failed leg and
  writes `out/lens-shot.json`.
- `live-lens-shot.mjs` (node): drives `demo/live-lens-lab.html` for the
  Chromium HTML-in-Canvas enhancement (`dec.liquid-glass-architecture`, rung 3,
  item 5). Launches the installed Google Chrome twice, once with
  `--enable-blink-features=CanvasDrawElement` and once without, and measures
  the capability, a residual-motion floor, engagement, liveness against a
  frozen snapshot over the same interval, an untouched page outside the
  silhouette, hit-testing for a control under the head and one beside it, and a
  silent fall-through to the snapshot lens with the flag off. Point `--chrome`
  at another executable if yours is elsewhere. Exits non-zero on any failed leg
  and writes `out/live-lens-shot.json`.
- `interior-glyph-shot.mjs` (bun): drives `demo/interior-glyph-lab.html` for
  the interior glyph field (`dec.liquid-glass-architecture`, item 10). Pins the
  pose by hand rather than emulating reduced motion, because reduced motion is
  itself one of the legs, and measures: a silhouette floor, a noise floor,
  engagement split inside and outside the silhouette, exact inertness back at
  `interior.count = 0`, the lag after a step in head yaw with a rigid
  `inertia: 0` control, and reduced motion removing that lag without removing
  the field. `--cost` adds a vsync-free frame cost against a real Chrome at 0,
  240 and 512 glyphs. Exits non-zero on any failed leg and writes
  `out/interior-glyph-shot.json`.
- `ladder-shot.mjs` (bun): drives `demo/ladder-lab.html` for the backdrop
  ladder exclusion (`dec.liquid-glass-rung-exclusion`), where both rungs point
  at the same `#hero`. Measures rung 2 frosting inside the silhouette and not
  outside it, the layer being REMOVED from the host tree within a bounded wait
  once a source is named, rung 3 still showing the page inside the head, the
  two rungs looking visibly different there, and the frost coming back both
  when `lens.amount` goes to 0 with the source still bound and when the source
  is dropped, restoring the rung 2 frame to within the noise floor. Exits
  non-zero on any failed leg and writes `out/ladder-shot.json`.
- `demo/textskin-variants.html` (served by the vite dev server) renders the real
  bust under grid/colour/emissive variants for owner review; the 2026-07-17 pass
  kept DEFAULT_GRID (variant A) for the best readability/density balance.
