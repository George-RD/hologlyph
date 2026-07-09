/**
 * Semantic expression vocabulary mapped to canonical blendshape weights.
 *
 * Per dec.expression-vocab the public API is semantic; raw facial coefficients
 * are not the primary surface. Each semantic Expression resolves to a set of
 * weights over RIG_EXPRESSION_MORPHS, every weight clamped to [0,1] downstream.
 */

import type { BlendshapeWeights, Expression } from '../contracts';
import { RIG_EXPRESSION_MORPHS } from '../contracts';

export const EXPRESSION_MAP: Record<Expression, BlendshapeWeights> = {
  neutral: { exp_relaxed: 0.1 },
  friendly: { exp_relaxed: 0.4, exp_brow_up: 0.2, exp_happy: 0.25, mouth_round: 0.05 },
  thinking: { exp_brow_up: 0.3, exp_relaxed: 0.15, jaw_open: 0.05, exp_blink: 0.1 },
  agree: { exp_happy: 0.3, exp_brow_up: 0.2, exp_relaxed: 0.3, mouth_round: 0.1, jaw_open: 0.05 },
  concern: { exp_sad: 0.35, exp_brow_down: 0.3, exp_blink: 0.1 },
  happy: { exp_happy: 0.8, exp_brow_up: 0.4, exp_relaxed: 0.3, mouth_round: 0.3, jaw_open: 0.2 },
  surprised: { exp_surprised: 0.8, exp_brow_up: 0.6, exp_blink: 0.2, jaw_open: 0.4, mouth_round: 0.2 },
  listening: { exp_relaxed: 0.3, exp_brow_up: 0.15, exp_blink: 0.1 },
  speaking: { exp_relaxed: 0.2, exp_happy: 0.2, jaw_open: 0.15, mouth_round: 0.1, exp_blink: 0.1 },
};

/** A weight set with every canonical expression morph present (default 0). */
export function emptyExpressionWeights(): BlendshapeWeights {
  const w: BlendshapeWeights = {};
  for (const name of RIG_EXPRESSION_MORPHS) w[name] = 0;
  return w;
}

/** Resolve a semantic Expression into a full canonical weight set. */
export function weightsFor(expr: Expression): BlendshapeWeights {
  const out = emptyExpressionWeights();
  const src = EXPRESSION_MAP[expr];
  for (const name of RIG_EXPRESSION_MORPHS) {
    const v = src[name];
    out[name] = v ?? 0;
  }
  return out;
}

/** Linear interpolate two weight sets at t in [0,1]. */
export function lerpWeights(
  from: BlendshapeWeights,
  to: BlendshapeWeights,
  t: number,
): BlendshapeWeights {
  const out: BlendshapeWeights = {};
  for (const name of RIG_EXPRESSION_MORPHS) {
    const a = from[name] ?? 0;
    const b = to[name] ?? 0;
    out[name] = a + (b - a) * t;
  }
  return out;
}
