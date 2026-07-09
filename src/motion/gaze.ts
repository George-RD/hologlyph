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

/** Standard normal sample via Box-Muller, driven by the injected rng. */
export function gaussian(rng: Rng): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class GazeController {
  private mode: GazeMode = 'idle';
  private current: GazeOffset = { pitch: 0, yaw: 0 };
  private target: GazeOffset = { pitch: 0, yaw: 0 };
  private nextAt = 0;
  private reduced = false;

  constructor(
    private readonly rng: Rng,
    private readonly clock?: Clock,
  ) {}

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

  update(dt: number, elapsed: number): GazeOffset {
    const now = this.clock ? this.clock() : elapsed;
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
      case 'idle':
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
