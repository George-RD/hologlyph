# Design: gh-pages-demo

## Approach

Keep the root vite.config.ts strictly library-mode. Add demo/vite.config.ts as
a separate app config (base `/hologlyph/`, outDir `demo/dist`) so the demo
build cannot inherit `build.lib`. A Pages workflow builds with bun and deploys
`demo/dist` via actions/upload-pages-artifact and actions/deploy-pages, using
the workflow build type (no gh-pages branch).

## Changes

ADDED:
- demo/vite.config.ts (app build config with Pages base path).
- .github/workflows/pages.yml (build and deploy on push to main).
- demo/dist ignored in .gitignore.

MODIFIED:
- Repo visibility private to public; Pages enabled with workflow build type.

REMOVED:
- None.

RENAMED:
- None.
