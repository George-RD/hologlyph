import { describe, expect, it } from 'vitest';
import {
  INTERIOR_DEPTH_MAX,
  INTERIOR_DEPTH_MIN,
  INTERIOR_DRIFT_MARGIN,
  INTERIOR_MAX_STEP,
  INTERIOR_MIN_CLEARANCE,
  INTERIOR_STIFFNESS_LOOSE,
  INTERIOR_STIFFNESS_RIGID,
  createSurfaceProbe,
  interiorAxisAt,
  interiorBodyAxis,
  interiorContain,
  interiorDepthDim,
  interiorDriftBudgets,
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

/**
 * A tessellated sphere as positions plus an index buffer, so the tests have a
 * body whose nearest-surface distance is known analytically: for a point at
 * radius `r` inside a sphere of radius `R`, the clearance is `R - r`, up to the
 * sagitta of one quad, which is what the tolerances below allow for.
 */
function sphereMesh(radius: number, rings = 24, segments = 24): {
  positions: Float32Array;
  indices: Uint32Array;
} {
  const positions: number[] = [];
  for (let ring = 0; ring <= rings; ring++) {
    const phi = (ring / rings) * Math.PI;
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      positions.push(
        Math.sin(phi) * Math.cos(a) * radius,
        Math.cos(phi) * radius,
        Math.sin(phi) * Math.sin(a) * radius,
      );
    }
  }
  const indices: number[] = [];
  const stride = segments + 1;
  for (let ring = 0; ring < rings; ring++) {
    for (let s = 0; s < segments; s++) {
      const a = ring * stride + s;
      indices.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/**
 * Deepest a quad of `sphereMesh(0.5)` cuts inside the analytic sphere, which is
 * the tessellation error every distance below is allowed. The quad spans
 * `2*pi/24` of azimuth and `pi/24` of polar angle, so its centre sits at
 * `r * cos(pi/24) * cos(pi/48)`.
 */
const SPHERE_SAG = 0.5 * (1 - Math.cos(Math.PI / 24) * Math.cos(Math.PI / 48));

describe('surface probe', () => {
  // One triangle in the z = 0 plane, as triangle soup.
  const tri = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);

  it('measures to the face interior, not to the nearest corner', () => {
    const probe = createSurfaceProbe(tri, null);
    // Straight above the centroid: the face is 0.25 away, the nearest corner
    // is 0.46. A vertex-only search would report the corner and licence a
    // drift that goes straight through the skin.
    expect(probe.distance(1 / 3, 1 / 3, 0.25)).toBeCloseTo(0.25, 6);
  });

  it('measures to an edge and to a corner when the projection falls outside', () => {
    const probe = createSurfaceProbe(tri, null);
    // Beyond the hypotenuse, whose nearest point is its midpoint.
    expect(probe.distance(1, 1, 0)).toBeCloseTo(Math.SQRT1_2, 6);
    // Past the right-angle corner on both axes.
    expect(probe.distance(-0.3, -0.4, 0)).toBeCloseTo(0.5, 6);
  });

  it('reads an indexed mesh and its soup expansion identically', () => {
    const { positions, indices } = sphereMesh(0.5);
    const soup = new Float32Array(indices.length * 3);
    for (let i = 0; i < indices.length; i++) {
      const v = indices[i] as number;
      soup[i * 3] = positions[v * 3] as number;
      soup[i * 3 + 1] = positions[v * 3 + 1] as number;
      soup[i * 3 + 2] = positions[v * 3 + 2] as number;
    }
    const indexed = createSurfaceProbe(positions, indices);
    const expanded = createSurfaceProbe(soup, null);
    for (const point of [[0, 0, 0], [0.1, 0.2, -0.05], [0, 0.4, 0]]) {
      const [x, y, z] = point as [number, number, number];
      expect(expanded.distance(x, y, z)).toBeCloseTo(indexed.distance(x, y, z), 6);
    }
  });

  it('agrees with the analytic distance inside a sphere', () => {
    const { positions, indices } = sphereMesh(0.5);
    const probe = createSurfaceProbe(positions, indices);
    for (const r of [0, 0.1, 0.25, 0.4]) {
      expect(probe.distance(r, 0, 0)).toBeGreaterThan(0.5 - r - SPHERE_SAG - 1e-6);
      expect(probe.distance(r, 0, 0)).toBeLessThanOrEqual(0.5 - r + 1e-6);
    }
  });

  it('measures a collinear triangle by its edges rather than overreporting', () => {
    // A zero-area triangle, which a decimated GLB does contain: B sits on the
    // segment A to C, so every barycentric determinant vanishes. The nearest
    // point to (0.5, 0.3, 0) is on the segment, 0.3 away. Reporting the
    // distance to a corner instead, 0.583, would licence a drift that leaves
    // the skin.
    const collinear = new Float32Array([0, 0, 0, 0.5, 0, 0, 1, 0, 0]);
    const probe = createSurfaceProbe(collinear, null);
    expect(probe.distance(0.5, 0.3, 0)).toBeCloseTo(0.3, 6);
    expect(probe.distance(2, 0, 0)).toBeCloseTo(1, 6);
  });

  it('reports no clearance at all for geometry with no triangle in it', () => {
    // Unmeasurable surface, so the safe reading is no room: the glyphs hold
    // still. Calling it unbounded room would be the original leak.
    expect(createSurfaceProbe(new Float32Array(0), null).distance(0, 0, 0)).toBe(0);
    // An index buffer that points past the end of the positions is not a
    // triangle either. Degrade, do not throw.
    const stray = createSurfaceProbe(tri, new Uint32Array([0, 1, 99]));
    expect(stray.distance(0, 0, 1)).toBe(0);
  });
});

describe('interior site clearance', () => {
  it('reports each site its own distance to the nearest skin, not to its seed vertex', () => {
    const { positions, indices } = sphereMesh(0.5);
    const sites = sampleInteriorSites(positions, indices, null, 200, 4096, seededRng(31));
    expect(sites.count).toBeGreaterThan(150);
    expect(sites.clearances.length).toBe(sites.count);
    for (let g = 0; g < sites.count; g++) {
      const r = Math.hypot(
        sites.positions[g * 3] as number,
        sites.positions[g * 3 + 1] as number,
        sites.positions[g * 3 + 2] as number,
      );
      const clearance = sites.clearances[g] as number;
      expect(clearance).toBeGreaterThan(0);
      expect(clearance).toBeLessThanOrEqual(0.5 - r + 1e-5);
      expect(clearance).toBeGreaterThan(0.5 - r - SPHERE_SAG - 1e-5);
    }
  });
});

describe('interior site sampling', () => {
  const positions = bustPositions();

  it('places every site strictly inside the surface it was sampled from', () => {
    const sites = sampleInteriorSites(positions, null, null, 200, 96 * 64, seededRng());
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
    const sites = sampleInteriorSites(positions, null, null, 300, 4096, seededRng(7));
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
    const sites = sampleInteriorSites(positions, null, thickness, 200, 4096, seededRng(3));
    for (let g = 0; g < sites.count; g++) {
      expect(sites.positions[g * 3 + 1] as number).toBeGreaterThan(1.0);
    }
  });

  it('falls back to a uniform sample when the thickness bake is all zero', () => {
    // An over-budget rig gets an all-zero attribute. Degrade, do not throw:
    // the field still populates, it just stops preferring thick regions.
    const zeroed = new Float32Array(positions.length / 3);
    const sites = sampleInteriorSites(positions, null, zeroed, 64, 4096, seededRng(11));
    expect(sites.count).toBe(64);
    const heights = new Set<number>();
    for (let g = 0; g < sites.count; g++) heights.add(sites.positions[g * 3 + 1] as number);
    expect(heights.size).toBeGreaterThan(4);
  });

  it('is deterministic for a given rng, so a capture can be repeated', () => {
    const a = sampleInteriorSites(positions, null, null, 32, 4096, seededRng(5));
    const b = sampleInteriorSites(positions, null, null, 32, 4096, seededRng(5));
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
  });

  it('keeps every cell index addressable in the grid', () => {
    const sites = sampleInteriorSites(positions, null, null, 256, 96 * 64, seededRng(9));
    for (let g = 0; g < sites.count; g++) {
      expect(sites.cells[g] as number).toBeGreaterThanOrEqual(0);
      expect(sites.cells[g] as number).toBeLessThan(96 * 64);
    }
  });

  it('gives every glyph its own drift phase', () => {
    const sites = sampleInteriorSites(positions, null, null, 64, 4096, seededRng(13));
    expect(new Set(Array.from(sites.phases)).size).toBeGreaterThan(60);
  });

  it('samples nothing from an empty body and nothing at count 0', () => {
    expect(sampleInteriorSites(new Float32Array(0), null, null, 100, 4096, seededRng()).count).toBe(0);
    expect(sampleInteriorSites(positions, null, null, 0, 4096, seededRng()).count).toBe(0);
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
    const sites = sampleInteriorSites(buffer, null, null, 400, 4096, seededRng(17));
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
    expect(sampleInteriorSites(line, null, null, 50, 4096, seededRng(23)).count).toBe(0);
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

/** Budget stands aside in the tests that are about the drift shape alone. */
const UNBOUNDED = new Float32Array([Number.POSITIVE_INFINITY]);
const UNBOUNDED2 = new Float32Array([Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]);

describe('interior drift', () => {
  it('stays inside the amplitude it was given, on every axis', () => {
    const rest = new Float32Array([0, 0, 0]);
    const phases = new Float32Array([0.4]);
    const targets = new Float32Array(3);
    for (let t = 0; t < 400; t += 0.25) {
      interiorDriftTargets(targets, rest, phases, UNBOUNDED, 1, t, 0.01);
      expect(Math.abs(targets[0] as number)).toBeLessThanOrEqual(0.01 + 1e-9);
      expect(Math.abs(targets[1] as number)).toBeLessThanOrEqual(0.01 + 1e-9);
      expect(Math.abs(targets[2] as number)).toBeLessThanOrEqual(0.01 + 1e-9);
    }
  });

  it('is an exact identity at amplitude 0', () => {
    const rest = new Float32Array([1, 2, 3]);
    const targets = new Float32Array(3);
    interiorDriftTargets(targets, rest, new Float32Array([2.2]), UNBOUNDED, 1, 12.5, 0);
    expect(Array.from(targets)).toEqual([1, 2, 3]);
  });

  it('moves two glyphs at the same rest position apart, via their phases', () => {
    const rest = new Float32Array([0, 0, 0, 0, 0, 0]);
    const phases = new Float32Array([0, 2.1]);
    const targets = new Float32Array(6);
    interiorDriftTargets(targets, rest, phases, UNBOUNDED2, 2, 3, 0.02);
    expect(targets[0]).not.toBeCloseTo(targets[3] as number, 4);
  });

  it('actually moves over time rather than holding a constant offset', () => {
    const rest = new Float32Array([0, 0, 0]);
    const phases = new Float32Array([1]);
    const a = new Float32Array(3);
    const b = new Float32Array(3);
    interiorDriftTargets(a, rest, phases, UNBOUNDED, 1, 0, 0.02);
    interiorDriftTargets(b, rest, phases, UNBOUNDED, 1, 5, 0.02);
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

describe('interior drift budgets', () => {
  it('subtracts the sprite extent in world units and keeps a margin', () => {
    const out = new Float32Array(3);
    interiorDriftBudgets(out, new Float32Array([0.1, 0.05, 0.01]), 3, 0.02, 1);
    expect(out[0]).toBeCloseTo(0.08 * INTERIOR_DRIFT_MARGIN, 6);
    expect(out[1]).toBeCloseTo(0.03 * INTERIOR_DRIFT_MARGIN, 6);
    // The sprite already fills this site, so there is nothing left to spend.
    expect(out[2]).toBe(0);
  });

  it('scales the clearance into world units before the extent is taken off', () => {
    // A clearance of 0.05 in a frame scaled by 2 is 0.1 of world room, so a
    // 0.02 sprite leaves 0.08. Subtracting first would leave 0.06, and a
    // half-scale frame would be understated the other way.
    const out = new Float32Array(1);
    interiorDriftBudgets(out, new Float32Array([0.05]), 1, 0.02, 2);
    expect(out[0]).toBeCloseTo(0.08 * INTERIOR_DRIFT_MARGIN, 6);
  });
});

describe('interior drift containment', () => {
  /**
   * The defect: at full drift every glyph moved by the same global amplitude,
   * so the ones seeded nearest the face, which have the least clearance and
   * are the ones a viewer looks at, translated straight through the skin.
   */
  it('keeps every drawn glyph and its billboard inside the skin at full drift', () => {
    const radius = 0.5;
    const { positions, indices } = sphereMesh(radius);
    const sites = sampleInteriorSites(positions, indices, null, 300, 4096, seededRng(41));
    const targets = new Float32Array(sites.count * 3);
    const budgets = new Float32Array(sites.count);
    // The lab's maximum drift against a default sprite: an amplitude several
    // times the clearance of a near-surface site.
    const amplitude = 0.05;
    const extent = 0.02 * Math.SQRT2;
    interiorDriftBudgets(budgets, sites.clearances, sites.count, extent, 1);

    // A budget of 0 means the sprite does not fit at that site at all; the
    // field culls those rather than drawing a glyph that pokes out at rest.
    let drawable = 0;
    for (let g = 0; g < sites.count; g++) if ((budgets[g] as number) > 0) drawable++;
    // Culling must not be the whole answer: most of a sphere's interior has
    // room for a default sprite, and if it did not this test would pass by
    // drawing nothing.
    expect(drawable).toBeGreaterThan(sites.count * 0.6);

    // Checked two ways at once, because the probe's distance is UNSIGNED and so
    // cannot by itself tell a contained glyph from one that escaped and kept
    // going: the billboard must clear the skin by its own extent, AND the glyph
    // must be on the inside of it. The body is a sphere about the origin, so the
    // second is its radius.
    const skin = createSurfaceProbe(positions, indices);
    let touched = 0;
    let worstGap = Number.POSITIVE_INFINITY;
    let furthestOut = 0;
    // From t = 0, so the first pass is the field at rest, and on through a
    // full cycle of the slowest drift component.
    for (let t = 0; t < 60; t += 0.37) {
      interiorDriftTargets(targets, sites.positions, sites.phases, budgets, sites.count, t, amplitude);
      for (let g = 0; g < sites.count; g++) {
        if (!((budgets[g] as number) > 0)) continue;
        const x = targets[g * 3] as number;
        const y = targets[g * 3 + 1] as number;
        const z = targets[g * 3 + 2] as number;
        // It is the sprite's furthest corner that has to stay behind the skin,
        // so the glyph's own centre has to clear it by the whole extent.
        worstGap = Math.min(worstGap, skin.distance(x, y, z) - extent);
        furthestOut = Math.max(furthestOut, Math.hypot(x, y, z));
        const moved = Math.hypot(
          x - (sites.positions[g * 3] as number),
          y - (sites.positions[g * 3 + 1] as number),
          z - (sites.positions[g * 3 + 2] as number),
        );
        if (moved > 1e-6) touched++;
      }
    }
    expect(worstGap).toBeGreaterThan(0);
    expect(furthestOut).toBeLessThan(radius);
    // Not vacuous: the clamp must bound the field, not freeze it.
    expect(touched).toBeGreaterThan(0);
  });

  it('spends at most its own budget, and never more than asked', () => {
    const rest = new Float32Array([0, 0, 0]);
    const phases = new Float32Array([0.4]);
    const budgets = new Float32Array([0.008]);
    const targets = new Float32Array(3);
    let peak = 0;
    for (let t = 0; t < 200; t += 0.13) {
      interiorDriftTargets(targets, rest, phases, budgets, 1, t, 1);
      peak = Math.max(peak, Math.hypot(targets[0] as number, targets[1] as number, targets[2] as number));
    }
    expect(peak).toBeLessThanOrEqual(0.008 + 1e-9);
    // The cap is on the offset's LENGTH: three sines clamped per axis would
    // reach 1.58 times the budget on the diagonal.
    expect(peak).toBeGreaterThan(0.008 * 0.9);
  });

  it('leaves a glyph with room to spare moving exactly as it did', () => {
    const rest = new Float32Array([0.1, 0.2, 0.3]);
    const phases = new Float32Array([1.9]);
    const roomy = new Float32Array([1]);
    const clamped = new Float32Array(3);
    const free = new Float32Array(3);
    for (let t = 0; t < 40; t += 0.31) {
      interiorDriftTargets(clamped, rest, phases, roomy, 1, t, 0.008);
      interiorDriftTargets(free, rest, phases, UNBOUNDED, 1, t, 0.008);
      expect(Array.from(clamped)).toEqual(Array.from(free));
    }
  });

  it('still damps with the amplitude, so reduced motion keeps its effect', () => {
    const rest = new Float32Array([0, 0, 0]);
    const phases = new Float32Array([0.7]);
    const budgets = new Float32Array([0.016]);
    const full = new Float32Array(3);
    const damped = new Float32Array(3);
    let sawSmaller = false;
    for (let t = 0; t < 40; t += 0.29) {
      interiorDriftTargets(full, rest, phases, budgets, 1, t, 0.008);
      interiorDriftTargets(damped, rest, phases, budgets, 1, t, 0.002);
      const a = Math.hypot(full[0] as number, full[1] as number, full[2] as number);
      const b = Math.hypot(damped[0] as number, damped[1] as number, damped[2] as number);
      expect(b).toBeLessThanOrEqual(a + 1e-12);
      if (b < a - 1e-9) sawSmaller = true;
    }
    expect(sawSmaller).toBe(true);
  });

  it('freezes a glyph with no room rather than moving it through the skin', () => {
    const rest = new Float32Array([5, 6, 7]);
    const targets = new Float32Array(3);
    interiorDriftTargets(targets, rest, new Float32Array([1.1]), new Float32Array([0]), 1, 3, 0.05);
    expect(Array.from(targets)).toEqual([5, 6, 7]);
  });
});

describe('interior containment of the integrated glyph', () => {
  it('pulls a glyph the spring dragged out back onto its budget sphere', () => {
    // A bounded target is not a bounded glyph: the spring lags and overshoots,
    // so this is where the acceptance criterion is actually met.
    const positions = new Float32Array([0.3, 0, 0]);
    const velocities = new Float32Array([1, 0, 0]);
    const centres = new Float32Array([0, 0, 0]);
    interiorContain(positions, velocities, centres, new Float32Array([0.1]), 1);
    expect(positions[0]).toBeCloseTo(0.1, 6);
    // The outward push is gone, or the glyph stays pinned to the wall for as
    // long as the head keeps turning.
    expect(velocities[0]).toBeCloseTo(0, 6);
  });

  it('keeps the tangential velocity, so a caught glyph slides rather than stops', () => {
    const positions = new Float32Array([0.2, 0, 0]);
    const velocities = new Float32Array([3, 5, 0]);
    const centres = new Float32Array([0, 0, 0]);
    interiorContain(positions, velocities, centres, new Float32Array([0.1]), 1);
    expect(velocities[0]).toBeCloseTo(0, 6);
    expect(velocities[1]).toBeCloseTo(5, 6);
  });

  it('leaves a glyph inside its budget and its velocity untouched', () => {
    // Exactly representable in float32, so an exact compare is about behaviour
    // rather than about rounding.
    const positions = new Float32Array([0.0625, 0, 0]);
    const velocities = new Float32Array([2, -1, 0.5]);
    const centres = new Float32Array([0, 0, 0]);
    interiorContain(positions, velocities, centres, new Float32Array([0.125]), 1);
    expect(Array.from(positions)).toEqual([0.0625, 0, 0]);
    expect(Array.from(velocities)).toEqual([2, -1, 0.5]);
  });

  it('holds a glyph with no budget exactly on its centre', () => {
    const positions = new Float32Array([0.4, 0.4, 0.4]);
    const velocities = new Float32Array([1, 1, 1]);
    const centres = new Float32Array([1, 2, 3]);
    interiorContain(positions, velocities, centres, new Float32Array([0]), 1);
    expect(Array.from(positions)).toEqual([1, 2, 3]);
  });

  it('measures the ball about the CARRIED centre, not the world origin', () => {
    // The centres travel with the head. A containment that assumed a fixed
    // origin would drag every glyph toward it as soon as the head moved.
    const positions = new Float32Array([5.3, 2, 2]);
    const velocities = new Float32Array([0, 0, 0]);
    const centres = new Float32Array([5, 2, 2]);
    interiorContain(positions, velocities, centres, new Float32Array([0.1]), 1);
    expect(positions[0]).toBeCloseTo(5.1, 6);
    expect(positions[1]).toBeCloseTo(2, 6);
  });

  it('touches only the glyphs it was told about', () => {
    const positions = new Float32Array([9, 0, 0, 9, 0, 0]);
    const velocities = new Float32Array(6);
    const centres = new Float32Array(6);
    interiorContain(positions, velocities, centres, new Float32Array([0.1, 0.1]), 1);
    expect(positions[0]).toBeCloseTo(0.1, 6);
    expect(positions[3]).toBe(9);
  });
});
