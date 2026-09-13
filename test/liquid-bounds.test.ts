import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { LiquidDynamics, type LiquidBounds } from '../src/shaders/liquid-dynamics';

const LAB_BOUNDS: LiquidBounds = { minX: -0.6, maxX: 0.6, minY: -0.2, maxY: 0.85 };

/** Create the lab's fully liquid body with solver-owned placement limits. */
function liquid(bounds: LiquidBounds = LAB_BOUNDS): LiquidDynamics {
  const body = new LiquidDynamics();
  body.setBounds(bounds);
  body.setAmount(1, true);
  return body;
}

/** Check every sample, not only the settled endpoint, for escaped momentum. */
function advance(body: LiquidDynamics, seconds: number, hz = 120): void {
  for (let i = 0; i < Math.round(seconds * hz); i++) {
    body.update(1 / hz);
    const [x, y] = body.position;
    assert(x >= body.bounds.minX && x <= body.bounds.maxX, `X escaped: ${x}`);
    assert(y >= body.bounds.minY && y <= body.bounds.maxY, `Y escaped: ${y}`);
  }
}

describe('solver-owned liquid placement bounds', () => {
  it('retains the default safety envelope until a host supplies bounds', () => {
    assert.deepEqual(new LiquidDynamics().bounds, { minX: -8, maxX: 8, minY: -8, maxY: 8 });
  });

  for (const [name, target] of [
    ['right', [0.6, 0]], ['left', [-0.6, 0]],
    ['top', [0, 0.85]], ['bottom', [0, -0.2]],
    ['top-right', [0.6, 0.85]], ['bottom-left', [-0.6, -0.2]],
  ] as const) {
    it(`contains released momentum at the ${name} boundary`, () => {
      const body = liquid();
      body.steerTo(target[0], target[1]);
      advance(body, 0.25);
      const before = [...body.position];
      body.release();
      advance(body, 4);
      const axis = target[0] === 0 ? 1 : 0;
      assert(Math.abs(body.position[axis]) > Math.abs(before[axis] ?? 0), 'Release must still travel');
      assert.equal(body.position[axis], target[axis]);
      assert.equal(body.velocity[axis], 0, 'Contact must cancel outward velocity');
    });
  }

  it('preserves tangential momentum at a wall', () => {
    const body = liquid({ ...LAB_BOUNDS, minY: -2, maxY: 2 });
    body.steerTo(0.6, 1);
    advance(body, 0.25);
    body.release();
    for (let i = 0; i < 240 && body.position[0] < 0.6; i++) advance(body, 1 / 120);
    assert.equal(body.position[0], 0.6);
    assert.equal(body.velocity[0], 0);
    assert(body.velocity[1] > 0.1, 'A vertical wall must not stop tangential travel');
  });

  it('does not trap the body at contact when steering reverses', () => {
    const body = liquid();
    body.steerTo(0.6, 0);
    advance(body, 0.25);
    body.release();
    advance(body, 3);
    body.steerTo(-0.6, 0);
    advance(body, 1 / 120);
    assert(body.position[0] < 0.6);
    assert(body.velocity[0] < 0);
  });

  it('reprojects placement and its target immediately when the host shrinks', () => {
    const body = liquid();
    body.steerTo(0.6, 0.85);
    advance(body, 0.25);
    const ySpeed = body.velocity[1];
    body.setBounds({ ...LAB_BOUNDS, maxX: 0.1 });
    assert.equal(body.position[0], 0.1);
    assert.equal(body.velocity[0], 0);
    assert.equal(body.velocity[1], ySpeed);
    advance(body, 2);
    assert.equal(body.position[0], 0.1);
    assert.equal(body.velocity[0], 0);
  });

  it('preserves inward velocity when a shrinking host reprojects the body', () => {
    const body = liquid();
    body.steerTo(0.6, 0);
    advance(body, 0.3);
    body.steerTo(-0.6, 0);
    advance(body, 0.25);
    assert(body.velocity[0] < 0);
    const inward = body.velocity[0];
    const maxX = body.position[0] - 0.01;
    body.setBounds({ ...LAB_BOUNDS, maxX });
    assert.equal(body.position[0], maxX);
    assert.equal(body.velocity[0], inward);
    advance(body, 1 / 120);
    assert(body.position[0] < maxX);
  });

  it('keeps an in-bounds position and momentum when bounds expand', () => {
    const body = liquid();
    body.steerTo(0.6, 0.85);
    advance(body, 0.25);
    const position = [...body.position];
    const velocity = [...body.velocity];
    body.setBounds({ minX: -2, maxX: 2, minY: -2, maxY: 2 });
    assert.deepEqual(body.position, position);
    assert.deepEqual(body.velocity, velocity);
  });

  it('contains motion during re-formation and transition interruptions', () => {
    const body = liquid();
    body.steerTo(0.6, 0.85);
    advance(body, 0.25);
    body.release();
    body.setAmount(0);
    advance(body, 0.1);
    body.setAmount(1);
    advance(body, 0.1);
    body.setAmount(0);
    advance(body, 4);
    assert.equal(body.amount, 0);
    assert(body.position[0] > 0);
    assert.equal(body.waveEnergy, 0);
  });

  it('applies bounds to residual motion even after an immediate return to head mode', () => {
    const body = liquid();
    body.steerTo(0.6, 0.85);
    advance(body, 0.25);
    body.setAmount(0, true);
    body.setBounds({ minX: -0.1, maxX: 0.1, minY: -0.1, maxY: 0.1 });
    advance(body, 3);
    assert.deepEqual(body.position, [0.1, 0.1]);
    assert.deepEqual(body.velocity, [0, 0]);
  });

  it('clamps explicit reduced-motion placement and never creates release momentum', () => {
    const body = liquid();
    body.setReducedMotion(true);
    body.steerTo(10, -10);
    assert.deepEqual(body.position, [0.6, -0.2]);
    body.release();
    advance(body, 2);
    assert.deepEqual(body.position, [0.6, -0.2]);
    assert.deepEqual(body.velocity, [0, 0]);
    assert.equal(body.waveEnergy, 0);
    body.setBounds({ ...LAB_BOUNDS, maxX: 0.2 });
    assert.deepEqual(body.position, [0.2, -0.2]);
  });

  it('supports a host outside the original default envelope', () => {
    const body = liquid({ minX: 10, maxX: 12, minY: 20, maxY: 22 });
    assert.deepEqual(body.position, [10, 20]);
    body.setReducedMotion(true);
    body.steerTo(100, -100);
    assert.deepEqual(body.position, [12, 20]);
  });

  it('allows a collapsed domain without accumulating impossible velocity', () => {
    const body = liquid({ minX: 0.2, maxX: 0.2, minY: -0.1, maxY: -0.1 });
    body.steerTo(10, 10);
    advance(body, 2);
    assert.deepEqual(body.position, [0.2, -0.1]);
    assert.deepEqual(body.velocity, [0, 0]);
  });

  it('defensively copies bounds and exposes an immutable snapshot', () => {
    const bounds = { ...LAB_BOUNDS };
    const body = liquid(bounds);
    bounds.maxX = 99;
    assert.equal(body.bounds.maxX, 0.6);
    assert(Object.isFrozen(body.bounds));
    assert.throws(() => Object.assign(body.bounds, { maxX: 99 }), TypeError);
  });

  for (const invalid of [
    { ...LAB_BOUNDS, minX: Number.NaN },
    { ...LAB_BOUNDS, maxX: Number.POSITIVE_INFINITY },
    { ...LAB_BOUNDS, minY: Number.NEGATIVE_INFINITY },
    { ...LAB_BOUNDS, maxY: Number.NaN },
    { ...LAB_BOUNDS, minX: 1 },
    { ...LAB_BOUNDS, maxY: -1 },
    { ...LAB_BOUNDS, minX: -Number.MAX_VALUE, maxX: Number.MAX_VALUE },
  ]) {
    it(`rejects invalid bounds atomically: ${Object.values(invalid).join(',')}`, () => {
      const body = liquid();
      body.steerTo(0.6, 0.85);
      advance(body, 0.25);
      const bounds = body.bounds;
      const position = [...body.position];
      const velocity = [...body.velocity];
      assert.throws(() => body.setBounds(invalid), RangeError);
      assert.equal(body.bounds, bounds);
      assert.deepEqual(body.position, position);
      assert.deepEqual(body.velocity, velocity);
    });
  }

  it('produces identical contact and wave states at 30, 60 and 120 Hz', () => {
    const bodies = [30, 60, 120].map(hz => {
      const body = liquid();
      body.steerTo(0.6, 0.85);
      advance(body, 0.3, hz);
      body.release();
      advance(body, 2, hz);
      return body;
    });
    const first = bodies[0];
    assert(first);
    for (const body of bodies.slice(1)) {
      assert.deepEqual(body.position, first.position);
      assert.deepEqual(body.velocity, first.velocity);
      assert.deepEqual(body.heights, first.heights);
    }
  });

  it('keeps contact-driven waves finite, bounded and zero-mean', () => {
    const body = liquid();
    for (let i = 0; i < 600; i++) {
      body.steerTo(Math.sin(i / 10) * 10, Math.cos(i / 12) * 10);
      if (i % 3 === 0) body.release();
      advance(body, 1 / 60);
    }
    assert([...body.heights, ...body.waveVelocity].every(Number.isFinite));
    assert(Math.abs(body.volumeError) < 1e-12);
    assert(Math.max(...body.heights.map(Math.abs)) <= 0.022 + 1e-12);
  });

  it('updates host bounds without advancing the simulation clock', () => {
    const body = new LiquidDynamics();
    body.setAmount(1);
    body.update(0.1);
    const amount = body.amount;
    const heights = [...body.heights];
    body.setBounds(LAB_BOUNDS);
    assert.equal(body.amount, amount);
    assert.deepEqual([...body.heights], heights);
  });

  it('ignores bounds changes after disposal', () => {
    const body = liquid();
    const bounds = body.bounds;
    body.dispose();
    body.setBounds({ minX: 2, maxX: 3, minY: 2, maxY: 3 });
    assert.equal(body.bounds, bounds);
    assert.deepEqual(body.position, [0, 0]);
  });
});
