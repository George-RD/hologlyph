---
node: hologlyph.runtime.shaders
status: done
created: 2026-07-27
satisfies: 2026-07-29-interior-glyph-containment
---

# Interior glyphs leak out of the head at high drift

Surfaced by the owner look session, 2026-07-27
(`src.owner-look-2026-07-27`):

> "somewhat works, though the glyphs pop out the head when i increase drift.
> That can be an experimental feature default off"

## The defect

`interiorDriftTargets` in `src/shaders/interior-glyphs.ts:371` is

```
rest + sin(t) * amplitude
```

with no containment term. The amplitude is a single global `config.drift`
applied to every glyph regardless of where it sits, so any glyph whose clearance
to the skin is smaller than `config.drift` translates straight through the
surface. The glyphs nearest the face, which are the ones a viewer actually
notices, are exactly the ones with the least clearance.

## The fix

Clamp each glyph's offset by its own clearance rather than by a global. The
field already has the number it needs: the seeder samples `aThickness` at seed
time to place the glyph between the near and far surfaces, so the clearance is
available per glyph without a new bake and without a new attribute. Store it
alongside the rest position and drive the per-glyph amplitude from
`min(config.drift, clearance * margin)`.

A margin below 1 is wanted, not just a hard clamp: a glyph that grazes the
inside of the surface reads as stuck to it rather than suspended in it.

## Acceptance

At `interior.drift` full and `interior.count` high, in
`demo/interior-glyph-lab.html`, no glyph crosses the silhouette at any point in
a full drift cycle, at rest and while the head moves. Glyph motion at low drift
is unchanged. Reduced motion still damps the drift. The feature stays gated at
`interior.count: 0`, so `bun run eval` must be unmoved.
