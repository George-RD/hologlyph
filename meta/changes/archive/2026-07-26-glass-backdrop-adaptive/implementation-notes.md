# Implementation notes: glass-backdrop-adaptive

## Deviations from the design

- Chromatic dispersion at the rim was dropped before implementation. It needs
  two extra texture samples per fragment and is invisible at the shipped glyph
  density. Recorded in the decision as considered-and-dropped.
- The old fixed rim term (`pow(1 - dot(normalView, viewDir), 3) * tone.rim`) was
  folded into the configurable fresnel rather than kept alongside it. The default
  `fresnelPower` started at 3.2 so the dark-page look would not move, then moved
  to 2.6 with the swept values below.
- No new contract method for the backdrop. `setHeadConfig({ skin: { backdrop } })`
  covers hosts and the web component inherits auto-detection, so `VFXEngine` and
  `Engine` keep their existing surfaces.

## Discovered edge cases

- `Color(r, g, b)` and `Color.setRGB` write directly into three's linear working
  space. The ink colour is authored as a darkened sRGB version of the page and
  then linearised in `adaptToBackdrop`; feeding raw sRGB would have produced a
  mid grey (linear 0.18 displays as sRGB 0.46), which is the opposite of ink.
- Both `html` and `body` compute to `rgba(0, 0, 0, 0)` on an unstyled page, so a
  naive ancestor walk resolves to the fallback and the head would pick the
  glow-on-dark look against a white browser canvas. `resolveBackdropColor` ends
  the walk at the browser canvas colour: white, or `#121212` when the document
  opted into `color-scheme: dark`.
- Elements with alpha below 0.5 are treated as not painting, so a translucent
  overlay does not hijack the detection from the section that actually paints.
- Refraction is multiplied by the fresnel term. A uniform offset would unstick
  the glyph grid from the bind pose across the whole face; gating it on the
  grazing band keeps the front of the face welded and only bends the edge.
  The row-stagger rate still uses the unrefracted row so the flow rate cannot
  step as the head turns.

## Parameter sweep (browser, 2026-07-25)

Captured `off / base / strong / max` glass sets over white and `#05070d` pages
with the engine's live `setHeadConfig` hook.

- `off` (amount 0): no silhouette on white, the head reads as loose speckle.
- `base` (fresnel 0.34, specular 0.22, refraction 0.014): edge present but weak.
- `strong` (fresnel 0.65, power 2.6, specular 0.55, sheen 40, refraction 0.03):
  clear glass edge on white, dark look unchanged. Adopted as the default.
- `max` (fresnel 0.9, power 2.0, specular 0.9): silhouette turns opaque and the
  head stops reading as glass.

## Verification

- `bunx vitest run`: 20 files, 288 tests before the default change.
- `tools/smoke/backdrop-shot.mjs` over `#05070d`, `#7f7f7f`, `#ffffff`,
  `#1b3a6b`: auto-detection reported the page colour in every case, mean
  contrast 107 to 165, no page errors.
- `bun run eval`: overall pass. Every metric improved against the old baseline
  (glyph legibility 7.906 to 9.842, front coverage 0.100 to 0.138) except
  blend-zone ghosting, which moved 0.640 to 0.671 (pass cutoff 0.768). The
  refraction offset causes it: it displaces the sampled coordinates in the
  grazing band, which is the band the ghosting metric scores. The improved
  metrics were recalibrated into `tools/evals/baseline.json`;
  `blendZoneGhosting` deliberately keeps its old 0.640 bar so the one metric
  that regressed does not inherit a quietly relaxed one.
- `bun run build`: main bundle 67.44 kB raw / 20.42 kB gzip against 61.61 kB /
  18.49 kB on main, so the glass adds 1.93 kB gzip (new TSL nodes plus the two
  pure modules). The "~11 kB gzip" figure in `AGENTS.md` and `README.md` was
  already stale before this change; both now say ~20 kB.
- `cairn scan` and `cairn hook all`: clean.
