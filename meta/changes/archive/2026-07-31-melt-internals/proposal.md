# Proposal: melt-internals

## Motivation

At high melt amounts the eyeballs, mouth interior, and eye trim remained rigid
while the shell collapsed, making the head read as disconnected parts rather
than one melting form.

## Scope

- Route the existing melt displacement through eyeball and authored internal
  material paths.
- Convert eligible authored standard materials into owned node materials while
  preserving their enumerable authored state and texture lifetime.
- Verify the full melt sweep, rest-state continuity, studio smoke, and gates.

## Out of scope

- Changing topology or adding a particle fluid representation.
- Solving the expected zero-thickness limitation at exactly full melt.
