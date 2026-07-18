# Design: 2026-07-18-lsp-and-lint-gate

## Approach

Repair LSP resolution by adding the missing language server binary. Keep the
existing strict tsconfig and add only the compiler flags that the current code
passes. Introduce Biome as a lint-only gate, disabling the formatter so the gate
fails only on genuine rule violations rather than style churn. Wire the new lint
command into the existing Cairn gates list.

## Changes

ADDED:
- typescript-language-server as a development dependency.
- biome.json with a lint-only configuration and scoped rule overrides.
- lint and lint:fix scripts in package.json.
- meta/changes/2026-07-18-lsp-and-lint-gate/ change artefacts.

MODIFIED:
- tsconfig.json: added noFallthroughCasesInSwitch.
- cairn.config.yaml: added the lint gate after build.
- package.json: added Biome devDependency and lint scripts.
- Several source and test files received narrow, behaviour-preserving lint
  fixes (optional chaining, import type, template literals, unused symbols).

REMOVED:
- None.

RENAMED:
- None.
