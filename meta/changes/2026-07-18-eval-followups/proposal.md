# Proposal: 2026-07-18-eval-followups

## Motivation

Post-merge review of the eval harness left two loose ends: the triplanar
blend-zone ghosting residual had no actionable backlog entry, and the smoke
scripts still hard-coded the macOS-only ANGLE Metal flag with a stale README
pointing at a machine-local Playwright path.

## Scope

- New todo `meta/todos/todo.blend-zone-ghosting-metric.md` (metric first,
  shader tuning only if the metric warrants it).
- Platform-conditional `--use-angle=metal` in both smoke scripts.
- `tools/smoke/README.md` prerequisites updated for the Playwright
  devDependency and `HOLOGLYPH_CHROME` override.

## Out of scope

- Any change to the eval harness or shaders themselves.
