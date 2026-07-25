# Proposal: fix-cairn-findings

## Motivation

`cairn scan` reported 42 findings (12 uncovered leaf node contracts, 24 orphaned files, 1 unknown reconciler language target, and 5 unverified sources). Resolving these findings aligns cairn's authority and provenance graph with the physical codebase.

## Scope

- Add contract specifications in `meta/contracts/` for all 12 leaf modules and link them in `cairn.blueprint`.
- Claim root source and test files under their respective module paths in `cairn.blueprint`.
- Ignore build output, demo scripts, and root tool configs in `cairn.config.yaml`.
- Set explicit language target override for `assets/` under `hologlyph.asset.loader` in `cairn.config.yaml`.
- Mark provenance sources under `meta/sources/` as verified with sha256 hashes.

## Out of scope

- Runtime functional changes to engine or adapters.
