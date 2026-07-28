import { describe, expect, it } from 'vitest';
import {
  MELT_FLOOR,
  MELT_LAG,
  MELT_SPREAD,
  meltCollapse,
  meltHeight,
  meltNormal,
  meltProgress,
  type MeltVec3,
} from '../src/shaders/melt';

// The shipped bust's bind extent, near enough: the base sits below the origin
// and the crown a little above 1.7.
const MIN_Y = -0.35;
const MAX_Y = 1.72;
const EXTENT = MAX_Y - MIN_Y;

const HEIGHTS = [MIN_Y, -0.2, 0, 0.4, 0.9, 1.3, 1.6, MAX_Y];

function unit(v: MeltVec3): MeltVec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

describe('meltHeight', () => {
  it('is 0 at the base and 1 at the crown', () => {
    expect(meltHeight(MIN_Y, MIN_Y, MAX_Y)).toBe(0);
    expect(meltHeight(MAX_Y, MIN_Y, MAX_Y)).toBe(1);
  });

  it('saturates outside the extent rather than extrapolating', () => {
    expect(meltHeight(MIN_Y - 5, MIN_Y, MAX_Y)).toBe(0);
    expect(meltHeight(MAX_Y + 5, MIN_Y, MAX_Y)).toBe(1);
  });

  it('is 0 for a degenerate extent instead of dividing by zero', () => {
    expect(meltHeight(1, 2, 2)).toBe(0);
  });
});

describe('meltProgress', () => {
  it('is monotonic in amount', () => {
    for (const h of [0, 0.25, 0.5, 0.75, 1]) {
      let previous = -1;
      for (let amount = 0; amount <= 1.0001; amount += 0.05) {
        const value = meltProgress(amount, h, MELT_LAG);
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
  });

  it('runs ahead at the base of a mid melt, which is the base-melts-first claim', () => {
    const base = meltProgress(0.5, 0, MELT_LAG);
    const crown = meltProgress(0.5, 1, MELT_LAG);
    expect(base).toBeGreaterThan(crown);
  });

  it('melts every height uniformly at lag 0', () => {
    expect(meltProgress(0.5, 0, 0)).toBe(meltProgress(0.5, 1, 0));
  });

  it('saturates every height at amount 1', () => {
    for (const h of [0, 0.5, 1]) {
      expect(meltProgress(1, h, MELT_LAG)).toBe(1);
    }
  });
});

describe('meltCollapse', () => {
  it('is an exact identity at amount 0', () => {
    for (const y of HEIGHTS) {
      const out = meltCollapse(y, MIN_Y, MAX_Y, 0, MELT_LAG, MELT_FLOOR, MELT_SPREAD);
      expect(out.y).toBe(y);
      expect(out.scale).toBe(1);
    }
  });

  it('collapses every height to within the floor at amount 1', () => {
    const puddleTop = MIN_Y + MELT_FLOOR * EXTENT;
    for (const y of HEIGHTS) {
      const out = meltCollapse(y, MIN_Y, MAX_Y, 1, MELT_LAG, MELT_FLOOR, MELT_SPREAD);
      expect(out.y).toBeCloseTo(puddleTop, 10);
      expect(out.y - MIN_Y).toBeLessThanOrEqual(MELT_FLOOR * EXTENT + 1e-9);
    }
  });

  it('spreads the crown wider than the base', () => {
    const base = meltCollapse(MIN_Y, MIN_Y, MAX_Y, 1, MELT_LAG, MELT_FLOOR, MELT_SPREAD);
    const crown = meltCollapse(MAX_Y, MIN_Y, MAX_Y, 1, MELT_LAG, MELT_FLOOR, MELT_SPREAD);
    expect(base.scale).toBe(1);
    expect(crown.scale).toBeCloseTo(1 + MELT_SPREAD, 10);
  });

  // Every height converges on the same puddle plane, so a vertex above it only
  // ever falls and a vertex below it only ever rises. The bust's very base sits
  // below `minY + floor * H`, so "always falls" would be the wrong invariant.
  it('moves every vertex monotonically toward the puddle plane', () => {
    const plane = MIN_Y + MELT_FLOOR * EXTENT;
    for (const y of HEIGHTS) {
      let previous = Math.abs(y - plane);
      for (const amount of [0.1, 0.35, 0.6, 0.85, 1]) {
        const out = meltCollapse(y, MIN_Y, MAX_Y, amount, MELT_LAG, MELT_FLOOR, MELT_SPREAD);
        const gap = Math.abs(out.y - plane);
        expect(gap).toBeLessThanOrEqual(previous + 1e-12);
        previous = gap;
      }
      expect(previous).toBeCloseTo(0, 10);
    }
  });

  it('passes a degenerate extent through untouched', () => {
    const out = meltCollapse(1, 2, 2, 1, MELT_LAG, MELT_FLOOR, MELT_SPREAD);
    expect(out.y).toBe(1);
    expect(out.scale).toBe(1);
  });
});

describe('meltNormal', () => {
  const NORMALS: MeltVec3[] = [
    [0, 0, 1],
    [1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    unit([0.4, 0.7, -0.6]),
  ];

  it('returns the input normal exactly at amount 0', () => {
    for (const y of HEIGHTS) {
      for (const n of NORMALS) {
        const out = meltNormal(
          [0.12, y, -0.08],
          n,
          MIN_Y,
          MAX_Y,
          0,
          MELT_LAG,
          MELT_FLOOR,
          MELT_SPREAD,
        );
        expect(out[0]).toBe(n[0]);
        expect(out[1]).toBe(n[1]);
        expect(out[2]).toBe(n[2]);
      }
    }
  });

  // The g' -> 0 guard. At full melt the vertical Jacobian reaches exactly 0,
  // and an unguarded divide sends an infinity into the fresnel and collapses
  // the silhouette.
  it('is finite and unit length at full melt, at the crown, the base and on the axis', () => {
    const positions: MeltVec3[] = [
      [0.09, MAX_Y, 0.02], // crown
      [0.2, MIN_Y, 0.15], // base
      [0, 0.8, 0], // on the axis, where x and z are both 0
      [0, MAX_Y, 0], // the crown pole
    ];
    for (const p of positions) {
      for (const n of NORMALS) {
        const out = meltNormal(p, n, MIN_Y, MAX_Y, 1, MELT_LAG, MELT_FLOOR, MELT_SPREAD);
        for (const component of out) expect(Number.isFinite(component)).toBe(true);
        expect(Math.hypot(out[0], out[1], out[2])).toBeCloseTo(1, 10);
      }
    }
  });

  it('is finite and unit length across the whole sweep', () => {
    for (let amount = 0; amount <= 1.0001; amount += 0.02) {
      for (const y of HEIGHTS) {
        const out = meltNormal(
          [0.18, y, -0.11],
          unit([0.3, 0.5, 0.81]),
          MIN_Y,
          MAX_Y,
          amount,
          MELT_LAG,
          MELT_FLOOR,
          MELT_SPREAD,
        );
        for (const component of out) expect(Number.isFinite(component)).toBe(true);
        expect(Math.hypot(out[0], out[1], out[2])).toBeCloseTo(1, 10);
      }
    }
  });

  // A pole-facing normal on the axis has nothing to shear against, so the melt
  // can only rescale it, and a rescaled unit axis vector is itself.
  it('leaves an axial normal on the axis pointing along the axis', () => {
    const out = meltNormal([0, 0.9, 0], [0, 1, 0], MIN_Y, MAX_Y, 0.5, MELT_LAG, MELT_FLOOR, MELT_SPREAD);
    expect(out[0]).toBe(0);
    expect(out[2]).toBe(0);
    expect(out[1]).toBeCloseTo(1, 12);
  });

  // Flattening squashes a side-facing surface toward horizontal, so its normal
  // must tip toward vertical rather than staying put.
  it('tips a side-facing normal upward as the melt progresses', () => {
    const rest = meltNormal([0.3, 1.2, 0], [1, 0, 0], MIN_Y, MAX_Y, 0, MELT_LAG, MELT_FLOOR, MELT_SPREAD);
    const melting = meltNormal([0.3, 1.2, 0], [1, 0, 0], MIN_Y, MAX_Y, 0.4, MELT_LAG, MELT_FLOOR, MELT_SPREAD);
    expect(rest[1]).toBe(0);
    expect(Math.abs(melting[1])).toBeGreaterThan(0);
  });

  it('passes a degenerate extent through untouched', () => {
    const n: MeltVec3 = [0, 0, 1];
    expect(meltNormal([1, 1, 1], n, 2, 2, 1, MELT_LAG, MELT_FLOOR, MELT_SPREAD)).toBe(n);
  });
});
