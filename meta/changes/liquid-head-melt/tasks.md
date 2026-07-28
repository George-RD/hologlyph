# Tasks: liquid-head-melt

## Artefacts

- [x] `meta/sources/src.owner-look-2026-07-27.md`, verbatim quotes per lab
- [x] `meta/decisions/liquid-glass-melt.md`, accepted, with the escalation
      criterion and the tier 4 scope ruling
- [x] Demote the todos that missed: owner-look-session, tier1-pool,
      fluidity-driver, stage-participants, interior-glyphs, live-css-layer
- [x] `meta/todos/todo.interior-glyph-containment.md`
- [x] `meta/todos/todo.silhouette-hull-halo.md`
- [x] `meta/todos/todo.melt-internals.md` (opened by the lab session)

## Compare lab

- [x] `demo/compare-lab.html`: two same-origin iframes, chrome hidden, right
      side driven to `setScrollProgress(1)` with retry

## Melt

- [x] `src/shaders/melt.ts`: constants, `meltHeight`, `meltProgress`,
      `meltCollapse`, `meltNormal`
- [x] `test/shaders-melt.test.ts`: identity at 0, monotonicity, base-first,
      collapse at 1, finite unit normal at full melt
- [x] `HeadMeltConfig` in contracts, `DEFAULT_HEAD_CONFIG.melt`, overrides
- [x] `normaliseHeadConfig` melt block, frozen
- [x] Seven melt uniforms in `HeadUniforms` and `applyConfigToBindings`
- [x] Melt as the outermost position map on surface and interior
- [x] Melt normal transform on `breatheNormalLocal`, gated by the max of the
      three normal gates
- [x] `buildSkinMaterial` builds and owns the melting occlusion mask
- [x] `VFXEngine.setBodyExtent` plus the `EngineImpl` call at avatar load
- [x] Engine coverage in `test/core.test.ts`, including mutation-verified
      disposal counts across teardown and avatar replacement

## Melt lab

- [x] `demo/melt-lab.html`: amount, spread, floor, lag, glass, opacity, a cycle
      button, motion frozen by default, the escalation criterion in the panel

## Verification

- [x] `bunx tsc --noEmit`
- [x] `bunx vitest run` (597 passing)
- [x] `bun run lint` (1 pre-existing demo warning, untouched)
- [x] `bun run build`
- [x] `cairn hook all` (exit 0, decision pass)
- [x] Visual: compare-lab, shading difference recorded in
      `implementation-notes.md`
- [x] Visual: melt-lab sweep, escalation judgement written into
      `implementation-notes.md`
- [x] `bun run eval` overall pass, baseline unrecalibrated
- [x] Adversarial review pass, findings and dispositions recorded

## Left open, deliberately

- `todo.melt-internals`: the eyeballs, mouth cavity and eye trim do not melt
  with the shell. Found in the lab, not fixed here: melting them needs the two
  authored materials replaced, and a visibility gate would be the popping the
  acceptance forbids.
- Two review findings that the plan's own prescriptions cause, both needing a
  decision rather than an implementer's judgement: the one-sided
  `max(g', 1e-4)` guard drops the sign of a genuinely negative Jacobian at the
  base for `amount` 0.624 to 0.665, and `meltNormalGate = clamp01(amount)`
  attenuates the melt normal a second time through the middle of the sweep.
  Both written up in `implementation-notes.md`.
