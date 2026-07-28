# Design: head-studio

## Approach

### A declarative schema, not 55 hand-written rows

The rail is generated from one `SCHEMA` array. A control is
`{ path, label, min, max, step }` where `path` is a dotted address into
`HeadConfig`, or `{ kind }` for the handful that are not plain numbers
(colour, backdrop, swatches, motion, melt actions).

Everything numeric goes through one `push(path, value)` which builds a
single-key-deep patch and calls `engine.vfx.setHeadConfig`. So the page drives
the shipped public surface rather than a parallel one, and adding a knob is one
line rather than a slider, an output, a listener and a setter.

Initial values are read from `engine.vfx.headConfig`, not from
`DEFAULT_HEAD_CONFIG`: that is a value and `src/index.ts` re-exports only types,
so it is not on the public surface. At boot the live config IS the defaults.

### Three tiers plus a graveyard

`<details>` for both tiers and groups, so progressive disclosure is the
browser's job and the state survives without a store. Live groups are open where
they earn it (backdrop, glass, tone); the three lower tiers are shut.

The tiers are not cosmetic. They encode which knobs are load bearing (live),
which were exploration scaffolding (advanced), which are unfinished (developer),
and which were ruled against on 2026-07-27 (superseded). The last two carry a
coloured summary and a note saying so, because an undated slider in a panel is
how tier 3 got built on in the first place.

### The backdrop is two writes

`skin.backdrop` does not paint anything. It retunes ink and glow so the glyphs
stay legible against whatever is behind them (`adaptToBackdrop`), and with
`auto: true` the engine reads the colour off the host at mount, which would
overwrite anything set later.

So `setBackdrop(color)` does three things: paints `document.body`, pushes
`skin.backdrop.color`, and sets `auto: false` so the push sticks. Painting alone
would leave the shader tuned for the old backdrop; pushing alone would colour
nothing.

### Focus mode

A `body.focus` class translates the rail out by its own width. The canvas is
fixed to the viewport and was always full-bleed, so nothing resizes; the rail
was floating over it all along. `F` toggles, guarded against firing while a
field has focus.

The focus chip and the frame-time readout float over the stage, so they cannot
inherit the rail's contrast: with a cream backdrop a near-white chip on a
near-white page vanishes. Both carry their own dark ground.

## Changes

ADDED:
- `demo/studio.html`.
- `meta/todos/todo.public-camera-pose.md`.

MODIFIED:
- `demo/vite.config.ts`: `studio.html`, `outcomes.html` and `compare-lab.html`
  join the build inputs. The nine spike labs stay out, and the header comment
  says why.
- `demo/outcomes.html`: the lab tab points at the studio instead of
  `melt-lab.html`, which is not in the deployed set. Section id and hint renamed
  with it.
- `demo/index.html`: a `studio` link in the topbar, so the new page is reachable
  without guessing a URL.

REMOVED:
- Nothing. No config field is narrowed; "deprecated" means demoted out of the
  live tier.

RENAMED:
- `outcomes.html`'s `#melt` panel to `#studio`.
