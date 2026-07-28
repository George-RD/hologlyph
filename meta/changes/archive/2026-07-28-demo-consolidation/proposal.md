# Proposal: demo-consolidation

## Motivation

Owner direction, 2026-07-28 (`src.owner-consolidation-2026-07-28`):

> "I wanted to consolidate the glass system, as i think its good now, so that is
> the new default? with melting being like in developer options. Idea being not
> having to maintain different environments."

> "As its confusing for me to have to open all sorts of websites when checking."

Nineteen HTML pages under `demo/`, five of them deployed, each showing one slice
of the head. Checking the work meant opening several and holding the differences
in your head. Two of them were separate renderers of the same bust.

## Scope

- The studio becomes the site root. `demo/index.html` IS the studio.
- The previous root, a second renderer hand-rolled in TSL, becomes
  `demo/handrolled.html` and leaves the deployed set. Kept as the
  owner-approved-look reference and the left half of `compare-lab.html`.
- `demo/outcomes.html` is deleted. Its content is a notes tier in the rail.
- Deployed set drops to three: the root, `engine.html` (unlinked, the visual
  eval's target) and the redirect stub.
- The glass is recorded as the default rather than a lab option, and the melt as
  active development in the developer tier.

## Out of scope

- Deleting the nine feature labs, `compare-lab.html` or the research spikes.
  They leave the deployed set and are marked superseded; the files stay. Nothing
  in the ask required destroying them and they are cited by archived changes.
- Narrowing `HeadConfig`. The superseded features stay gated at 0 and reachable
  from the studio's Superseded tier so they can be A/B'd against the melt. The
  stage colliders in particular are what the melt's squeeze will reuse.
- The presentation overhaul. That is owner-led next session,
  `todo.studio-showcase-overhaul`.
