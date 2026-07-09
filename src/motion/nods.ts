/**
 * Procedural head-nod envelopes.
 *
 * Per dec.expression-vocab a single canned nod feels robotic, so three distinct
 * classes are provided, each a short rotation envelope evaluated over a
 * normalised phase t in [0,1] (negative pitch = nod down).
 */

import type { NodClass } from '../contracts';

export interface NodSpec {
  /** Envelope duration in seconds. */
  duration: number;
  /** Peak pitch-dip magnitude in radians. */
  amplitude: number;
  /** Envelope shape: pitch offset (negative = down) for phase t in [0,1]. */
  evaluate: (t: number) => number;
}

export const NOD_SPECS: Record<NodClass, NodSpec> = {
  // Subtle single listener backchannel dip.
  backchannel: {
    duration: 0.35,
    amplitude: 0.12,
    evaluate: (t) => -Math.sin(Math.PI * t),
  },
  // Stronger double affirmative nod (two dips).
  affirmative: {
    duration: 0.7,
    amplitude: 0.22,
    evaluate: (t) => -Math.abs(Math.sin(Math.PI * 2 * t)),
  },
  // Sharper single speech-timed emphasis nod (narrow Gaussian bump).
  emphasis: {
    duration: 0.3,
    amplitude: 0.18,
    evaluate: (t) => -Math.exp(-Math.pow((t - 0.3) / 0.12, 2)),
  },
};
