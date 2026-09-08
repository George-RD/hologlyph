# Implementation notes

Base: `b3a53d26faeac71677720d2a607ff85c971ef17f`. The blink/viseme deformation
bounds in that commit are unchanged. No asset bytes or defaults are changed.

Local verification on 8 September 2026: TypeScript passes; all 30 test files pass
with 601 tests passing and one existing skip; lint has no errors and eight
pre-existing warnings; the library build passes. New tests cover the borrowed
live glyph/deformation graphs, depth flags, shared material lifetime, preserved
geometry and morph arrays, and mouth-only custom rigs not becoming the shell.

Browser captures run in GitHub Actions because this container blocks browser
navigation to local servers. `tools/smoke/mouth-review.mjs` rejects placeholder
assets, records browser errors and compares the original and replacement
materials on the same posed geometry. Final visual review is pending the new
capture run; the old 24-frame baseline completed without browser errors.

The Cairn CLI is not installed in this container, so `cairn scan` and
`cairn hook all` have not run. No Cairn gate pass is claimed. The PR stays unmerged
until visual approval. Temporary source/dependency transfer helpers are removed
from the final tree; the retained mouth-review workflow is read-only.
