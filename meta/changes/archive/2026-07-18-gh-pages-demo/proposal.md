# Proposal: gh-pages-demo

## Motivation

The demo only runs locally via `bun run dev`. A public GitHub Pages site lets
anyone try the talking head without cloning the repo.

## Scope

- Standalone Vite app config for the demo with the `/hologlyph/` base path.
- GitHub Actions workflow deploying the built demo to GitHub Pages on every
  push to main.
- Repo made public (user-ratified) so Pages works on the free plan.

## Out of scope

- npm publish.
- Any change to the library build or runtime source.
