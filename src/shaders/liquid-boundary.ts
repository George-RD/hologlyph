/**
 * Reduced-order connected liquid boundary. No avatar, DOM, renderer or timer.
 * The existing liquid fixed step owns all calls to step(). This describes a
 * moving surface-tension outline, not a volumetric Navier-Stokes solver.
 */
export const LIQUID_BOUNDARY_RADIUS = 0.7;
export const LIQUID_BOUNDARY_LIMIT = 0.22;
export type LiquidBoundaryModes = readonly [number, number, number, number];

/** Four damped angular modes, with an exact planar-area normalisation. */
export class LiquidBoundary {
  private readonly shape: [number, number, number, number] = [0, 0, 0, 0];
  private readonly speed: [number, number, number, number] = [0, 0, 0, 0];

  /** Cosine/sine pairs for angular orders two and three. */
  get modes(): LiquidBoundaryModes { return this.shape; }

  /** The mean squared radial factor is one after applying this scale. */
  get areaScale(): number {
    let squares = 0;
    for (const value of this.shape) squares += value * value;
    return 1 / Math.sqrt(1 + 0.5 * squares);
  }

  /** Dimensionless radial factor, independent of any anatomical source mesh. */
  radius(angle: number): number {
    if (!Number.isFinite(angle)) throw new RangeError('Liquid angle must be finite');
    const [a, b, c, d] = this.shape;
    return (1 + a * Math.cos(2 * angle) + b * Math.sin(2 * angle)
      + c * Math.cos(3 * angle) + d * Math.sin(3 * angle)) * this.areaScale;
  }

  /**
   * Advance once from the owner's fixed step. Actual contact acceleration,
   * rather than an unclamped target, drives the outline. Invalid or oversized
   * steps are ignored, so this cannot replay hidden-tab time as a large kick.
   */
  step(dt: number, ax: number, ay: number): void {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 1 / 60
      || !Number.isFinite(ax) || !Number.isFinite(ay)) return;
    ax = Math.max(-8, Math.min(8, ax));
    ay = Math.max(-8, Math.min(8, ay));
    const forces = [1.8 * ax, 1.8 * ay, -1.1 * ax, -1.1 * ay];
    const damping = Math.exp(-3.8 * dt);
    let magnitude = 0;
    let peakSpeed = 0;
    for (let i = 0; i < 4; i++) {
      const frequency = i < 2 ? 7 : 10;
      const shape = this.shape[i] ?? 0;
      const velocity = ((this.speed[i] ?? 0)
        + ((forces[i] ?? 0) - frequency * frequency * shape) * dt) * damping;
      this.speed[i] = velocity;
      this.shape[i] = shape + velocity * dt;
      magnitude += Math.abs(this.shape[i] ?? 0);
      peakSpeed = Math.max(peakSpeed, Math.abs(velocity));
    }
    // A global scale retains a smooth closed outline. Since the L1 norm of
    // the modes is below one, no angle can acquire a zero or negative radius.
    if (magnitude > LIQUID_BOUNDARY_LIMIT) {
      const scale = LIQUID_BOUNDARY_LIMIT / magnitude;
      for (let i = 0; i < 4; i++) {
        this.shape[i] = (this.shape[i] ?? 0) * scale;
        this.speed[i] = (this.speed[i] ?? 0) * scale;
      }
    } else if (magnitude < 1e-8 && peakSpeed < 1e-8 && ax === 0 && ay === 0) {
      this.clear();
    }
  }

  /** Add an angular disturbance; the next owning fixed step advances it. */
  impulse(x: number, y: number, strength: number): void {
    if (![x, y, strength].every(Number.isFinite)) return;
    const angle = Math.atan2(y, x);
    const gain = Math.max(-2, Math.min(2, strength)) * 0.7;
    const directions = [Math.cos(2 * angle), Math.sin(2 * angle),
      0.55 * Math.cos(3 * angle), 0.55 * Math.sin(3 * angle)];
    for (let i = 0; i < 4; i++) {
      this.speed[i] = Math.max(-4, Math.min(4,
        (this.speed[i] ?? 0) + gain * (directions[i] ?? 0)));
    }
  }

  /** Exact rest for head mode, reduced motion and disposal. */
  clear(): void {
    this.shape.fill(0);
    this.speed.fill(0);
  }
}
