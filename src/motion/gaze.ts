/**
 * Gaze behaviour: social-eye-contact states with procedural saccades.
 *
 * Per dec.expression-vocab:
 *  - 'contact'  : direct eye contact plus micro-saccades (Gaussian jitter),
 *                 resampled every 800-1200 ms.
 *  - 'aversion' : offset within a constrained 15-30 degree cone, slower drift.
 *  - 'idle'     : gentle wander.
 *
 * Timing is driven by an injectable clock so the motion is deterministic under
 * test. Reduced motion flattens the gaze to rest (dec.performance-budget).
 */

import type { GazeMode } from '../contracts';

export type Rng = () => number;
export type Clock = () => number;

export interface GazeOffset {
  pitch: number;
  yaw: number;
}

const DEG = Math.PI / 180;

/**
 * Eye gaze limits (radians) reached when the normalised pointer is at the
 * screen edge. The element passes a normalised device coordinate in [-1, 1];
 * `ndcToGazeOffset` clamps it and converts it to a clamped eye yaw/pitch.
 */
export const FOLLOW_YAW_LIMIT = 0.45;
export const FOLLOW_PITCH_LIMIT = 0.32;

/** Convert a normalised pointer position (NDC x,y in [-1,1]) to a clamped eye offset. */
export function ndcToGazeOffset(ndcX: number, ndcY: number): GazeOffset {
  const cx = Math.max(-1, Math.min(1, ndcX));
  const cy = Math.max(-1, Math.min(1, ndcY));
  // Screen y grows downward; a positive pitch looks up, so negate cy.
  return { yaw: cx * FOLLOW_YAW_LIMIT, pitch: -cy * FOLLOW_PITCH_LIMIT };
}

/** Standard normal sample via Box-Muller, driven by the injected rng. */
export function gaussian(rng: Rng): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface GazeControllerOptions {
  /** Idle timeout (seconds) after the last follow target before returning to forward. */
  followTimeout?: number;
}

/** Time constants (seconds) for the exponential smoothing used while following. */
const FOLLOW_TAU = 0.12;
const FOLLOW_TAU_REDUCED = 0.6;

export class GazeController {
  private mode: GazeMode = 'idle';
  private current: GazeOffset = { pitch: 0, yaw: 0 };
  private target: GazeOffset = { pitch: 0, yaw: 0 };
  private nextAt = 0;
  private reduced = false;

  // Pointer follow state: when set, overrides the procedural saccades until the
  // idle timeout elapses or clearFollow() is called.
  private followTarget: GazeOffset | null = null;
  private followUntil = 0;
  private readonly followTimeout: number;

  constructor(
    private readonly rng: Rng,
    private readonly clock?: Clock,
    options?: GazeControllerOptions,
  ) {
    this.followTimeout = options?.followTimeout ?? 2;
  }

  setMode(mode: GazeMode): void {
    this.mode = mode;
    // A mode change must take effect immediately: drop the pending saccade
    // schedule so the next update() resamples under the new mode instead of
    // holding the old offset for up to ~1.2 s (e.g. speaking entering the
    // 15-30 degree aversion cone without waiting).
    this.nextAt = 0;
  }

  setReduced(reduced: boolean): void {
    this.reduced = reduced;
  }
  /** Point the eyes at a clamped direction; the idle timeout restarts. */
  setFollowTarget(yaw: number, pitch: number, now: number): void {
    this.followTarget = { yaw, pitch };
    this.followUntil = now + this.followTimeout;
  }

  /** Stop following so the gaze eases back to forward/idle. */
  clearFollow(): void {
    if (this.followTarget) this.followUntil = 0;
  }

  /** True while a follow target is active (before the idle timeout). */
  isFollowing(now: number): boolean {
    return this.followTarget !== null && now < this.followUntil;
  }

  update(dt: number, elapsed: number): GazeOffset {
    const now = this.clock ? this.clock() : elapsed;
    if (this.followTarget) {
      // While following (or easing back after the timeout), override the
      // procedural saccades. Exponential smoothing never overshoots for any
      // dt, so the motion is snap-free even under reduced motion.
      const active = now < this.followUntil;
      const goal = active ? this.followTarget : { pitch: 0, yaw: 0 };
      const tau = this.reduced ? FOLLOW_TAU_REDUCED : FOLLOW_TAU;
      const k = 1 - Math.exp(-dt / tau);
      this.current.pitch += (goal.pitch - this.current.pitch) * k;
      this.current.yaw += (goal.yaw - this.current.yaw) * k;
      if (!active && Math.abs(this.current.pitch) < 1e-4 && Math.abs(this.current.yaw) < 1e-4) {
        this.followTarget = null; // fully returned to forward; resume saccades
      }
      return this.current;
    }
    if (now >= this.nextAt) this.resample(now);
    const k = Math.min(1, dt * 6);
    this.current.pitch += (this.target.pitch - this.current.pitch) * k;
    this.current.yaw += (this.target.yaw - this.current.yaw) * k;
    return this.current;
  }

  private resample(now: number): void {
    if (this.reduced) {
      this.target = { pitch: 0, yaw: 0 };
      this.nextAt = now + 0.5;
      return;
    }
    switch (this.mode) {
      case 'contact': {
        // Direct contact with micro-saccades: tiny Gaussian jitter.
        this.target = {
          pitch: gaussian(this.rng) * 0.012,
          yaw: gaussian(this.rng) * 0.012,
        };
        this.nextAt = now + 0.8 + this.rng() * 0.4;
        break;
      }
      case 'aversion': {
        // Offset within a constrained 15-30 degree cone, slower drift.
        const mag = (15 + this.rng() * 15) * DEG;
        const dir = this.rng() * Math.PI * 2;
        this.target = { pitch: Math.sin(dir) * mag, yaw: Math.cos(dir) * mag };
        this.nextAt = now + 1.5 + this.rng();
        break;
      }
      default: {
        // Gentle wander.
        this.target = {
          pitch: gaussian(this.rng) * 0.04,
          yaw: gaussian(this.rng) * 0.04,
        };
        this.nextAt = now + 1.0 + this.rng() * 0.5;
        break;
      }
    }
  }
}
