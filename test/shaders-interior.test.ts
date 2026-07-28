import { describe, expect, it } from 'vitest';
import {
  INTERIOR_DEPTH_MAX,
  INTERIOR_DEPTH_MIN,
  INTERIOR_MAX_STEP,
  INTERIOR_MIN_CLEARANCE,
  INTERIOR_STIFFNESS_LOOSE,
  INTERIOR_STIFFNESS_RIGID,
  interiorAxisAt,
  interiorBodyAxis,
  interiorDepthDim,
  interiorDriftTargets,
  interiorIntegrate,
  interiorSpring,
  sampleInteriorSites,
} from '../src/shaders/interior-glyphs';

/** Deterministic, and never 0 or 1 exactly, so no branch is reached by luck. */
function seededRng(seed = 1): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state >>> 8) / 0x1000000;
  };
}

/**
 * A bust-shaped shell: a wide base, a pinched neck and a wider head, offset in
 * x so a whole-body centroid and a per-slice axis cannot be confused.
 */
function bustPositions(offsetX = 0): Float32Array {
  const out: number[] = [];
  const ring = (radius: number, y: number) => {
    for (let s = 0; s < 24; s++) {
      const a = (s / 24) * Math.PI * 2;
      out.push(offsetX + Math.cos(a) * radius, y, Math.sin(a) * radius);
    }
  };
  for (let i = 0; i <= 8; i++) ring(0.6, (i / 8) * 0.6);
  for (let i = 1; i <= 4; i++) ring(0.15, 0.6 + (i / 4) * 0.4);
  for (let i = 1; i <= 8; i++) ring(0.5, 1.0 + (i / 8) * 0.8);
  return new Float32Array(out);
}

describe('interior body axis', () => {
  it('follows the body centre line by height, not one whole-body centroid', () => {
    // The shell is offset in x, so a correct axis reports that offset at every
    // height. The point of slicing is the RADIUS story: at the neck the axis
    // must still be the neck's own centre, which a mass-weighted centroid of
    // the whole bust would drag toward the shoulders.
    const axis = interiorBodyAxis(bustPositions(0.25));
    expect(interiorAxisAt(axis, 0.1).x).toBeCloseTo(0.25, 3);
    expect(interiorAxisAt(axis, 0.8).x).toBeCloseTo(0.25, 3);
    expect(interiorAxisAt(axis, 1.6).x).toBeCloseTo(0.25, 3);
    expect(interiorAxisAt(axis, 0.8).z).toBeCloseTo(0, 3);
  });

  it('reports the body height span', () => {
    const axis = interiorBodyAxis(bustPositions());
    expect(axis.minY).toBeCloseTo(0, 6);
    expect(axis.maxY).toBeCloseTo(1.8, 6);
  });

  it('clamps outside the body rather than extrapolating off the ends', () => {
    const axis = interiorBodyAxis(bustPositions(0.25));
    expect(interiorAxisAt(axis, -10).x).toBeCloseTo(0.25, 3);
    expect(interiorAxisAt(axis, 10).x).toBeCloseTo(0.25, 3);
  });

  it('carries an empty slice forward instead of collapsing it to the origin', () => {
    // Two clusters with a gap between them: a naive mean over the empty
    // slices is 0, which would fling every site in that band to the model
    // origin. The gap must inherit the last populated slice instead.
    const positions = new Float32Array([
      5, 0, 0, 5, 0.02, 0, 5, 0.04, 0,
      5, 1, 0, 5, 1.02, 0, 5, 1.04, 0,
    ]);
    const axis = interiorBodyAxis(positions, 16);
    expect(interiorAxisAt(axis, 0.5).x).toBeCloseTo(5, 3);
  });

  it('survives an empty buffer', () => {
    const axis = interiorBodyAxis(new Float32Array(0));
    expect(axis.minY).toBe(0);
    expect(interiorAxisAt(axis, 3)).toEqual({ x: 0, z: 0 });
  });
});

describe('interior site sampling', () => {
  const positions = bustPositions();

  it('places every site strictly inside the surface it was sampled from', () => {
    const sites = sampleInteriorSites(positions, null, 200, 96 * 64, seededRng());
    expect(sites.count).toBe(200);
    for (let g = 0; g < sites.count; g++) {
      const x = sites.positions[g * 3] as number;
      const y = sites.positions[g * 3 + 1] as number;
      const z = sites.positions[g * 3 + 2] as number;
      // The shell's radius at this height, which the site must be inside of.
      let surface = 0;
      for (let i = 0; i < positions.length / 3; i++) {
        if (Math.abs((positions[i * 3 + 1] as number) - y) > 1e-6) continue;
        surface = Math.max(surface, Math.hypot(positions[i * 3] as number, positions[i * 3 + 2] as number));
      }
      const radius = Math.hypot(x, z);
      expect(radius).toBeLessThan(surface * (1 - INTERIOR_DEPTH_MIN) + 1e-6);
      expect(radius).toBeGreaterThan(-1e-6);
      // Height is preserved: a site slides inward, never up or down.
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1.8);
    }
  });

  it('never reaches the centre line, so the field cannot collapse onto it', () => {
    const sites = sampleInteriorSites(positions, null, 300, 4096, seededRng(7));
    let furthestIn = 0;
    for (let g = 0; g < sites.count; g++) {
      const y = sites.positions[g * 3 + 1] as number;
      let surface = 0;
      for (let i = 0; i < positions.length / 3; i++) {
        if (Math.abs((positions[i * 3 + 1] as number) - y) > 1e-6) continue;
        surface = Math.max(surface, Math.hypot(positions[i * 3] as number, positions[i * 3 + 2] as number));
      }
      const radius = Math.hypot(sites.positions[g * 3] as number, sites.positions[g * 3 + 2] as number);
      furthestIn = Math.max(furthestIn, 1 - radius / surface);
    }
    expect(furthestIn).toBeLessThanOrEqual(INTERIOR_DEPTH_MAX + 1e-6);
  });

  it('gathers sites where the body is thick and leaves thin regions alone', () => {
    // Thickness 1 on the head rings and 0 below: the field must end up in the
    // head. This is the whole point of weighting by the bake, because a
    // uniform sample puts glyphs inside the nose and the ears.
    const vertices = positions.length / 3;
    const thickness = new Float32Array(vertices);
    for (let i = 0; i < vertices; i++) {
      thickness[i] = (positions[i * 3 + 1] as number) > 1.0 ? 1 : 0;
    }
    const sites = sampleInteriorSites(positions, thickness, 200, 4096, seededRng(3));
    for (let g = 0; g < sites.count; g++) {
      expect(sites.positions[g * 3 + 1] as number).toBeGreaterThan(1.0);
    }
  });

  it('falls back to a uniform sample when the thickness bake is all zero', () => {
    // An over-budget rig gets an all-zero attribute. Degrade, do not throw:
    // the field still populates, it just stops preferring thick regions.
    const zeroed = new Float32Array(positions.length / 3);
    const sites = sampleInteriorSites(positions, zeroed, 64, 4096, seededRng(11));
    expect(sites.count).toBe(64);
    const heights = new Set<number>();
    for (let g = 0; g < sites.count; g++) heights.add(sites.positions[g * 3 + 1] as number);
    expect(heights.size).toBeGreaterThan(4);
  });

  it('is deterministic for a given rng, so a capture can be repeated', () => {
    const a = sampleInteriorSites(positions, null, 32, 4096, seededRng(5));
    const b = sampleInteriorSites(positions, null, 32, 4096, seededRng(5));
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
  });

  it('keeps every cell index addressable in the grid', () => {
    const sites = sampleInteriorSites(positions, null, 256, 96 * 64, seededRng(9));
    for (let g = 0; g < sites.count; g++) {
      expect(sites.cells[g] as number).toBeGreaterThanOrEqual(0);
      expect(sites.cells[g] as number).toBeLessThan(96 * 64);
    }
  });

  it('gives every glyph its own drift phase', () => {
    const sites = sampleInteriorSites(positions, null, 64, 4096, seededRng(13));
    expect(new Set(Array.from(sites.phases)).size).toBeGreaterThan(60);
  });

  it('samples nothing from an empty body and nothing at count 0', () => {
    expect(sampleInteriorSites(new Float32Array(0), null, 100, 4096, seededRng()).count).toBe(0);
    expect(sampleInteriorSites(positions, null, 0, 4096, seededRng()).count).toBe(0);
  });

  it('keeps every site clear of the surface, including at the poles', () => {
    // A sphere is the worst case for the centre-line placement: at the top and
    // bottom the axis MEETS the surface, so the slide inward is zero at any
    // depth and an accepted site would sit on the skin with its billboard
    // poking straight out of the silhouette.
    const sphere: number[] = [];
    for (let ring = 0; ring <= 24; ring++) {
      const phi = (ring / 24) * Math.PI;
      for (let s = 0; s < 24; s++) {
        const a = (s / 24) * Math.PI * 2;
        sphere.push(Math.sin(phi) * Math.cos(a) * 0.5, Math.cos(phi) * 0.5, Math.sin(phi) * Math.sin(a) * 0.5);
      }
    }
    const buffer = new Float32Array(sphere);
    const sites = sampleInteriorSites(buffer, null, 400, 4096, seededRng(17));
    expect(sites.count).toBeGreaterThan(300);
    // Bounding diagonal of a 1-unit sphere is sqrt(3); the floor is 2% of it.
    const clearance = INTERIOR_MIN_CLEARANCE * Math.sqrt(3);
    let worst = Number.POSITIVE_INFINITY;
    for (let g = 0; g < sites.count; g++) {
      const x = sites.positions[g * 3] as number;
      const z = sites.positions[g * 3 + 2] as number;
      const y = sites.positions[g * 3 + 1] as number;
      // Surface radius about the Y axis at this height, which every site was
      // slid inward from.
      const surface = Math.sqrt(Math.max(0, 0.25 - y * y));
      worst = Math.min(worst, surface - Math.hypot(x, z));
    }
    expect(worst).toBeGreaterThanOrEqual(clearance - 1e-6);
    // And an absolute floor, so zeroing the constant fails here rather than
    // passing vacuously against a clearance of nothing.
    expect(worst).toBeGreaterThan(0.01);
  });

  it('returns fewer sites than asked rather than placing one on the skin', () => {
    // A vertical line: the centre line IS the geometry, so no draw can ever
    // clear the surface and the honest answer is an empty field.
    const line = new Float32Array([0, 0, 0, 0, 0.5, 0, 0, 1, 0, 0, 1.5, 0]);
    expect(sampleInteriorSites(line, null, 50, 4096, seededRng(23)).count).toBe(0);
  });
});

describe('interior spring', () => {
  it('spans rigid to loose and stays under the explicit integrator bound', () => {
    expect(interiorSpring(0).stiffness).toBeCloseTo(INTERIOR_STIFFNESS_RIGID, 6);
    expect(interiorSpring(1).stiffness).toBeCloseTo(INTERIOR_STIFFNESS_LOOSE, 6);
    // Semi-implicit Euler diverges once `dt * sqrt(k)` reaches 2, and the
    // longest step the field will ever take is `INTERIOR_MAX_STEP`.
    expect(INTERIOR_MAX_STEP * Math.sqrt(interiorSpring(0).stiffness)).toBeLessThan(2);
  });

  it('is logarithmic, so the middle of the slider is a felt midpoint', () => {
    const mid = interiorSpring(0.5).stiffness;
    expect(mid).toBeCloseTo(Math.sqrt(INTERIOR_STIFFNESS_RIGID * INTERIOR_STIFFNESS_LOOSE), 4);
  });

  it('clamps an out-of-range inertia rather than inverting the ramp', () => {
    expect(interiorSpring(-3).stiffness).toBeCloseTo(INTERIOR_STIFFNESS_RIGID, 6);
    expect(interiorSpring(9).stiffness).toBeCloseTo(INTERIOR_STIFFNESS_LOOSE, 6);
  });

  it('stays under-damped, so a thrown glyph overshoots before it settles', () => {
    const { stiffness, damping } = interiorSpring(0.5);
    expect(damping).toBeLessThan(2 * Math.sqrt(stiffness));
  });
});

describe('interior integration', () => {
  /** Run the field until it is within `tol` of a stationary target. */
  function settle(inertia: number, dt = 1 / 60, limit = 6000): number {
    const { stiffness, damping } = interiorSpring(inertia);
    const x = new Float32Array([0, 0, 0]);
    const v = new Float32Array(3);
    const target = new Float32Array([1, 0, 0]);
    for (let step = 0; step < limit; step++) {
      interiorIntegrate(x, v, target, 1, stiffness, damping, dt);
      if (Math.abs((x[0] as number) - 1) < 0.01 && Math.abs(v[0] as number) < 0.05) {
        return step * dt;
      }
    }
    return Number.POSITIVE_INFINITY;
  }

  it('settles on a stationary target at every inertia', () => {
    expect(settle(0)).toBeLessThan(1);
    expect(settle(0.55)).toBeLessThan(4);
    expect(settle(1)).toBeLessThan(12);
  });

  it('lags more as inertia rises, which is the whole point of the control', () => {
    expect(settle(1)).toBeGreaterThan(settle(0.5));
    expect(settle(0.5)).toBeGreaterThan(settle(0));
  });

  it('overshoots a step target before settling, rather than creeping to it', () => {
    const { stiffness, damping } = interiorSpring(0.55);
    const x = new Float32Array(3);
    const v = new Float32Array(3);
    const target = new Float32Array([1, 0, 0]);
    let peak = 0;
    for (let step = 0; step < 600; step++) {
      interiorIntegrate(x, v, target, 1, stiffness, damping, 1 / 60);
      peak = Math.max(peak, x[0] as number);
    }
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.5);
  });

  it('clamps a long frame instead of exploding on it', () => {
    // A backgrounded tab hands back seconds, and `dt * sqrt(k)` past 2 sends
    // an explicit integrator to infinity in a handful of steps.
    const { stiffness, damping } = interiorSpring(0);
    const x = new Float32Array(3);
    const v = new Float32Array(3);
    const target = new Float32Array([1, 0, 0]);
    for (let step = 0; step < 200; step++) {
      interiorIntegrate(x, v, target, 1, stiffness, damping, 4);
    }
    expect(Number.isFinite(x[0] as number)).toBe(true);
    expect(Math.abs(x[0] as number)).toBeLessThan(10);
  });

  it('does nothing at dt 0, so a paused frame cannot drift the field', () => {
    const x = new Float32Array([0.5, 0.5, 0.5]);
    const v = new Float32Array([1, 1, 1]);
    const target = new Float32Array([9, 9, 9]);
    interiorIntegrate(x, v, target, 1, 100, 10, 0);
    expect(Array.from(x)).toEqual([0.5, 0.5, 0.5]);
    expect(Array.from(v)).toEqual([1, 1, 1]);
  });

  it('touches only the glyphs it was told about', () => {
    const x = new Float32Array([0, 0, 0, 7, 7, 7]);
    const v = new Float32Array(6);
    const target = new Float32Array([1, 1, 1, 1, 1, 1]);
    interiorIntegrate(x, v, target, 1, 100, 10, 1 / 60);
    expect(x[3]).toBe(7);
    expect(x[0]).not.toBe(0);
  });
});

describe('interior drift', () => {
  it('stays inside the amplitude it was given, on every axis', () => {
    const rest = new Float32Array([0, 0, 0]);
    const phases = new Float32Array([0.4]);
    const targets = new Float32Array(3);
    for (let t = 0; t < 400; t += 0.25) {
      interiorDriftTargets(targets, rest, phases, 1, t, 0.01);
      expect(Math.abs(targets[0] as number)).toBeLessThanOrEqual(0.01 + 1e-9);
      expect(Math.abs(targets[1] as number)).toBeLessThanOrEqual(0.01 + 1e-9);
      expect(Math.abs(targets[2] as number)).toBeLessThanOrEqual(0.01 + 1e-9);
    }
  });

  it('is an exact identity at amplitude 0', () => {
    const rest = new Float32Array([1, 2, 3]);
    const targets = new Float32Array(3);
    interiorDriftTargets(targets, rest, new Float32Array([2.2]), 1, 12.5, 0);
    expect(Array.from(targets)).toEqual([1, 2, 3]);
  });

  it('moves two glyphs at the same rest position apart, via their phases', () => {
    const rest = new Float32Array([0, 0, 0, 0, 0, 0]);
    const phases = new Float32Array([0, 2.1]);
    const targets = new Float32Array(6);
    interiorDriftTargets(targets, rest, phases, 2, 3, 0.02);
    expect(targets[0]).not.toBeCloseTo(targets[3] as number, 4);
  });

  it('actually moves over time rather than holding a constant offset', () => {
    const rest = new Float32Array([0, 0, 0]);
    const phases = new Float32Array([1]);
    const a = new Float32Array(3);
    const b = new Float32Array(3);
    interiorDriftTargets(a, rest, phases, 1, 0, 0.02);
    interiorDriftTargets(b, rest, phases, 1, 5, 0.02);
    expect(a[0]).not.toBeCloseTo(b[0] as number, 4);
  });
});

describe('interior depth dim', () => {
  it('is full brightness at the front and dimmest at the back', () => {
    expect(interiorDepthDim(1, 1, 3, 0.6)).toBeCloseTo(1, 6);
    expect(interiorDepthDim(3, 1, 3, 0.6)).toBeCloseTo(0.4, 6);
    expect(interiorDepthDim(2, 1, 3, 0.6)).toBeCloseTo(0.7, 6);
  });

  it('never dims to nothing and never brightens past the front', () => {
    for (const depth of [-5, 0, 1, 2, 3, 50]) {
      const dim = interiorDepthDim(depth, 1, 3, 1);
      expect(dim).toBeGreaterThanOrEqual(0);
      expect(dim).toBeLessThanOrEqual(1);
    }
  });

  it('dims nothing across a degenerate span rather than dividing by it', () => {
    // One glyph, or a camera looking along the field's thin axis.
    expect(interiorDepthDim(2, 2, 2, 0.9)).toBe(1);
    expect(interiorDepthDim(2, 3, 1, 0.9)).toBe(1);
  });

  it('is an exact identity at fade 0', () => {
    expect(interiorDepthDim(2.5, 1, 3, 0)).toBe(1);
  });
});
