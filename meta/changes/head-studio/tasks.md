# Tasks: head-studio

## Studio

- [x] Declarative `SCHEMA` driving every control through `setHeadConfig`
- [x] Live tier: backdrop, glass, tone, glyphs, eyes, motion
- [x] Advanced tier, collapsed: region opacity, feature shading, glass response,
      glyph grid, eye internals
- [x] Developer tier: the melt, with head/puddle/cycle and its defects stated
- [x] Superseded tier: pool, fluid, stage, rungs, interior glyphs, all marked
- [x] Backdrop colour picker plus presets, writing both the page and the config
- [x] Focus mode, rail slides off, `F` toggles
- [x] Frame-time readout

## Wiring

- [x] `studio.html`, `outcomes.html`, `compare-lab.html` into `demo/vite.config.ts`
- [x] `outcomes.html` lab tab retargeted from `melt-lab.html` to the studio
- [x] `index.html` topbar links the studio
- [x] `todo.public-camera-pose` for the gap that kept camera controls out

## Verification

- [x] Page builds the rail with no console error: 49 ranges, 4 colours, 16
      groups, 3 collapsed tiers
- [x] Backdrop: both writes land, ink adaptation flips to dark ink on cream
- [x] Focus mode: rail offscreen, button relabels, chips stay legible
- [x] Melt cycle from the studio sweeps 0 to 0.915 and back
- [x] Studio renders inside `outcomes.html`, one WebGL context at a time
- [x] `bunx vite build` in `demo/` emits all five pages, no dangling
      `melt-lab` reference
- [x] `bunx tsc --noEmit`
- [x] `bunx vitest run` (597)
- [x] `bun run lint` (1 pre-existing warning)
- [x] `bun run build`
- [x] `cairn hook all` (exit 0, decision pass)
- [x] `bun run eval` overall pass: no shipped default moves

## Left open

- Camera framing, pending `todo.public-camera-pose`.
- The melt's own two defects, which this change surfaces rather than fixes.
