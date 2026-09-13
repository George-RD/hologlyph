# Free-boundary completion review

PR #99 replaces the facial perimeter with a closed 2,944-triangle surface.
Four bounded angular modes are driven by the existing 120 Hz VFX step and
normalised for planar area. This is a single connected, reduced-order surface,
not a particle solver or a claim of conserved transitioning head volume.
The source-labelled glyph mouth and authored speech rig from #98 are retained.

The local verification environment is now usable. Source files reconstructed
from the existing #99 diff were checked against their Git blob hashes before
editing. The existing pinned asset cache supports the complete regression
suite, including byte-for-byte regeneration of the shipped GLB.

Review found and fixed three defects with failing regression evidence:
malformed viewport spans were accepted, non-finite camera matrices could pass
containment, and a missing avatar extent hid the entire authored head while
also hiding the free surface. A close inspection after travel also looked at
the old origin; explicit close-up mode now follows the travelled rig. The
wide camera stays fixed throughout handover and re-formation.

Local checks on the candidate pass: 681 tests in 39 files, strict type-check,
lint (eight existing warnings, no errors), library/declaration build, Cairn
v0.10.0 scan and hook all. The hook reports Decision: pass with advisory
legacy findings. As already logged in cairn-feedback.jsonl, this version's
hook does not itself execute the language battery; all four commands were
run independently. Removing the real boundary-step call made the steering
regression fail; the original call was restored before the full gate.

The prior pinned 4339acb renderer captures were downloaded and inspected.
They show a non-facial liquid outline on dark, light and patterned backgrounds,
release containment and re-formation at the travelled position. They do not
certify this newer candidate. They also exposed the close-up framing defect.

The extended existing mouth review now captures both handover directions,
interruptions, release, fixed camera matrices and actual renderer backend on
six desktop/mobile-viewport and background combinations. Frame timing is
reported as headless observation, not physical-device performance. Existing
normal-mode pixel comparisons, trim negatives, speech checks and visual score
thresholds are unchanged. Local browser navigation is policy-blocked, so the
new renderer evidence must come from the existing repository CI review.

Merge status and exact-head CI evidence are recorded on PRs #99 and #98.
No helper snapshot/evidence workflow or evidence-only branch is included in
this feature. No public demo deployment is claimed by this verification note.
