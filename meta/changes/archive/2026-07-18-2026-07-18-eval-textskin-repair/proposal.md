# Proposal: 2026-07-18-eval-textskin-repair

## Motivation
Three verified review findings remain unresolved: eval scoring can report "baseline-missing" while returning success, flow captures can be contaminated by avatar motion drift, and reduced-motion preferences do not currently pause text-skin scroll.

## Scope
- Harden eval baseline validation so incomplete or non-positive baselines fail hard.
- Make flow capture frames deterministic by freezing motion during the two flow samples via the demo engine handle.
- Thread reduced-motion preference into the text-skin engine so row-flow motion pauses when reduced motion is requested.
- Add red-first tests for each behavioural contract.
- Update eval README to document the deterministic flow capture and recalibration note.

## Out of scope
- Renderer lifecycle and adapter API changes.
- Webgl/Three.js visual asset changes.
- Core benchmark or benchmark harness redesign.
