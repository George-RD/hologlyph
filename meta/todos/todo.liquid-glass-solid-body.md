---
node: hologlyph.runtime.shaders
status: done
created: 2026-07-25
---

# Solid-body glass: backfaces, thickness, absorption

Order 1 (`dec.liquid-glass-architecture`). No prerequisite; may run in
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

## Outcome (2026-07-26)

Implemented in `meta/changes/2026-07-26-liquid-glass-solid-body`.

- Thickness is a load-time mask in `src/asset/rig.ts`, not a pipeline artefact:
  the seven existing feature masks are baked there too, and an offline bake
  would have left custom `avatarUrl` rigs with no absorption. See the change's
  `implementation-notes.md`.
- The open question is moot. Nothing is cloned; both materials are built from
  one node graph and share every `uniform()` object by construction.
- Absorption is achromatic on the front and tinted only on the interior wall.
  Tinting the front was implemented and then measured out: it dropped yaw
  legibility to 23.8 and 22.1 against 26.0 and 25.8 cutoffs.
- `blendZoneGhosting` came out at 0.646 against the 0.768 cutoff (baseline
  0.640), so the flagged risk did not materialise. The optional chromatic
  split (item 3) is still unimplemented and still affordable.
- The draw-order change is conditional on `glass.amount`, because moving the
  mask and the internals into the transparent list shifts the open mouth by
  about 15 luma on its own.
- Acceptance verified with `tools/smoke/solid-body-shot.mjs` in four cases
  (neutral, jaw-open, blink, and a 0.6 rad camera orbit). At
  `glass.amount = 0` no pixel's luminance moves at all and at most 115 of
  307,200 differ by at most 3/255 in one channel, which is last-bit shader
  rounding; at `amount = 1` about 14.1% change with the head gaining body. The
  capture must pin the bones and every morph influence array; see the notes.
