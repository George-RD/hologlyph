# Tasks: liquid-glass-fluidity-driver

- [x] Record `dec.liquid-glass-fluidity` before building on it: the CPU modal
      solver in place of the WebGPU compute pass the ladder assumed, and the
      one-sided flow bulge in place of a downward translation.
- [x] `HeadFluidConfig` on the contract, hard-gated at `amount: 0`, normalised
      through `finiteOr` so a host NaN cannot poison the integrator.
- [x] `src/shaders/fluid.ts`: damped modal solver, saturating drive, behaviour
      gain, height and face weights, soft one-sided ramp.
- [x] Skin material: fluid uniforms, the field, and one combined displacement
      and gradient shared with the tier 1 breathe.
- [x] Shading normals follow the height-weight gradient; `bindNormal` stays on
      the bind pose so glyphs stay welded to the skin.
- [x] `VFXEngine.setFluidDrive`, solver integration in `update`, reconcile that
      does not race the behaviour gain back to the raw config.
- [x] Core frame loop: carrier velocity from the head-carrying bone, drive from
      scroll and emergence speed, all gated on the configured amount.
- [x] `demo/fluid-lab.html` with the fluidity slider, a shake scenario, pointer
      drag and the frame-time readout.
- [x] Tests: 20 in `test/shaders-fluid.test.ts` plus two engine-wiring tests in
      `test/core.test.ts`.
- [x] Gate: `bunx tsc --noEmit`, `bunx vitest run` (502 pass), `bun run build`,
      `bun run lint` (one pre-existing demo warning), `cairn hook all`.
- [x] `bun run eval` overall pass at `fluid.amount: 0`.
- [x] Live browser smoke on WebGPU: no console errors, speech starts at
      `amount: 1`, frame time unmoved between 0 and 1.
