# Design: melt-internals

## Approach

Factor the shared melt-position calculation so the shell, eyeballs, mouth
interior, and eye trim receive the same gated displacement. Convert the two
authored internal `MeshStandardMaterial` instances to owned node materials by
copying every enumerable source property, mirroring the relevant Three r178
conversion behaviour without depending on its private renderer API. Retain the
source material objects only for safe teardown, never as texture owners.

## Changes

ADDED:
- Material-state audit and node-material conversion coverage.

MODIFIED:
- Melt position graph routing and avatar material assignment.
- Studio cold-start framing oracle.

REMOVED:
- The assumption that authored material data blocks internal melting.

RENAMED:
- None.
