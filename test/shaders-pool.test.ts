import { describe, expect, it } from 'vitest';
import {
  EMERGENCE_DRIVE_SCALE,
  MAX_SIM_STEPS,
  POOL_RESOLUTION,
  REDUCED_DRIVE,
  RIPPLE_TAU,
  SCROLL_DRIVE_SCALE,
  SIM_HZ,
  WAVE_DAMPING,
  WAVE_SPEED,
  poolContactRing,
  poolImpulseDecay,
  poolMeniscusLift,
  poolProfileRadiusAt,
  poolRadialProfile,
  poolRippleDrive,
  poolSimulationSteps,
  poolWaterlineRadius,
  poolWaveStep,
} from '../src/shaders/pool';

/**
 * Reference 2D field driven by exactly the update `poolWaveStep` defines, so
 * the stability bound the shader relies on is asserted rather than assumed.
 * Edges are pinned to zero, which is what `pool-surface.ts` does to stop the
 * wave reflecting into a standing pattern.
 */
function iterate(n: number, steps: number, seed: (x: number, y: number) => number) {
  let cur = new Float64Array(n * n);
  let prev = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = seed(x, y);
      cur[y * n + x] = v;
      prev[y * n + x] = v;
    }
  }
  const next = () => {
    const out = new Float64Array(n * n);
    for (let y = 1; y < n - 1; y++) {
      for (let x = 1; x < n - 1; x++) {
        const i = y * n + x;
        const h = cur[i] as number;
        const lap =
          (cur[i - n] as number) +
          (cur[i + n] as number) +
          (cur[i - 1] as number) +
          (cur[i + 1] as number) -
          4 * h;
        out[i] = poolWaveStep(h, prev[i] as number, lap);
      }
    }
    prev = cur;
    cur = out;
  };
  for (let s = 0; s < steps; s++) next();
  let peak = 0;
  let energy = 0;
  for (let i = 0; i < cur.length; i++) {
    const v = cur[i] as number;
    if (!Number.isFinite(v)) return { peak: Number.NaN, energy: Number.NaN };
    const a = Math.abs(v);
    if (a > peak) peak = a;
    energy += v * v;
  }
  return { peak, energy };
}

describe('pool wave update', () => {
  it('stays within the CFL bound for the five-point stencil', () => {
    // Explicit second-order wave with a five-point Laplacian is stable while
    // c^2 <= 0.5 in two dimensions. If someone raises WAVE_SPEED past that the
    // field diverges silently on the GPU, so pin it here.
    expect(WAVE_SPEED * WAVE_SPEED).toBeLessThanOrEqual(0.5);
  });

  it('decays a central impulse to a finite, smaller field over a thousand steps', () => {
    const n = 48;
    const seed = (x: number, y: number) => (x === 24 && y === 24 ? 1 : 0);
    const short = iterate(n, 8, seed);
    const long = iterate(n, 1000, seed);
    expect(Number.isFinite(long.peak)).toBe(true);
    expect(long.peak).toBeLessThan(short.peak);
    expect(long.energy).toBeLessThan(short.energy);
  });

  it('conserves a flat field exactly, so the resting surface cannot drift', () => {
    const flat = iterate(16, 200, () => 0);
    expect(flat.peak).toBe(0);
  });

  it('is a plain damped second-order update', () => {
    // h + velocity * (1 - damping) + c^2 * laplacian, spelled out so a
    // refactor of the shader has a number to match rather than a shape.
    const h = 0.4;
    const hPrev = 0.1;
    const lap = -0.2;
    expect(poolWaveStep(h, hPrev, lap)).toBeCloseTo(
      h + (h - hPrev) * (1 - WAVE_DAMPING) + WAVE_SPEED * WAVE_SPEED * lap,
      12,
    );
  });
});

describe('simulation stepping', () => {
  it('runs the fixed rate for an ordinary frame', () => {
    expect(poolSimulationSteps(1 / 60)).toBe(1);
    expect(poolSimulationSteps(1 / 30)).toBe(2);
  });

  it('caps a long frame rather than replaying the whole gap', () => {
    // A backgrounded tab hands back a multi-second dt; without the cap that
    // one frame runs hundreds of steps and stalls worse than the lost time.
    expect(poolSimulationSteps(5)).toBe(MAX_SIM_STEPS);
    expect(MAX_SIM_STEPS).toBeLessThan(5 * SIM_HZ);
  });

  it('treats a zero, negative or non-finite frame as no steps', () => {
    expect(poolSimulationSteps(0)).toBe(0);
    expect(poolSimulationSteps(-1)).toBe(0);
    expect(poolSimulationSteps(Number.NaN)).toBe(0);
  });
});

describe('ripple drive', () => {
  it('is sign-free in both inputs', () => {
    expect(poolRippleDrive(-0.5, 0)).toBeCloseTo(poolRippleDrive(0.5, 0), 12);
    expect(poolRippleDrive(0, -0.5)).toBeCloseTo(poolRippleDrive(0, 0.5), 12);
  });

  it('saturates at one rather than summing past it', () => {
    expect(poolRippleDrive(100, 100)).toBe(1);
  });

  it('scales each input by its own saturation speed', () => {
    expect(poolRippleDrive(SCROLL_DRIVE_SCALE, 0)).toBeCloseTo(1, 12);
    expect(poolRippleDrive(0, EMERGENCE_DRIVE_SCALE)).toBeCloseTo(1, 12);
  });

  it('damps rather than disables under reduced motion', () => {
    const full = poolRippleDrive(1, 0);
    const damped = poolRippleDrive(1, 0, true);
    expect(damped).toBeGreaterThan(0);
    expect(damped).toBeCloseTo(full * REDUCED_DRIVE, 12);
  });

  it('is still zero under reduced motion when nothing is moving', () => {
    expect(poolRippleDrive(0, 0, true)).toBe(0);
  });
});

describe('impulse decay', () => {
  it('follows the exponential over one time constant', () => {
    expect(poolImpulseDecay(1, RIPPLE_TAU)).toBeCloseTo(Math.exp(-1), 12);
  });

  it('latches to exactly zero so a dead impulse stops costing a step', () => {
    expect(poolImpulseDecay(1, RIPPLE_TAU * 20)).toBe(0);
    expect(poolImpulseDecay(0, 0.016)).toBe(0);
  });

  it('holds the amplitude across a zero or non-finite frame', () => {
    expect(poolImpulseDecay(0.5, 0)).toBe(0.5);
    expect(poolImpulseDecay(0.5, Number.NaN)).toBe(0.5);
  });
});

describe('radial profile', () => {
  const cylinder = (radius: number, y0: number, y1: number, rings = 8, spokes = 16) => {
    const out: number[] = [];
    for (let r = 0; r <= rings; r++) {
      const y = y0 + ((y1 - y0) * r) / rings;
      for (let s = 0; s < spokes; s++) {
        const a = (s / spokes) * Math.PI * 2;
        out.push(Math.cos(a) * radius, y, Math.sin(a) * radius);
      }
    }
    return out;
  };

  it('recovers a constant radius from a cylinder', () => {
    const profile = poolRadialProfile(cylinder(0.5, 0, 2), 16);
    expect(profile.minY).toBeCloseTo(0, 6);
    expect(profile.maxY).toBeCloseTo(2, 6);
    for (const r of profile.radii) expect(r).toBeCloseTo(0.5, 5);
  });

  it('tracks a waist, which is the whole reason the pool measures the rig', () => {
    // Wide base, narrow neck, wide head: a bust. The hole in the water has to
    // pinch as the neck crosses, or the meniscus rings the wrong contour.
    const positions = [
      ...cylinder(0.6, 0, 0.6),
      ...cylinder(0.15, 0.6, 1.0),
      ...cylinder(0.5, 1.0, 1.8),
    ];
    const profile = poolRadialProfile(positions, 36);
    expect(poolProfileRadiusAt(profile, 0.3)).toBeGreaterThan(0.5);
    expect(poolProfileRadiusAt(profile, 0.8)).toBeLessThan(0.3);
    expect(poolProfileRadiusAt(profile, 1.4)).toBeGreaterThan(0.4);
  });

  it('clamps outside the sampled span instead of extrapolating to zero', () => {
    const profile = poolRadialProfile(cylinder(0.5, 0, 2), 16);
    expect(poolProfileRadiusAt(profile, -5)).toBeCloseTo(0.5, 5);
    expect(poolProfileRadiusAt(profile, 5)).toBeCloseTo(0.5, 5);
  });

  it('carries the last populated radius through an empty slice', () => {
    // Two rings with a gap between them: the slices in the gap would read zero
    // and punch a hole in the contour.
    const positions = [...cylinder(0.4, 0, 0.05, 1), ...cylinder(0.4, 1.95, 2, 1)];
    const profile = poolRadialProfile(positions, 32);
    for (const r of profile.radii) expect(r).toBeGreaterThan(0);
  });

  it('degrades rather than throwing on empty or flat input', () => {
    const empty = poolRadialProfile([], 16);
    expect(empty.radii.length).toBe(1);
    expect(poolProfileRadiusAt(empty, 0)).toBe(0);

    const slab = poolRadialProfile([0.3, 1, 0.4, -0.3, 1, -0.4], 16);
    expect(slab.minY).toBe(1);
    expect(slab.maxY).toBe(1);
    expect(poolProfileRadiusAt(slab, 1)).toBeCloseTo(0.5, 6);
  });
});

describe('waterline radius', () => {
  it('reads the profile at the bind height the root offset puts on the plane', () => {
    const profile = poolRadialProfile(
      [
        // Slice-centre sampling: three fat slices, the middle one narrow.
        ...[0.9, 0.0, 0, -0.9, 0.0, 0],
        ...[0.1, 0.5, 0, -0.1, 0.5, 0],
        ...[0.7, 1.0, 0, -0.7, 1.0, 0],
      ],
      3,
    );
    // Just under the crown: the widest part of the head is in the water.
    expect(poolWaterlineRadius(profile, -0.999)).toBeCloseTo(0.7, 3);
    // Settled: root at 0, so the base sits on the water.
    expect(poolWaterlineRadius(profile, 0)).toBeCloseTo(0.9, 6);
    // Half risen: the neck is on the plane.
    expect(poolWaterlineRadius(profile, -0.5)).toBeCloseTo(0.1, 6);
  });

  it('closes the hole once the body is entirely under the plane', () => {
    // `poolProfileRadiusAt` clamps above the top slice, which would leave a
    // head-sized black ellipse floating on the water after the bust submerged.
    const profile = poolRadialProfile(
      [...[0.9, 0, 0, -0.9, 0, 0], ...[0.7, 1, 0, -0.7, 1, 0]],
      2,
    );
    expect(poolProfileRadiusAt(profile, 1.8)).toBeCloseTo(0.7, 6);
    expect(poolWaterlineRadius(profile, -1.8)).toBe(0);
    // The boundary itself: full submersion lands the waterline on exactly the
    // top of a rig authored to the ramp's height, so the bound is inclusive.
    expect(poolWaterlineRadius(profile, -profile.maxY)).toBe(0);
    // Still open while any of the body is above the plane.
    expect(poolWaterlineRadius(profile, -0.999)).toBeGreaterThan(0);
  });
});

describe('meniscus and contact ring', () => {
  it('peaks at the contour and decays outward', () => {
    expect(poolMeniscusLift(0.5, 0.5, 0.1)).toBe(1);
    expect(poolMeniscusLift(0.6, 0.5, 0.1)).toBeCloseTo(Math.exp(-1), 12);
    expect(poolMeniscusLift(1.5, 0.5, 0.1)).toBeLessThan(1e-4);
  });

  it('saturates inside the contour, where there is no water to lift', () => {
    expect(poolMeniscusLift(0, 0.5, 0.1)).toBe(1);
    expect(poolMeniscusLift(0.2, 0.5, 0.1)).toBe(1);
  });

  it('rings symmetrically about the contour', () => {
    expect(poolContactRing(0.4, 0.5, 0.1)).toBeCloseTo(poolContactRing(0.6, 0.5, 0.1), 12);
    expect(poolContactRing(0.5, 0.5, 0.1)).toBe(1);
  });

  it('degrades to a hard edge at zero width rather than dividing by zero', () => {
    expect(poolMeniscusLift(0.4, 0.5, 0)).toBe(1);
    expect(poolMeniscusLift(0.6, 0.5, 0)).toBe(0);
    expect(poolContactRing(0.5, 0.5, 0)).toBe(1);
    expect(poolContactRing(0.6, 0.5, 0)).toBe(0);
  });
});

describe('field shape', () => {
  it('keeps the height field a power of two so the texel offset is exact', () => {
    expect(Number.isInteger(Math.log2(POOL_RESOLUTION))).toBe(true);
  });
});
