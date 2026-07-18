/**
 * Baseline idle motion: a low-amplitude layer that keeps the bust from reading
 * as a statue. It composes BELOW expression and viseme priority, so it never
 * fights speech or explicit expressions.
 *
 * Per the idle motion todo (hologlyph.runtime.motion):
 *  - Breathing: a slow sinusoid (head pitch, ~0.18 Hz) on the shared clock.
 *  - Micro head drift: a smoothed low-amplitude random offset on yaw/pitch/roll,
 *    resampled every few seconds via the injected rng.
 *  - Weight-shift: a rare, very slow roll bias, resampled on a long interval and
 *    eased toward slowly so the shift is gradual, never a snap.
 *  - Blinks: scheduled as a Poisson process (exponential inter-arrival) through
 *    the existing blink morphs, with a raised-cosine close/open envelope.
 *
 * All randomness flows through the injected rng/clock seams, so the layer is
 * fully deterministic under test. Reduced motion damps every amplitude; the
 * engine passes its speaking flag so the blink blends out while lip-syncing.
 */

import type { Rng, Clock } from './gaze';

export interface IdleOptions {
  /** Deterministic randomness source (defaults to Math.random). */
  rng?: Rng;
  /** Time source in seconds; when omitted update()'s now argument is used. */
  clock?: Clock;
  /** Mean seconds between blinks (Poisson process). */
  blinkMean?: number;
  /** Breathing frequency in Hz (0.1-0.25 per the todo). */
  breathHz?: number;
  /** Blink close/open envelope duration in seconds. */
  blinkDuration?: number;
  /** Master amplitude scale; the engine maps idle?: boolean | {intensity}. */
  intensity?: number;
}

/** Additive idle pose for one frame, all angles in radians, blink in [0,1]. */
export interface IdlePose {
  pitch: number;
  yaw: number;
  roll: number;
  blink: number;
}

const DEFAULT_BLINK_MEAN = 4;
const DEFAULT_BREATH_HZ = 0.18;
const DEFAULT_BLINK_DURATION = 0.18;

/** Pre-intensity amplitude bounds (radians); the test asserts these. */
const BREATH_AMP = 0.018;
const DRIFT_AMP = 0.03;
const SHIFT_AMP = 0.045;
const DRIFT_ROLL_SCALE = 0.6;
const DRIFT_INTERVAL = 5;
const SHIFT_INTERVAL_MIN = 18;
const SHIFT_INTERVAL_MAX = 40;
/** Drift easing rate (per second); 1 - exp(-dt * k) smoothing. */
const DRIFT_SMOOTH_K = 1.5;
/** Weight-shift easing rate (per second); much slower so shifts are gradual. */
const SHIFT_SMOOTH_K = 0.3;
/** Reduced motion multiplies every amplitude by this factor. */
const REDUCED_AMP = 0.15;
/** Blink amplitude multiplier while speaking (blends out near the mouth). */
const SPEAK_BLINK = 0.3;

/** Normalise a public intensity to a finite value in [0,1]; non-finite -> 1. */
function clampIntensity(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}
export class IdleController {
  private readonly rng: Rng;
  private readonly clock: Clock | undefined;
  private readonly blinkMean: number;
  private readonly breathHz: number;
  private readonly blinkDuration: number;
  private intensity: number;
  private reduced = false;
  private disposed = false;

  // Smoothed micro head drift (radians) and its resample target.
  private driftTarget = { pitch: 0, yaw: 0, roll: 0 };
  private drift = { pitch: 0, yaw: 0, roll: 0 };
  private driftNextAt = 0;

  // Rare slow weight-shift roll bias (radians), its resample target, and the
  // time of the next resample.
  private shiftRoll = 0;
  private shiftTarget = 0;
  private shiftNextAt = 0;

  // Poisson blink schedule: next trigger time and the open-envelope start.
  private blinkNextAt: number;
  private blinkStart = -1;

  constructor(options: IdleOptions = {}) {
    this.rng = options.rng ?? Math.random;
    this.clock = options.clock;
    this.blinkMean = options.blinkMean ?? DEFAULT_BLINK_MEAN;
    this.breathHz = options.breathHz ?? DEFAULT_BREATH_HZ;
    this.blinkDuration = options.blinkDuration ?? DEFAULT_BLINK_DURATION;
    this.intensity = clampIntensity(options.intensity ?? 1);
    // First blink scheduled from t=0 with the same exponential spacing.
    this.blinkNextAt = this.exponential(this.rng()) * this.blinkMean + 0.5;
    // First weight-shift is rare: schedule it 18-40 s out, not on frame one.
    this.shiftNextAt = SHIFT_INTERVAL_MIN + this.rng() * (SHIFT_INTERVAL_MAX - SHIFT_INTERVAL_MIN);
  }

  setReduced(reduced: boolean): void {
    this.reduced = reduced;
  }

  setIntensity(intensity: number): void {
    this.intensity = clampIntensity(intensity);
  }

  /** Standard exponential sample (mean 1) from a uniform u in [0,1). */
  private exponential(u: number): number {
    const x = 1 - Math.max(u, 1e-9);
    return -Math.log(x);
  }

  update(dt: number, now: number, speaking: boolean): IdlePose {
    if (this.disposed) return { pitch: 0, yaw: 0, roll: 0, blink: 0 };
    const t = this.clock ? this.clock() : now;
    const amp = this.intensity * (this.reduced ? REDUCED_AMP : 1);
    const blinkAmp = amp * (speaking ? SPEAK_BLINK : 1);

    // Breathing: a deterministic sinusoid on the clock.
    const breath = BREATH_AMP * Math.sin(2 * Math.PI * this.breathHz * t) * amp;

    // Micro head drift: resample a fresh target every few seconds, then ease
    // the current offset toward it so motion stays smooth.
    if (t >= this.driftNextAt) {
      this.driftTarget = {
        pitch: (this.rng() * 2 - 1) * DRIFT_AMP,
        yaw: (this.rng() * 2 - 1) * DRIFT_AMP,
        roll: (this.rng() * 2 - 1) * DRIFT_AMP * DRIFT_ROLL_SCALE,
      };
      this.driftNextAt = t + DRIFT_INTERVAL * (0.6 + this.rng() * 0.8);
    }
    const driftK = Math.min(1, dt * DRIFT_SMOOTH_K);
    this.drift.pitch += (this.driftTarget.pitch - this.drift.pitch) * driftK;
    this.drift.yaw += (this.driftTarget.yaw - this.drift.yaw) * driftK;
    this.drift.roll += (this.driftTarget.roll - this.drift.roll) * driftK;

    // Rare weight-shift: resample a slow roll bias on a long interval, then
    // ease the current bias toward it so the shift is gradual, never a snap.
    if (t >= this.shiftNextAt) {
      this.shiftTarget = (this.rng() * 2 - 1) * SHIFT_AMP;
      this.shiftNextAt = t + SHIFT_INTERVAL_MIN + this.rng() * (SHIFT_INTERVAL_MAX - SHIFT_INTERVAL_MIN);
    }
    const shiftK = Math.min(1, dt * SHIFT_SMOOTH_K);
    this.shiftRoll += (this.shiftTarget - this.shiftRoll) * shiftK;

    // Blink scheduling: trigger when the clock passes the next time, run the
    // raised-cosine envelope, then schedule the following blink.
    let blink = 0;
    if (this.blinkStart < 0 && t >= this.blinkNextAt) {
      this.blinkStart = t;
    }
    if (this.blinkStart >= 0) {
      const phase = (t - this.blinkStart) / this.blinkDuration;
      if (phase >= 1) {
        this.blinkStart = -1;
        this.blinkNextAt = t + this.exponential(this.rng()) * this.blinkMean;
      } else {
        blink = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
      }
    }

    return {
      pitch: breath + this.drift.pitch * amp,
      yaw: this.drift.yaw * amp,
      roll: this.drift.roll * amp + this.shiftRoll * amp,
      blink: blink * blinkAmp,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.drift = { pitch: 0, yaw: 0, roll: 0 };
    this.driftTarget = { pitch: 0, yaw: 0, roll: 0 };
    this.shiftRoll = 0;
    this.shiftTarget = 0;
    this.blinkStart = -1;
    this.driftNextAt = 0;
    this.shiftNextAt = 0;
  }
}
