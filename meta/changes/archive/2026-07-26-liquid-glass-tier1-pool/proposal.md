# Proposal: liquid-glass-tier1-pool

Implements `meta/todos/todo.liquid-glass-tier1-pool.md`, item 3 of the
recommended order in `dec.liquid-glass-architecture`.

## Motivation

Today the waterline is a razor cut. `src/shaders/emergence.ts` pairs a
world-space clipping plane at the origin with a root-group translation, and the
bust rises through nothing: there is no water, so "emerging" reads as a head
being wiped in from the bottom. The decision calls tier 1 the largest
perceptual jump per unit of risk, because it needs no asset change, no contract
change and no compute shaders, and it can be judged in the lab before any of it
is switched on by default.

## Scope

- A damped height field simulated on the GPU as a ping-pong pair of half-float
  render targets, advanced at a fixed 60 Hz independent of the frame rate.
- One ring impulse source at the contact contour, driven by scroll speed and by
  how fast the bust is crossing the plane, damped under reduced motion.
- An analytic meniscus and a bright contact ring where the body crosses, sized
  from a radial profile measured off the loaded rig rather than assumed.
- A bounded outward breathe on the shell itself, with shading normals derived
  from the gradient of the same field so the surface flows rather than swims.
- A waterline fade on the glass terms so the clipped cross-section stops
  reading as a hollow shell.
- `HeadConfig.pool`, gated at `amount: 0`, plus a lab page and a smoke script
  that measures inertness, morph survival and GPU cost.

## Out of scope

- Melting the head into the pool, squeezing around obstacles, and any implicit
  surface. Those are tiers 2 and 3.
- Turning the pool on by default. It stays lab-only until the owner approves
  the look, the same pattern the feature-shading lab followed.
- Softening the authored `mouth_interior` and `eye_trim` materials at the
  waterline. See the implementation notes for why that is deferred rather than
  done badly.
