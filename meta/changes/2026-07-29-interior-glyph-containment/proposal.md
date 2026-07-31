# Proposal: 2026-07-29-interior-glyph-containment

Satisfies `todo.interior-glyph-containment`, node `hologlyph.runtime.shaders`.
Surfaced by the owner look session, `src.owner-look-2026-07-27`:

> "somewhat works, though the glyphs pop out the head when i increase drift.
> That can be an experimental feature default off"

## Motivation

`interiorDriftTargets` moved every suspended glyph by one global
`config.drift`, with no term for how much room that glyph had. Any glyph whose
clearance to the skin was smaller than the amplitude translated straight
through the surface, and the glyphs seeded nearest the face, the ones a viewer
actually looks at, are exactly the ones with the least room.

## Scope

- A per-glyph clearance, measured at seed time as the exact distance from the
  site to the nearest point on the body's triangles.
- A per-glyph drift budget derived from that clearance, the sprite's own
  extent and `INTERIOR_DRIFT_MARGIN`, capping the drift offset's LENGTH.
- Containment of the integrated world position, not just the drift target,
  because the spring is under-damped and chases through a moving head frame.
- The index buffer plumbed from `readInteriorGeometry` through
  `InteriorGlyphFieldOptions` so the clearance can be measured at all.

## Out of scope

- The seeding rule itself. `INTERIOR_MIN_CLEARANCE` and the retry that
  enforces it are unchanged, so where glyphs land is byte-identical.
- Turning the field on. It stays gated at `interior.count: 0`, so
  `bun run eval` must be unmoved.
- Any change to the public element attributes or the head config surface.
