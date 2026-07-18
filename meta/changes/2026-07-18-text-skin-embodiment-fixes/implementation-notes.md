# Implementation notes

- Implementation preceded this typed change scaffold. The scaffold was added
  before the new projection mapping was built, as required once the work scope
  was clarified.
- A sibling-agent revert incident temporarily removed the bind-position,
  filtering, and eye-ordering edits from `src/core/engine.ts` and
  `src/shaders/materials.ts`. The changes were re-grounded from current files
  and restored before verification.
- The ratified frontal planar projection was changed after side-profile review.
  The replacement decision is recorded in
  `meta/decisions/triplanar-surface-mapping.md` and is informed by
  `dec.text-skin`. Authored UV analysis measured 15,725 bust triangles with a
  p10 UV-area/object-area ratio of 0.0501, median 0.3146, p90 1.2488, and a
  24.9x p90/p10 spread. This rejected runtime UV sampling for uniform text.
- Bind-space triplanar blending was prototyped and captured in front, rotated,
  near-profile, and one-second flow pairs. A temporary capture-only yaw clamp
  increase was reverted immediately after the near-profile screenshot.
  Side-facing glyphs remain legible without the previous horizontal streaks.
- Known limitation: triplanar blending costs three texture samples and can
  cross-fade glyph strokes near equal normal-axis weights. The authored UV
  layout remains available for asset tooling but is not sampled at runtime.
