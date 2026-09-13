# Free-boundary completion review

## Implemented scope

PR #99 replaces the facial perimeter with a closed 2,944-triangle surface.
Four bounded angular modes are driven by the existing 120 Hz VFX step and
normalised for planar area. This is a single connected, reduced-order surface,
not a particle solver or a claim of conserved transitioning head volume.
The source-labelled glyph mouth and authored speech rig from #98 are retained.

Review corrected reversed and overflowing viewport spans, non-finite camera
matrices, disappearance on unusable extents, standalone materials fading for
an unattached replacement, and close-up framing after travel. The standalone
and unusable-extent regressions failed before their respective fixes. A fresh
review also identified WebGPU near-plane clipping: the viewport adapter now
uses the active camera coordinate system. The new real-camera test failed
with WebGPU's negative clip Z before the correction and passes for both
coordinate systems, including their far planes.

## Candidate verification

The complete local battery is run independently: strict type-check, all Vitest
tests including pinned GLB regeneration, lint and library/declaration build,
then Cairn v0.10.0 scan and hook all. Existing advisory Cairn findings and eight
lint warnings remain. The hook reports Decision: pass, but this CLI version
does not execute the language battery itself, as already logged in
cairn-feedback.jsonl. Removing the real boundary-step call makes the steering
regression fail; the implementation was restored before the full gate.

Remote head f5c8696 passed standard CI run 34744195136, including visual scoring
and the unchanged smear negative control. Run 34744195147 passed the independent
full project battery and Cairn gate. These are candidate results, not a claim
that later commits inherit completed exact-head checks.

## Direct renderer inspection

Downloaded and inspected artifact 10314100008 from run 34744195148, source head
f5c8696 (synthetic merge d2c5278). Its completed anatomy step produced 110 liquid
captures and 18 anatomical captures. The liquid report has zero browser errors,
mean normal-head pixel difference zero, six complete viewport/background cases,
continuous requested-direction reversals, contained released momentum and
matching carrier/solver positions after re-formation. Both directions around
0.94/0.96, intermediate poses, interruptions, mobile framing and the corrected
travelled close-up were inspected. The full-liquid outline no longer contains
facial projections; no detached trim or rigid internals remain at that endpoint.
Teeth and tongue use the live glyph field; the darker cavity is not a luminous
replacement wall. The authored lip still naturally occludes some incisors.

The actual renderer was WebGLBackend on Chromium 149 with ANGLE/SwiftShader,
although the existing host label reported webgpu. Full liquid used two draw
calls and 2,945 triangles including the background pass. Observed frame medians
were approximately 167 ms at 1000x900 and 67 ms at 390x844. These are headless
software-rendering observations, not hardware WebGPU or physical-phone results.
No smooth hardware-performance claim follows from these captures.

## Remaining merge gate at this record

The combined mouth workflow hit its 12-minute budget after the anatomy/liquid
step passed, during the separate mouth/speech script. That final script's
completion is not claimed for run 34744195148. The two unchanged scripts now
run in separate read-only jobs, retaining 12 minutes per job, all assertions,
all captures and distinct artifacts. Blueprint-only changes now trigger the
Cairn workflow; liquid-helper-only changes trigger mouth review.

Exact-head checks, the completed speech review, current rendered visual
acceptance and resolved review findings remain required before merge.
Completion-candidate evidence and current merge status are recorded on PRs
#99 and #98. This document does not itself assert a merge. The existing stack
is retained: #99 into #98, then #98 into #96's feature branch. Neither main nor
the diverged glass branch is overwritten, and this is not a public deployment.
Snapshot helpers and evidence-only branches are excluded from the feature.
Pinch-off, multiple-blob merging and arbitrary obstacles remain a separate
scope under todo.liquid-glass-topology-fluid.
