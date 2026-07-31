# Proposal: public-camera-pose

## Motivation

Hosts and deployed demos cannot frame the head without reaching into the
renderer implementation. A public declarative pose preserves renderer ownership
while making ordinary camera framing durable.

## Scope

- Add the `ViewPose` Engine contract, initial option, resolved state, validation,
  clamping, and renderer reconciliation.
- Verify default-view identity, lifecycle durability, and input boundaries.
- Migrate the five development labs from private camera access to `setView`.

## Out of scope

- Raw Three.js camera access and projection controls beyond field of view.
- New studio controls.
