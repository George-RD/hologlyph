import { describe, expect, it } from 'vitest';
import {
  LIQUID_MAX_HEIGHT, LIQUID_RESOLUTION, LIQUID_THICKNESS,
  LiquidDynamics, liquidProjection,
} from '../src/shaders/liquid-dynamics';

function advance(body: LiquidDynamics, seconds: number, hz = 60): void {
  for (let i = 0; i < Math.round(seconds * hz); i++) body.update(1 / hz);
}

function liquid(): LiquidDynamics {
  const body = new LiquidDynamics();
  body.setAmount(1, true);
  return body;
}

describe('head-owned liquid dynamics', () => {
  it('has exact rest, and does not steer the speaking head', () => {
    const body = new LiquidDynamics();
    advance(body, 20);
    expect(body.amount).toBe(0);
    expect(body.waveEnergy).toBe(0);
    expect(body.steerTo(1, 0)).toBe(false);
    expect(body.position).toEqual([0, 0]);
  });

  it('produces travelling waves from an impulse without changing mean volume', () => {
    const body = liquid();
    body.impulse(0.6, 0.2);
    advance(body, 0.4);
    expect(body.waveEnergy).toBeGreaterThan(1e-7);
    expect(Math.abs(body.volumeError)).toBeLessThan(1e-12);
    expect(Math.max(...body.heights)).toBeGreaterThan(0);
    expect(Math.min(...body.heights)).toBeLessThan(0);
    const energy = body.waveEnergy;
    advance(body, 12);
    expect(body.waveEnergy).toBeLessThan(energy * 1e-6);
  });

  it('couples steering acceleration to slosh and retains release momentum', () => {
    const body = liquid();
    expect(body.steerTo(1, 0.4)).toBe(true);
    advance(body, 0.25);
    expect(body.position[0]).toBeGreaterThan(0);
    expect(body.waveEnergy).toBeGreaterThan(1e-7);
    const before = body.position[0];
    body.release();
    advance(body, 0.2);
    expect(body.position[0]).toBeGreaterThan(before);
    advance(body, 10);
    expect(Math.hypot(...body.velocity)).toBeLessThan(1e-4);
  });

  it('reforms where it travelled, rather than teleporting to the origin', () => {
    const body = liquid();
    body.steerTo(1, 0.5);
    advance(body, 4);
    body.release();
    const position = [...body.position];
    body.setAmount(0);
    advance(body, 3);
    expect(body.amount).toBe(0);
    expect(body.position[0]).toBeCloseTo(position[0] ?? 0, 3);
    expect(body.position[1]).toBeCloseTo(position[1] ?? 0, 3);
    expect(body.waveEnergy).toBe(0);
  });

  it('reverses a transition without a position or amount discontinuity', () => {
    const body = new LiquidDynamics();
    body.setAmount(1);
    advance(body, 0.15);
    const progress = body.amount;
    body.setAmount(0);
    expect(body.amount).toBe(progress);
    advance(body, 3);
    expect(body.amount).toBe(0);
  });

  it('is equivalent at 30, 60 and 120 Hz', () => {
    const bodies = [30, 60, 120].map((hz) => {
      const body = liquid();
      body.impulse(0.25, 0.25);
      body.steerTo(1, -0.3);
      advance(body, 2, hz);
      return body;
    });
    const baseline = bodies[0];
    if (!baseline) throw new Error('Missing baseline');
    for (const body of bodies.slice(1)) {
      expect(body.position).toEqual(baseline.position);
      expect(body.heights).toEqual(baseline.heights);
    }
  });

  it('drops hidden-tab time and ignores invalid deltas', () => {
    const a = liquid();
    const b = liquid();
    a.impulse(0, 0); b.impulse(0, 0);
    a.update(60); b.update(0.1);
    expect(a.heights).toEqual(b.heights);
    const previous = [...a.heights];
    for (const dt of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) a.update(dt);
    expect([...a.heights]).toEqual(previous);
    expect(() => a.steerTo(Number.NaN, 0)).toThrow(RangeError);
    expect(() => a.setAmount(Number.NaN)).toThrow(RangeError);
    expect(() => a.impulse(0, 0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('keeps repeated forcing bounded and zero-mean', () => {
    const body = liquid();
    for (let i = 0; i < 180; i++) {
      body.impulse(Math.sin(i), Math.cos(i), 2);
      body.steerTo(Math.sin(i / 12) * 2, Math.cos(i / 12));
      body.update(1 / 60);
    }
    expect([...body.heights, ...body.waveVelocity].every(Number.isFinite)).toBe(true);
    expect(Math.max(...body.heights.map(Math.abs))).toBeLessThanOrEqual(LIQUID_MAX_HEIGHT + 1e-12);
    expect(Math.abs(body.volumeError)).toBeLessThan(1e-12);
  });

  it('honours reduced motion without removing explicit placement controls', () => {
    const body = liquid();
    body.impulse(0, 0);
    advance(body, 0.1);
    body.setReducedMotion(true);
    expect(body.waveEnergy).toBe(0);
    body.steerTo(0.6, -0.2);
    expect(body.position).toEqual([0.6, -0.2]);
    expect(body.velocity).toEqual([0, 0]);
    body.setAmount(0);
    expect(body.amount).toBe(0);
  });

  it('packs exact rest as signed RG16 and releases state idempotently', () => {
    const body = liquid();
    const bytes = new Uint8Array(LIQUID_RESOLUTION ** 2 * 4);
    body.writeTexture(bytes);
    expect([...bytes.slice(0, 4)]).toEqual([128, 0, 0, 255]);
    expect(() => body.writeTexture(new Uint8Array(4))).toThrow(RangeError);
    body.dispose(); body.dispose(); body.update(1); body.setAmount(0);
    expect(body.disposed).toBe(true);
    expect(body.waveEnergy).toBe(0);
    expect(body.steerTo(1, 1)).toBe(false);
  });
});

describe('finite-depth liquid projection', () => {
  it('is exactly the identity at zero or with an unusable extent', () => {
    const point = [0.1, 0.7, 0.2] as const;
    expect(liquidProjection(point, 0, 1, 0)).toBe(point);
    expect(liquidProjection(point, 1, 1, 0.8)).toBe(point);
    expect(liquidProjection(point, Number.NaN, 1, 0.8)).toBe(point);
  });

  it('keeps depth and volume at the full-liquid endpoint', () => {
    const low = liquidProjection([0.2, 0.2, 0.1], 0, 1, 1);
    const high = liquidProjection([0.2, 0.9, 0.1], 0, 1, 1);
    expect(high[1] - low[1]).toBeCloseTo(0.7 * LIQUID_THICKNESS, 12);
    expect((low[0] / 0.2) ** 2 * LIQUID_THICKNESS).toBeCloseTo(1, 12);
  });

  it('has a positive unit Jacobian through the uninterrupted reference map', () => {
    const epsilon = 1e-6;
    for (const amount of [0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
      for (const y of [0.13, 0.31, 0.59, 0.83]) {
        const p = liquidProjection([0.2, y, 0.1], 0, 1, amount);
        const py = liquidProjection([0.2, y + epsilon, 0.1], 0, 1, amount);
        const dy = (py[1] - p[1]) / epsilon;
        expect(dy).toBeGreaterThan(0);
        expect((p[0] / 0.2) ** 2 * dy).toBeCloseTo(1, 4);
      }
    }
  });
});
