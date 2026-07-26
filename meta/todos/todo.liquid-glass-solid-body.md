---
node: hologlyph.runtime.shaders
status: open
created: 2026-07-25
---

# Solid-body glass: backfaces, thickness, absorption

Order 1 of 9 (`dec.liquid-glass-architecture`). No prerequisite; may run in
parallel with the other unblocked items.

Highest perceptual gain per unit of cost, and independent of every backdrop
question.

The head currently reads as a translucent shell, not a block. What makes glass
read as solid is seeing the inside of the far surface through the near one, and
watching thick regions absorb more light than thin ones.

Work:

1. Render the bust twice: backfaces first, then frontfaces. 30,748 triangles, so
   one extra draw call, no render targets.
2. Bake a per-vertex thickness attribute in the asset pipeline alongside the
   existing feature masks, and apply Beer-Lambert absorption tinted by
   `skin.glass.tint`.
3. Optional chromatic split at the silhouette, three taps, only if it survives
   the ghosting budget.

Open question to settle first: does `NodeMaterial.clone()` share uniform-node
references? If it does, the front and back materials stay in sync for free. If
it deep-copies, every write in `applyConfigToBindings` (about 30 uniforms plus
the per-frame `scrollOffset`) must fan out to both, or the halves drift apart on
`setHeadConfig`.

Risk to watch: `blendZoneGhosting` sits at 0.69 against a 0.768 pass cutoff.
Backface depth lands in exactly the grazing band that metric scores, so run
`bun run eval` before and after and treat a fail as real rather than as a
baseline to relax.

Acceptance: the head reads as a solid block at rest and under rotation; eval
overall pass; the dark-page approved look is unchanged at `glass.amount = 0`.
