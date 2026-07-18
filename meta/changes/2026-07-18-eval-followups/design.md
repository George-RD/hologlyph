# Design: 2026-07-18-eval-followups

## Approach

Documentation and backlog only, plus a two-line portability guard copied
from `tools/evals/capture.mjs`: spread the Metal ANGLE flag only when
`process.platform` is darwin so Linux runs fall back to SwiftShader.

## Changes

ADDED:
- `meta/todos/todo.blend-zone-ghosting-metric.md`

MODIFIED:
- `tools/smoke/demo-smoke.mjs`, `tools/smoke/consumer-smoke.mjs`
- `tools/smoke/README.md`

REMOVED:
- None

RENAMED:
- None
