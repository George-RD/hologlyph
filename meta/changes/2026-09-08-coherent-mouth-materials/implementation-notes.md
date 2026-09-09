# Implementation notes

## 9 September 2026: source-labelled anatomy

The initial dim glyph material and the two subsequent position-band attempts
were rejected by the owner. The cloud was not solved by narrowing coordinate
bands: those bands still illuminated gum walls. This pass replaces that
classification with the actual source materials and authored tongue mask.

`mouthRegionWeights` writes [teeth, tongue] into `_ORAL_REGION` on the existing
mouth primitive. The rebuilt and optimised GLB contains 4,868 teeth vertices,
362 tongue vertices and 2,537 gum vertices. The geometry and morph arrays are
unchanged: a local decoded comparison checked 210 existing attributes/index or
morph arrays against the previous asset with exact equality. No speech weights,
blink bounds, public controls or configuration defaults were changed.

Final candidate GLB: 1,148,252 bytes, below the 1.5 MiB budget.
SHA256: e8f280fad8f279589ae25a36dd5e922e97d4dcd03b19734b41b8da3a527badaf
Source provenance remains the pinned ICT manifest and tongue manifest consumed
by build-bust.ts. Rebuilding and optimising at --simplify 0.5 reproduces the asset.

Verification: two new tests failed before the region implementation and pass
with it. The full local suite passes 606 tests in 32 files, including the
source-regeneration check now that verified source files are cached. Type-check,
lint and library build pass; lint has eight pre-existing warnings and no errors.
The remote candidate job also passes the full suite and type-check.

The first labelled render made the tongue too flat. A second iteration gives
it a dark root, shaped sides and a restrained centre groove. It also corrects
the review harness's canvas aspect ratio by calling engine.resize(700, 820).
Final candidate run 34361182660 captures 18 real-engine frames in text/glass,
front/side and seven mouth poses with zero browser errors. The contact sheet,
full-size SS and TH frames, and side/closed frames were directly inspected.
Teeth have distinct silhouettes and gaps; the tongue recedes into a dark cavity
rather than colouring the gum wall. No image synthesis or retouching is used.

The headless speech review supplies synthetic host word-boundary events through
the real adapter and motion path; audio playback and on-device iOS rendering are
not verified. The live GitHub Pages demo remains unchanged pending acceptance.

The source-labelled pass was rendered in an isolated candidate workflow before
being applied to the feature branch. The apply job checks exact payload/asset
hashes and the Cairn gate before updating that branch. Its outcome and final
branch verification are recorded in PR #96. No gate pass is implied here until
that job succeeds. Temporary transfer and candidate workflows are removed by
that job; the retained mouth-review workflow is read-only.
