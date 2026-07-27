# Proposal: liquid-glass-fluidity-driver

## Motivation

Item 8 of `dec.liquid-glass-architecture`, and the last piece of the shape
ladder before tier 4. Tier 1 shipped a pool the bust emerges from and a
millimetric outward breathe on the shell; the body itself is still rigid. The
owner's brief is a block of liquid glass, and a rigid block is not one.

The tier is also what `todo.liquid-glass-stage-participants` is really waiting
for: participants have nothing to collide with until something on the body can
be pushed around.

## Scope

- A `fluid` block on `HeadConfig`, hard-gated at `amount: 0`.
- A damped modal solver in `src/shaders/fluid.ts`, integrated on the CPU.
- A spatially weighted, outward-bounded displacement in the skin material, with
  the shading normal following the part of the field that has an analytic
  gradient.
- A `setFluidDrive` seam on `VFXEngine`, fed from the core frame loop by scroll
  speed, emergence speed, behaviour state and the carrier bone's velocity.
- `demo/fluid-lab.html`, lab-only, with the slider the acceptance asks for.
- `dec.liquid-glass-fluidity`, recording the deviation from the accepted
  decision's "needs WebGPU compute" clause and the reasons for it.

## Out of scope

- Tier 4 topology change (`todo.liquid-glass-topology-fluid`), which is where
  the only real viseme cost lives.
- Per-obstacle response. One global mode cannot squeeze against a page element
  on one side only; `todo.liquid-glass-stage-participants` needs a small basis
  of modes, which is a constant and a loop, not a redesign.
- Turning the feature on by default. It ships at `amount: 0` and stays lab-only
  until the owner approves the look, exactly as tier 1 and the interior field
  did.
