# Implementation notes

Base: `b3a53d26faeac71677720d2a607ff85c971ef17f`. The blink/viseme deformation
bounds in that commit are unchanged. No asset bytes or configuration defaults are changed.

Local verification on 8 September 2026: TypeScript passes; all 30 test files pass
with 601 tests passing and one existing skip; lint has no errors and eight
pre-existing warnings; the library build passes. New tests cover the borrowed
live glyph/deformation graphs, depth flags, shared material lifetime, preserved
geometry and morph arrays, and mouth-only custom rigs not becoming the shell.

Browser captures run in GitHub Actions because this container blocks browser
navigation to local servers. `tools/smoke/mouth-review.mjs` rejects placeholder
assets, records browser errors and compares the original and replacement
materials on the same posed geometry. The first replacement run produced 37 posed frames. Direct inspection of the
paired front views shows the cavity now carries subdued glyphs instead of a
plain insert; side, mobile, light-host and partial-melt frames were also reviewed.
The added audible-speech leg failed because headless Chromium has no working
system voice. The harness now supplies deterministic host word-boundary events,
through the real demo adapter and motion engine, as the existing mobile smoke
harness does. It does not claim to verify audio playback.

Review also found that Three r178's MeshBasicNodeMaterial ignores normalNode.
Using the unlit NodeMaterial base preserves the shared deformation normals.
A regression checks setupNormal's actual node graph; it fails with the Basic
subclass and passes with NodeMaterial. The complete local suite remains green.
The final browser run and visual-eval outcome are recorded in PR #96.

The Cairn CLI is not installed in this container, so `cairn scan` and
`cairn hook all` have not run. No Cairn gate pass is claimed. The PR stays unmerged
until visual approval. Temporary source/dependency transfer helpers are removed
from the final tree; the retained mouth-review workflow is read-only.
