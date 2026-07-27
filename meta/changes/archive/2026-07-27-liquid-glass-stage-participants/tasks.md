# Tasks: liquid-glass-stage-participants

- [x] Contracts: `HeadStageConfig`, `HeadConfig.stage`, defaults,
      `StageCollider`, `VFXEngine.setStageColliders`/`stageFlow`,
      `Engine.refreshStage`
- [x] Grow the modal basis in `src/shaders/fluid.ts`: `FLUID_MODES`,
      `fluidBandWeight`, `fluidSqueezeTarget`, `fluidTargetAccel`,
      `fluidReaction`
- [x] `src/core/participants.ts`: markers, batched measurement, observers,
      projection, collision, transform write-back
- [x] Unroll the modal sum and its gradient in `src/shaders/materials.ts`
- [x] Soft Dirichlet participant dents in `src/shaders/pool-surface.ts`
- [x] Participant mode solver and `setStageColliders` in `src/shaders/index.ts`
- [x] Reconcile the stage per frame in `src/core/engine.ts`
- [x] Tests: modal basis and VFX wiring in `test/shaders-fluid.test.ts`, the
      stage in `test/core-participants.test.ts`, engine wiring in
      `test/core.test.ts`
- [x] `demo/stage-lab.html` and `tools/smoke/stage-shot.mjs`
- [x] `dec.liquid-glass-participants` and the `cairn.blueprint` path claim
- [x] Full gate: `bunx tsc --noEmit`, `bunx vitest run`, `bun run lint`,
      `bun run build`, `bun run eval`, `cairn hook all`
