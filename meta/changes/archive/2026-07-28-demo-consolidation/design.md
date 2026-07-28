# Design: demo-consolidation

## Approach

### Root routing by rename, not redirect

`git mv demo/index.html demo/handrolled.html` then
`git mv demo/studio.html demo/index.html`. The root URL is then the studio with
no redirect hop and no second URL to remember. `compare-lab.html`'s left iframe
follows to `./handrolled.html`, or it would silently have compared the library
against itself.

### The notes tier

What was `outcomes.html` is a fifth tier in the same `SCHEMA` the controls come
from, rendered by one new `kind: 'note'` branch that appends a paragraph. Four
groups: the 2026-07-27 rulings, the glass being the default, the melt being
active development, and the known gaps in the page itself.

A ruling you have to open another URL to read is a ruling nobody reads, which is
how tier 3 came to be built on in the first place.

### What stays deployed, and why

Three inputs. The root, because it is the one thing to check.
`feature-shading-lab.html`, a redirect stub keeping an old bookmark alive. And
`engine.html`, which is NOT linked from anywhere but is the target of
`tools/evals/capture.mjs`: folding it in would break the visual eval's baseline
comparison. The config header says so, because it is exactly the kind of thing a
later tidy-up would remove.

## Changes

ADDED:
- `meta/sources/src.owner-consolidation-2026-07-28.md`.
- `kind: 'note'` control and the notes tier in the studio.

MODIFIED:
- `demo/vite.config.ts`: three inputs, and a header recording which pages are
  out of the deployed set and why.
- `demo/compare-lab.html`: left iframe to `./handrolled.html`.
- `demo/handrolled.html`: topbar link to the studio's new home at the root.
- `meta/decisions/liquid-glass-melt.md`: the owner's confirmation and the
  promotion from spike to active development.
- `meta/todos/todo.melt-internals.md`: seen and accepted by the owner; it blocks
  calling the sweep finished, not exposing the melt for development.

REMOVED:
- `demo/outcomes.html`, folded into the rail.

RENAMED:
- `demo/index.html` to `demo/handrolled.html`.
- `demo/studio.html` to `demo/index.html`.
