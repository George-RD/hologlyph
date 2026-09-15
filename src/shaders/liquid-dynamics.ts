/**
 * Head-owned liquid dynamics. No DOM, three.js or GPU work.
 *
 * A fixed-step damped height-field solver carries surface waves. Acceleration
 * of the travelling body drives those waves and the independent radial edge;
 * releasing a drag retains momentum. This is a reduced-order surface model,
 * not a volumetric or particle-fluid solver.
 */
import { LiquidBoundary } from './liquid-boundary';

export const LIQUID_RESOLUTION = 33;
export const LIQUID_STEP = 1 / 120;
export const LIQUID_MAX_FRAME = 0.1;
export const LIQUID_MAX_HEIGHT = 0.022;
export const LIQUID_THICKNESS = 0.12;
export const LIQUID_LAG = 0.55;

const SPEED = 1.2;
const DAMPING = 2.4;
const STEER_STIFFNESS = 36;
const STEER_DAMPING = 12;
const ACCEL_LIMIT = 8;
const DRAG = 2.6;
const WAVE_DRIVE = 0.012;
const EPSILON = 1e-5;
const N = LIQUID_RESOLUTION;
const CELL = 2 / (N - 1);

export type LiquidPoint = readonly [number, number];
export type LiquidPosition = readonly [number, number, number];

/**
 * Allowed carrier-origin positions in model-space X/Y, not CSS pixels.
 * Hosts must reserve space for the body's visible footprint. These limits
 * constrain placement, not arbitrary obstacles.
 */
export interface LiquidBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

const DEFAULT_BOUNDS: LiquidBounds = Object.freeze({ minX: -8, maxX: 8, minY: -8, maxY: 8 });

/** Reject invalid public coordinates before changing simulation state. */
function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}

/** Project a finite scalar into a closed interval, including a single point. */
function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * The unperturbed initial collapse has a positive unit Jacobian. Radial scale
 * compensates its vertical derivative and retains depth. The renderer adds
 * bounded waves and then hands over to an independent closed surface. This
 * reference invariant is not a volume-conservation claim for that handover.
 */
export function liquidProjection(
  position: LiquidPosition,
  minY: number,
  maxY: number,
  amount: number,
): LiquidPosition {
  const span = maxY - minY;
  if (!Number.isFinite(span) || !Number.isFinite(minY) || !(span > 0)
    || !Number.isFinite(amount) || amount <= 0) return position;
  const [x, y, z] = position;
  const h = clamp((y - minY) / span, 0, 1);
  const raw = clamp(amount, 0, 1) * (1 + LIQUID_LAG) - LIQUID_LAG * h;
  const q = clamp(raw, 0, 1);
  const progress = q * q * (3 - 2 * q);
  const slope = raw > 0 && raw < 1 && y >= minY && y <= maxY
    ? -6 * q * (1 - q) * LIQUID_LAG / span : 0;
  const vertical = 1 - (1 - LIQUID_THICKNESS) * progress;
  const derivative = vertical - (y - minY) * (1 - LIQUID_THICKNESS) * slope;
  const radial = 1 / Math.sqrt(Math.max(derivative, LIQUID_THICKNESS));
  return [x * radial, minY + (y - minY) * vertical, z * radial];
}

export class LiquidDynamics {
  readonly boundary = new LiquidBoundary();
  readonly heights = new Float64Array(N * N);
  readonly waveVelocity = new Float64Array(N * N);
  private readonly nextVelocity = new Float64Array(N * N);
  private readonly cells: number[] = [];
  private readonly neighbours = new Int32Array(N * N * 4).fill(-1);
  private readonly xs = new Float64Array(N * N);
  private readonly ys = new Float64Array(N * N);
  private readonly active = new Uint8Array(N * N);
  private readonly centre: [number, number] = [0, 0];
  private readonly speed: [number, number] = [0, 0];
  private placementBounds: LiquidBounds = DEFAULT_BOUNDS;
  private targetPoint: [number, number] | null = null;
  private accumulator = 0;
  private progress = 0;
  private progressVelocity = 0;
  private targetProgress = 0;
  private reduced = false;
  private dead = false;

  /** Build the fixed disc and reflecting wave neighbourhood once. */
  constructor() {
    for (let row = 0; row < N; row++) {
      for (let col = 0; col < N; col++) {
        const i = row * N + col;
        const x = col * CELL - 1;
        const y = row * CELL - 1;
        this.xs[i] = x;
        this.ys[i] = y;
        if (x * x + y * y <= 1 + 1e-12) {
          this.active[i] = 1;
          this.cells.push(i);
        }
      }
    }
    for (const i of this.cells) {
      const row = Math.floor(i / N);
      const col = i % N;
      const candidates = [col > 0 ? i - 1 : -1, col < N - 1 ? i + 1 : -1,
        row > 0 ? i - N : -1, row < N - 1 ? i + N : -1];
      for (let k = 0; k < 4; k++) {
        const j = candidates[k] ?? -1;
        this.neighbours[i * 4 + k] = j >= 0 && this.active[j] ? j : i;
      }
    }
  }

  /** Current eased head-to-liquid progress. */
  get amount(): number { return this.progress; }
  /** Requested head-to-liquid progress, before easing. */
  get targetAmount(): number { return this.targetProgress; }
  /** Current carrier-origin placement in model-space X/Y. */
  get position(): LiquidPoint { return this.centre; }
  /** Carrier velocity in model-space units per second. */
  get velocity(): LiquidPoint { return this.speed; }
  /** Steering is available only at the full-liquid endpoint. */
  get canSteer(): boolean { return this.progress >= 0.995 && this.targetProgress === 1; }
  /** Whether this solver has released its owned state. */
  get disposed(): boolean { return this.dead; }
  /** Immutable host-supplied carrier limits; defaults to [-8,8] on each axis. */
  get bounds(): LiquidBounds { return this.placementBounds; }

  /**
   * Replace placement limits atomically without advancing the simulation.
   * Resizing projects an escaped origin and clamps any held target immediately.
   * Contact removes outward velocity only; inward and tangential motion remain.
   * Equal endpoints pin an axis. Non-finite, reversed or overflowing spans throw.
   */
  setBounds(bounds: LiquidBounds): void {
    if (this.dead) return;
    const next = Object.freeze({
      minX: finite(bounds.minX, 'Liquid minimum x'),
      maxX: finite(bounds.maxX, 'Liquid maximum x'),
      minY: finite(bounds.minY, 'Liquid minimum y'),
      maxY: finite(bounds.maxY, 'Liquid maximum y'),
    });
    if (next.minX > next.maxX || next.minY > next.maxY
      || !Number.isFinite(next.maxX - next.minX) || !Number.isFinite(next.maxY - next.minY)) {
      throw new RangeError('Liquid bounds must have ordered finite spans');
    }
    this.placementBounds = next;
    if (this.targetPoint) {
      this.targetPoint[0] = clamp(this.targetPoint[0], next.minX, next.maxX);
      this.targetPoint[1] = clamp(this.targetPoint[1], next.minY, next.maxY);
    }
    this.constrainAxis(0);
    this.constrainAxis(1);
  }

  /** Project one carrier axis and cancel only velocity pointing out of bounds. */
  private constrainAxis(axis: number): void {
    const bounds = this.placementBounds;
    const low = axis === 0 ? bounds.minX : bounds.minY;
    const high = axis === 0 ? bounds.maxX : bounds.maxY;
    const position = clamp(this.centre[axis] ?? 0, low, high);
    const velocity = this.speed[axis] ?? 0;
    this.centre[axis] = position;
    if ((position <= low && velocity < 0) || (position >= high && velocity > 0)) {
      this.speed[axis] = 0;
    }
  }

  /** Request a continuous transition, or explicitly snap for a host-controlled pose. */
  setAmount(amount: number, immediate = false): void {
    if (this.dead) return;
    this.targetProgress = clamp(finite(amount, 'Liquid amount'), 0, 1);
    if (this.targetProgress !== 1) this.targetPoint = null;
    if (immediate || this.reduced) {
      this.progress = this.targetProgress;
      this.progressVelocity = 0;
      if (this.progress === 0) this.clearWaves();
    }
  }

  /** Body coordinates, not CSS pixels. Returns false until the body is liquid. */
  steerTo(x: number, y: number): boolean {
    finite(x, 'Liquid target x');
    finite(y, 'Liquid target y');
    if (this.dead || !this.canSteer) return false;
    const bounds = this.placementBounds;
    this.targetPoint = [clamp(x, bounds.minX, bounds.maxX), clamp(y, bounds.minY, bounds.maxY)];
    if (this.reduced) {
      this.centre[0] = this.targetPoint[0];
      this.centre[1] = this.targetPoint[1];
      this.speed[0] = 0;
      this.speed[1] = 0;
    }
    return true;
  }

  /** Drop the steering target while retaining bounded release momentum. */
  release(): void { this.targetPoint = null; }

  /** Disturb the local edge and height field without changing mean height. */
  impulse(x: number, y: number, strength = 1): void {
    finite(x, 'Impulse x');
    finite(y, 'Impulse y');
    finite(strength, 'Impulse strength');
    if (this.dead || this.reduced || this.progress < 0.5) return;
    x = clamp(x, -1, 1);
    y = clamp(y, -1, 1);
    this.boundary.impulse(x, y, strength);
    const gain = clamp(strength, -2, 2) * 0.045;
    let mean = 0;
    for (const i of this.cells) {
      const dx = (this.xs[i] ?? 0) - x;
      const dy = (this.ys[i] ?? 0) - y;
      const value = gain * Math.exp(-(dx * dx + dy * dy) / 0.08);
      this.nextVelocity[i] = value;
      mean += value;
    }
    mean /= this.cells.length;
    for (const i of this.cells) this.waveVelocity[i] = (this.waveVelocity[i] ?? 0)
      + (this.nextVelocity[i] ?? 0) - mean;
  }

  /** Remove automatic motion and waves while retaining explicit bounded placement. */
  setReducedMotion(reduced: boolean): void {
    if (this.dead) return;
    this.reduced = reduced;
    if (reduced) {
      this.progress = this.targetProgress;
      this.progressVelocity = 0;
      this.speed[0] = 0;
      this.speed[1] = 0;
      this.targetPoint = null;
      this.accumulator = 0;
      this.clearWaves();
    }
  }

  /** Consume bounded frame time on the single fixed-step VFX clock. */
  update(dt: number): void {
    if (this.dead || this.reduced || !Number.isFinite(dt) || dt <= 0) return;
    if (this.progress === 0 && this.targetProgress === 0
      && this.speed[0] === 0 && this.speed[1] === 0) return;
    // Hidden-tab time is deliberately dropped, never replayed as a large kick.
    this.accumulator += Math.min(dt, LIQUID_MAX_FRAME);
    let steps = 0;
    while (this.accumulator + 1e-10 >= LIQUID_STEP && steps < 12) {
      this.step();
      this.accumulator = Math.max(0, this.accumulator - LIQUID_STEP);
      steps++;
    }
  }

  /** Advance transition, constrained carrier, free edge and zero-mean waves once. */
  private step(): void {
    const dt = LIQUID_STEP;
    const omega = 10;
    const offset = this.progress - this.targetProgress;
    const joint = this.progressVelocity + omega * offset;
    const decay = Math.exp(-omega * dt);
    this.progress = clamp(this.targetProgress + (offset + joint * dt) * decay, 0, 1);
    this.progressVelocity = (this.progressVelocity - omega * joint * dt) * decay;
    if (Math.abs(this.progress - this.targetProgress) < EPSILON
      && Math.abs(this.progressVelocity) < EPSILON) {
      this.progress = this.targetProgress;
      this.progressVelocity = 0;
    }

    let ax = 0;
    let ay = 0;
    for (let axis = 0; axis < 2; axis++) {
      const position = this.centre[axis] ?? 0;
      const velocity = this.speed[axis] ?? 0;
      const desired = this.canSteer && this.targetPoint
        ? STEER_STIFFNESS * ((this.targetPoint[axis] ?? 0) - position) - STEER_DAMPING * velocity
        : -(this.targetProgress === 0 ? 9 : DRAG) * velocity;
      const acceleration = clamp(desired, -ACCEL_LIMIT, ACCEL_LIMIT);
      const nextSpeed = velocity + acceleration * dt;
      this.speed[axis] = Math.abs(nextSpeed) < EPSILON && !this.targetPoint ? 0 : nextSpeed;
      this.centre[axis] = position + (this.speed[axis] ?? 0) * dt;
      this.constrainAxis(axis);
      // Slosh follows actual bounded motion, including contact deceleration,
      // rather than a spring still pushing through a wall. Cap impact forcing.
      const actualAcceleration = clamp(((this.speed[axis] ?? 0) - velocity) / dt, -ACCEL_LIMIT, ACCEL_LIMIT);
      if (axis === 0) ax = actualAcceleration;
      else ay = actualAcceleration;
    }
    if (this.progress === 0) {
      this.clearWaves();
      return;
    }
    this.boundary.step(dt, ax, ay);

    const spring = SPEED * SPEED / (CELL * CELL);
    const friction = Math.exp(-DAMPING * dt);
    let meanVelocity = 0;
    for (const i of this.cells) {
      const h = this.heights[i] ?? 0;
      let laplacian = 0;
      for (let k = 0; k < 4; k++) {
        const j = this.neighbours[i * 4 + k] ?? i;
        laplacian += (this.heights[j] ?? h) - h;
      }
      const force = -WAVE_DRIVE * (ax * (this.xs[i] ?? 0) + ay * (this.ys[i] ?? 0));
      const velocity = ((this.waveVelocity[i] ?? 0) + (spring * laplacian + force) * dt) * friction;
      this.nextVelocity[i] = velocity;
      meanVelocity += velocity;
    }
    meanVelocity /= this.cells.length;
    let meanHeight = 0;
    let peak = 0;
    for (const i of this.cells) {
      this.waveVelocity[i] = (this.nextVelocity[i] ?? 0) - meanVelocity;
      this.heights[i] = (this.heights[i] ?? 0) + (this.waveVelocity[i] ?? 0) * dt;
      meanHeight += this.heights[i] ?? 0;
    }
    meanHeight /= this.cells.length;
    for (const i of this.cells) {
      this.heights[i] = (this.heights[i] ?? 0) - meanHeight;
      peak = Math.max(peak, Math.abs(this.heights[i] ?? 0));
    }
    // Scale the whole field, not individual cells, so the safety cap cannot
    // introduce a net volume change or a sharp clipped crest.
    if (peak > LIQUID_MAX_HEIGHT) {
      const scale = LIQUID_MAX_HEIGHT / peak;
      for (const i of this.cells) {
        this.heights[i] = (this.heights[i] ?? 0) * scale;
        this.waveVelocity[i] = (this.waveVelocity[i] ?? 0) * scale;
      }
    }
  }

  /** Signed mean-height integral; this does not measure the full mesh volume. */
  get volumeError(): number {
    let sum = 0;
    for (const i of this.cells) sum += this.heights[i] ?? 0;
    return sum * CELL * CELL;
  }

  /** Discrete wave energy used for damping and stability regressions. */
  get waveEnergy(): number {
    let energy = 0;
    for (const i of this.cells) {
      const velocity = this.waveVelocity[i] ?? 0;
      energy += velocity * velocity / 2;
      for (let k = 0; k < 4; k++) {
        const j = this.neighbours[i * 4 + k] ?? i;
        if (j <= i) continue;
        const difference = (this.heights[i] ?? 0) - (this.heights[j] ?? 0);
        energy += SPEED * SPEED * difference * difference / (2 * CELL * CELL);
      }
    }
    return energy * CELL * CELL;
  }

  /** RG stores one signed 16-bit height. RGBA8 filtering works on WebGL2. */
  writeTexture(bytes: Uint8Array): void {
    if (bytes.length !== N * N * 4) throw new RangeError('Liquid texture has the wrong size');
    for (let i = 0; i < N * N; i++) {
      const value = Math.round(32768 + clamp((this.heights[i] ?? 0) / LIQUID_MAX_HEIGHT, -1, 1) * 32767);
      bytes[i * 4] = value >>> 8;
      bytes[i * 4 + 1] = value & 255;
      bytes[i * 4 + 2] = 0;
      bytes[i * 4 + 3] = 255;
    }
  }

  /** Return waves and the free edge to exact rest without changing placement. */
  private clearWaves(): void {
    this.boundary.clear();
    this.heights.fill(0);
    this.waveVelocity.fill(0);
    this.nextVelocity.fill(0);
  }

  /** Release momentum and wave state idempotently; later updates are ignored. */
  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    this.targetPoint = null;
    this.speed[0] = 0;
    this.speed[1] = 0;
    this.clearWaves();
  }
}
