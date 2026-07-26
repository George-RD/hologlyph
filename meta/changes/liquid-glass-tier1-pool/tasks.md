# Tasks: liquid-glass-tier1-pool

- [x] Add `HeadPoolConfig` to the contract spine with `amount` shipping at 0,
      wire it through `HeadConfig`, `HeadConfigOverrides` and
      `normaliseHeadConfig`, and pin the defaults in `test/shaders.test.ts`.
- [x] Write the pure pool maths in `src/shaders/pool.ts`: damped wave step,
      fixed-rate step count with a cap, ripple drive, impulse decay, radial
      profile, waterline radius, meniscus and contact ring.
- [x] Unit-test the CFL bound by iteration, the profile against a waisted bust,
      the drive saturation and reduced-motion damping, and the degenerate
      inputs that must degrade rather than throw.
- [x] Build the GPU half in `src/shaders/pool-surface.ts`: ping-pong half-float
      targets, an offscreen simulation pass lifted clear of the global clip
      plane, a sponge boundary, and a subdivided surface with the meniscus and
      contact ring.
- [x] Add the outward-only breathe to the skin materials, written as
      `positionLocal.add(...)` off `normalLocal` so morphs and skinning survive,
      with the shading normal following the analytic gradient through a mix
      that is exactly `normalView` at gate 0.
- [x] Add the waterline fade to the interior wall and the front glass terms so
      the clipped cross-section stops reading as a hollow shell.
- [x] Own the lifecycle in `EngineImpl`: bake the radial profile on avatar
      load, reconcile the pool against `pool.amount` every frame, feed it
      scroll and emergence speed, and dispose it with the engine.
- [x] Guard the field against a non-finite drive at both ends: drop a
      non-finite `setScrollProgress` and clamp at the boundary in the pool.
- [x] Engine tests: build and teardown at the amount boundary, build once
      however long the reconciler runs, waterline radius from the rig, scroll
      travel consumed once, and NaN rejected.
- [x] Lab page `demo/pool-lab.html` with live controls, a raised camera, the
      emergence and speech scenarios, a jaw-open toggle and a frame-time
      readout. Dev-only, not added to the demo build inputs.
- [x] Smoke script `tools/smoke/pool-shot.mjs`: noise floor, inertness at
      amount 0, morph survival under maximum breathe, and an optional
      vsync-free cost leg.
- [x] Verify: `bunx tsc --noEmit`, `bunx vitest run`, `bun run lint`,
      `bun run build`, `bun run eval`, `cairn hook all`.
- [x] Verify acceptance in a real browser: head emerging from a rippling pool
      with a visible meniscus, scroll-coupled, GPU cost measured with
      `onSubmittedWorkDone` rather than vsync-clamped frame deltas.
- [x] Fix the two defects the browser found: the hole in the water never closed
      after full submersion, and the height field was point-sampled into
      visible stair steps.
- [x] Independent review; findings fixed or recorded.
