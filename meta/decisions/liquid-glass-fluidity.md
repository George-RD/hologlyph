---
id: dec.liquid-glass-fluidity
nodes:
  - hologlyph.runtime.shaders
  - hologlyph.runtime.core
status: accepted
date: 2026-07-27
informed_by:
  - res.liquid-glass-direction
  - src.owner-vision-2026-07-25
---
# Tier 3 fluidity: a modal solver on the CPU, and an outward-bounded flow bulge

## Context

`dec.liquid-glass-architecture` stages shape fidelity in four tiers and says of
tier 3 that it "needs a simulation and WebGPU compute". Tier 1 has since landed
(`todo.liquid-glass-tier1-pool`) and fixed three facts that tier 3 has to live
with, none of which were settled when the ladder was written.

First, the displacement is not free to point wherever it likes. The bust is
drawn in four passes ordered by `renderOrder`: the interior wall at -1, a
depth-only occlusion mask at 0, the authored internals (eyeballs,
`mouth_interior`, `eye_trim`) at 1, and the front shell at 2. The mask is a
`MeshBasicMaterial` clone of the body at the undeformed pose, so it does not
receive `positionNode`. That is only sound while the visible shell never moves
*inward* of it. Tier 1 handled this by mapping its breathe to [0,1] and calling
the outward-only bound load bearing. Any tier 3 field is bound by the same rule.

Second, the field is spatially masked by construction. The whole point of the
tier is that the base and neck flow while the mouth and eyes stay crisp, so the
weight is near zero exactly where the internals live and near one where there
is nothing behind the shell at all.

Third, `f = 0` has to be an identity, not an approximation. The approved look is
pinned by `bun run eval` against `tools/evals/baseline.json`, and tier 1
established the pattern that makes that survivable: derive a gate that is
exactly 0 when the feature is off, and `mix(shipped, deformed, gate)`.

## Decision

**The offset field is written by a low-order modal solver integrated on the
CPU, not by a WebGPU compute pass.** Tier 3 ships on WebGL2 and WebGPU alike,
with no capability branch and no second code path.

The solver is a single damped harmonic oscillator in three dimensions. Its
state is one displacement vector and one velocity vector: the dominant sloshing
mode of a body bound to its rest pose. Stiffness is the liquidity, exactly as
`todo.liquid-glass-fluidity-driver` asks; a stiff spring is a rigid head and a
slack one wallows. Gravity enters as a constant downward term, which is the sag.

The shader evaluates the field analytically from that vector:

```
w(p) = heightWeight(p) * faceWeight(p)        spatial mask, [0,1]
d(p) = amount * w(p) * max(0, dot(N, F))      scalar, >= 0
offset = N * d(p)
```

`F` is the solver's flow vector, sag plus slosh. The one-sided `max(0, ...)` is
what keeps the invariant above: the surface bulges on the side the liquid is
piling up against and is untouched on the other, which is what a viscous blob
actually does, and it can never go inward. A downward *translation* of the base
would have read as sag too, and would have broken the occlusion mask.

`heightWeight` decays upward from the waterline, so the flow lives in the base
and the shoulders. `faceWeight` is `1 - max(aLips, aJaw, aEyelid, aBrow, aNose,
aSocket)` raised by a `crisp` exponent: the masks that already drive per-zone
opacity, reused rather than re-baked. No new vertex attribute, so no asset
rebuild and no change to the two full interleaved buffers in `bakeFeatureMasks`.

**Shading normals follow the height-weight gradient only.** The exact Jacobian
of `N * d(p)` contains the shape operator `dN/dp`, which the shader does not
have, and the gradients of the six baked masks, which are not differentiable
attributes. Both are dropped. What remains is the analytic `dw/dy` term, built
into a tangential perturbation and subtracted inside the unit normal exactly as
tier 1 does. `normalWorld` needs no separate treatment: three resolves
`normalWorld` from `normalView`, and `normalView` outside the NORMAL sub-build
is `material.normalNode`, so the matte shade term follows for free once
`normalNode` is assigned. `bindNormal` is `normalGeometry` and is deliberately
untouched, so glyphs stay welded to the bind pose.

## Rationale

A compute simulation buys degrees of freedom, and tier 3 cannot spend them. The
field is masked to near zero over every high-frequency region of the model, and
the surviving band is the low-curvature base and neck. A per-particle solver
would resolve detail that the mask then multiplies away, and would cost a
WebGPU-only path plus a WebGL2 fallback for a look that is by construction
low-order.

It also buys nondeterminism this repo does not want. Every other dynamic system
here is integrated on the CPU with an injected clock so that tests can drive it
(`GazeController`, `interiorIntegrate`, `poolWaveStep`). Six floats a frame keep
tier 3 in that family: the solver is a pure function, the lab slider is
reproducible, and `f = 0` is provably an identity rather than a GPU state we
have to screenshot to trust.

The cost of the choice is real and is accepted: one global mode cannot show two
parts of the body sloshing out of phase, and it cannot squeeze against a page
obstacle on one side only. `todo.liquid-glass-stage-participants` wants exactly
that. When it lands, the solver grows from one mode to a small basis of them,
which is a change of `FLUID_MODES` and a loop, not a change of architecture.
Topology change stays where `dec.liquid-glass-architecture` put it, in tier 4.

## Consequences

- `dec.liquid-glass-architecture` said tier 3 "needs WebGPU compute". That
  clause is superseded for tier 3 only. Tier 4 still needs compute, and
  `dec.renderer-posture`'s deferral of compute shaders therefore stands.
- The displacement is outward-bounded, so the four-pass depth scheme and the
  three-layer occlusion contract survive untouched, as
  `todo.liquid-glass-fluidity-driver` requires.
- Visemes are unaffected at every fluidity value: `setupPosition` runs morph
  targets and skinning before `positionNode`, and the face weight is zero over
  the mouth regardless.
- Shading normals are correct to first order in the height weight and wrong in
  curvature. At high fluidity over a strongly curved region this would read as
  slight texture swim; the mask keeps the field off those regions, and the lab
  slider is the check.
- One global mode means no per-obstacle response. Recorded above as the price,
  and as the extension point.
