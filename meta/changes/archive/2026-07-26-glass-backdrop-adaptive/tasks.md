# Tasks: glass-backdrop-adaptive

- [x] Add `SkinGlassConfig` and `SkinBackdropConfig` to `src/contracts.ts` and
      extend `DEFAULT_HEAD_CONFIG`.
- [x] Write `src/shaders/glass.ts` with the pure backdrop adaptation maths.
- [x] Write `test/shaders-glass.test.ts` covering luminance, identity on dark
      backdrops, ink on light backdrops, and the mid-tone opacity floor.
- [x] Wire the glass and adaptation uniforms into `buildSkinMaterial`.
- [x] Normalise and bind the new config in `normaliseHeadConfig` and
      `createVFXEngine`.
- [x] Make the renderer host transparent.
- [x] Auto-detect the host page backdrop on mount (`src/core/backdrop.ts`),
      including across shadow boundaries.
- [x] Update `test/shaders.test.ts` default-config pin and add uniform coverage.
- [x] Browser smoke over dark, mid, light, and brand-colour pages.
- [x] Full gate: tsc, vitest, build, lint, eval, `cairn hook all`.
