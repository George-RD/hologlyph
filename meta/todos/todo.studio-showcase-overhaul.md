---
node: hologlyph.adapter.web-component
status: done
created: 2026-07-28
---

# Overhaul the studio to properly show off the head

Owner direction, 2026-07-28, given straight after approving the melt direction:

> "Next session, i plan to do an overhaul of the studio, using impeccable skill,
> to best show off the head."

Owner-led, in a session of its own, with the design skill loaded. Deliberately
not started early and deliberately not pre-designed here: the point is to do it
with the skill in hand rather than to arrive with a half-formed layout that then
has to be argued out of.

## Where it starts from

`demo/studio.html`, landed by the `head-studio` change. What exists today is an
organisation pass, not a presentation one:

- One declarative `SCHEMA` driving every control through
  `engine.vfx.setHeadConfig`. 49 sliders, 4 colour pickers, 16 groups.
- Four tiers: live, advanced, developer (the melt), superseded. `<details>` for
  disclosure.
- Backdrop colour with seven presets, writing both the page and
  `skin.backdrop` with `auto: false`.
- Focus mode, `F` to toggle.
- A frame-time readout.

It is a control panel that happens to have a head next to it. The ask is the
other way round: a page whose job is to make the head look as good as it can,
with the controls in service of that.

## What is known to be in the way

Not a design brief, just the constraints whoever does this will hit:

- **No camera control.** Framing needs `EngineImpl.sysRenderer.camera`, which is
  private and not on the `Engine` contract, so the studio ships without it and
  the head sits at whatever framing the engine picked. For a page whose purpose
  is presentation this is the biggest single limitation. `todo.public-camera-pose`
  is the prerequisite, and it is a contract change needing its own decision.
- **The backdrop is the composition.** The head is transparent, so the page
  colour is not decoration: `adaptToBackdrop` retunes the ink against it, and on
  cream the glyphs flip dark. Any layout that puts the head on a gradient, an
  image, or live page content has to reckon with that, and the compositor rung
  that tried it was rejected on shape (`todo.silhouette-hull-halo`).
- **Glass has a structural floor.** Above 0 `skin.glass.amount` is a live
  uniform; at exactly 0 `applyGlassLayering` drops the interior wall, flips
  transparency across the layered set and recompiles. Treat 0 as a mode, not the
  bottom of a dial.
- **The melt's internals are still unwired.** Eyeballs and mouth cavity do not
  melt with the shell (`todo.melt-internals`). Anything that shows the melt off
  needs that fixed first, or needs to stay below the amount where it shows.
- **`demo/main.ts` has no resize listener**, so `engine.html` stretches when the
  window changes. The studio has one; the shipped demo page does not.

## Acceptance

Owner's call, by eye. The two standing criteria from
`dec.liquid-glass-architecture` apply: it must look great, and it must feel
authentic.

Mechanically: it stays on the public `Engine` surface, it stays in the deployed
set in `demo/vite.config.ts`, and `bun run eval` still passes against the
existing baseline unless an accepted visual change says otherwise.
