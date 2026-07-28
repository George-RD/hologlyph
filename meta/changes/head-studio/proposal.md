# Proposal: head-studio

## Motivation

The owner approved the melt direction and asked four things of the demo surface
in the same breath:

- Merge the outcomes page with the demo so there is one place showing the
  glass-effect head.
- A coloured background, and a way to put the focus on the lab.
- Drop or fold away the variable-opacity controls, group the rest properly with
  progressive disclosure, and retire the options that existed only to find the
  approved look.
- A developer tier for work in progress, starting with the melt, so the melt can
  be worked on together.

The control surface is 55 knobs across nine config blocks. Every existing page
either exposes almost none of them (`engine.html`) or exposes one feature's
worth on a flat panel (the nine `*-lab.html` spikes). Nothing presents the whole
thing in a shape someone can actually dress a head with.

## Scope

- `demo/studio.html`: one rail over the library engine, three tiers.
  - **Live**: backdrop colour, glass amount and tint, presence, tone, glyph size
    and sharpness, eye colours and size, motion.
  - **Advanced**, collapsed: per-region opacity, feature shading, glass
    response, glyph grid, eye internals. These are how the approved look was
    found; they are not day-to-day controls.
  - **Developer**, collapsed and marked: the melt, with head/puddle/cycle
    actions and its known defects stated inline.
  - **Superseded**, collapsed and marked: pool, fluid, stage, the two backdrop
    rungs, interior glyphs. All gated off, kept only to A/B against the melt.
- Backdrop colour: a picker plus seven presets, dark through cream.
- Focus mode: the rail slides off, `F` toggles it, the head keeps the viewport.
- Deploy it. `studio.html`, `outcomes.html` and `compare-lab.html` join the
  demo build; `index.html` links to the studio.
- Retarget the outcomes page's lab tab at the studio rather than `melt-lab.html`.

## Out of scope

- Camera controls. Framing needs `EngineImpl.sysRenderer.camera`, which is
  private and not on the `Engine` contract. Five spike labs reach in; they are
  dev-only and never ship. The studio is deployable, so it stays on the public
  surface and goes without. A public pose method is a contract change with its
  own decision: `todo.public-camera-pose`.
- Deleting any config field. "Deprecating" here means moving a control out of
  the live tier, not narrowing `HeadConfig`. Hosts depend on it and the labs
  still drive it.
- Fixing the melt's two known defects. They are stated in the developer tier so
  whoever judges the melt is not judging them by accident.
- Anything on the melt itself. This change only exposes it.
