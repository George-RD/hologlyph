import { describe, expect, it } from 'vitest';
import { LiquidDynamics } from '../src/shaders/liquid-dynamics';

type BoundaryBody = LiquidDynamics & {
  readonly boundary: {
    readonly modes: readonly number[];
    readonly areaScale: number;
    radius(angle: number): number;
  };
};

/** Drive the real fixed-step owner, not a test-only boundary clock. */
function advance(body: LiquidDynamics, seconds: number, hz = 60): void {
  for (let i = 0; i < Math.round(seconds * hz); i++) body.update(1 / hz);
}

/** Read the moving outline through the production dynamics object. */
function outline(body: LiquidDynamics): BoundaryBody['boundary'] {
  const boundary = (body as BoundaryBody).boundary;
  expect(boundary, 'the liquid needs an outline independent of the head mesh').toBeDefined();
  return boundary;
}

describe('independent liquid boundary', () => {
  it('has an anatomy-independent circular rest outline', () => {
    const body = new LiquidDynamics();
    const boundary = outline(body);
    for (let i = 0; i < 64; i++) expect(boundary.radius(i * Math.PI / 32)).toBeCloseTo(1, 12);
    expect(boundary.modes).toEqual([0, 0, 0, 0]);
  });

  it('changes its silhouette under actual steering and keeps moving after release', () => {
    const body = new LiquidDynamics();
    body.setAmount(1, true);
    const boundary = outline(body);
    body.steerTo(0.6, 0.5);
    advance(body, 0.25);
    expect(Math.max(...boundary.modes.map(Math.abs))).toBeGreaterThan(0.005);
    const released = [...boundary.modes];
    body.release();
    advance(body, 0.1);
    expect(boundary.modes).not.toEqual(released);
    expect(Math.max(...boundary.modes.map(Math.abs))).toBeGreaterThan(0.001);
  });

  it('uses the same fixed steps at 60 and 120 Hz', () => {
    const a = new LiquidDynamics();
    const b = new LiquidDynamics();
    for (const body of [a, b]) { body.setAmount(1, true); body.steerTo(0.5, 0.3); }
    advance(a, 2, 60); advance(b, 2, 120);
    expect(outline(a).modes).toEqual(outline(b).modes);
  });
});
