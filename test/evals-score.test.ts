import { describe, expect, it } from 'vitest';

const scoreModule = (await import('../tools/evals/score.mjs')) as unknown as {
  validateBaseline: (payload: unknown) => void;
};
const { validateBaseline } = scoreModule;

describe('visual eval baseline validation', () => {
  it('rejects a truncated baseline before scoring captures', () => {
    expect(() =>
      validateBaseline({
        baseline: {
          glyphLegibility: 7.5,
          coverageFront: 0.16,
          // Remaining expected metric keys are intentionally absent.
        },
      }),
    ).toThrowError(/baseline-missing.*coverageYawPlus.*flow/);
  });

  it('rejects non-positive baseline values as missing', () => {
    expect(() =>
      validateBaseline({
        baseline: {
          glyphLegibility: 0,
          coverageFront: 0.16,
          coverageYawPlus: 0.17,
          coverageYawMinus: 0.17,
          flow: 44,
          yawLegibilityPlus: 35,
          yawLegibilityMinus: 35,
          blendZoneGhosting: 0.49,
        },
      }),
    ).toThrowError(/baseline-missing.*glyphLegibility/);
  });
});
