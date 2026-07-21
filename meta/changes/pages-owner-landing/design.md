# Design: pages-owner-landing

## Approach

Promote the lab page to the landing slot instead of duplicating its shader
code into a separate showcase: one file serves both audiences (visitors see
the full-screen head; the owner opens the panel with "tune"/?tune). The
engine demo keeps its own page so the visual eval baseline stays valid; the
harnesses are re-pointed at it explicitly.

## Changes

ADDED:
- demo/engine.html (renamed from index.html), feature-shading-lab.html
  redirect stub, topbar + panel-collapse shell in the lab.

MODIFIED:
- demo/vite.config.ts (multi-page inputs), tools/evals/capture.mjs,
  .github/workflows/ci.yml, tools/smoke/demo-smoke.mjs,
  tools/smoke/lab-shot.mjs, demo/LAB-STATUS.md.

REMOVED:
- Nothing.
