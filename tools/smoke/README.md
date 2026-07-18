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
- `demo/textskin-variants.html` (served by the vite dev server) renders the real
  bust under grid/colour/emissive variants for owner review; the 2026-07-17 pass
  kept DEFAULT_GRID (variant A) for the best readability/density balance.
