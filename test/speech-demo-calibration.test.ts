import { describe, expect, it } from 'vitest';
import { DEMO_VISEME_GAIN, demoWeightsForViseme } from '../src/speech/adapters/demo';
import { weightsForViseme } from '../src/speech/visemes';

describe('demo speech calibration', () => {
  it('keeps generic canonical visemes at full strength but damps browser-demo speech', () => {
    expect(weightsForViseme('viseme_aa').viseme_aa).toBe(1);
    expect(demoWeightsForViseme('viseme_aa')).toEqual({
      viseme_aa: DEMO_VISEME_GAIN,
      jaw_open: 0,
    });
    expect(DEMO_VISEME_GAIN).toBe(0.55);
  });

  it('applies the same calibration across canonical demo visemes', () => {
    for (const viseme of ['viseme_ih', 'viseme_ee', 'viseme_oh', 'viseme_ou', 'viseme_ss']) {
      expect(demoWeightsForViseme(viseme)[viseme]).toBeCloseTo(0.55);
      expect(demoWeightsForViseme(viseme).jaw_open).toBe(0);
    }
  });
});
