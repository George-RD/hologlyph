# Proposal: 2026-07-18-lsp-and-lint-gate

## Motivation

OMP could not start TypeScript language services because the repository had root
package.json and tsconfig.json markers but no resolvable
typescript-language-server binary. The project also lacked a repository lint
gate, so strict compiler checks and tests were not enough to catch style and
correctness issues before Cairn acceptance.

## Scope

- Add typescript-language-server as a development dependency beside the real
  TypeScript package.
- Keep strict TypeScript settings that pass the existing codebase and add
  noFallthroughCasesInSwitch.
- Add Biome v2 as a lint-only development check scoped to src, tools, demo, and
  test.
- Add lint and lint:fix package scripts and run lint through the Cairn gates.
- Record verification results and known governance blockers.

## Out of scope

- No commit, pull request, or merge.
- No changes to the sibling-owned shader and runtime files while their edits are
  in progress.
- No broad formatter rewrite. Biome formatting is disabled to avoid a
  64-file formatting diff.
