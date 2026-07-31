/**
 * Interior glyph field: the pure half (dec.liquid-glass-architecture, item 10).
 *
 * Sparse glyphs suspended between the near and far surfaces of the glass body,
 * dragged off course when the head moves and settling again afterwards. This
 * module owns everything about them that is arithmetic: where a site goes,
 * how the spring that carries it behaves, how it drifts while nothing is
 * happening, and how it dims with depth.
 *
 * Nothing here touches three, a texture or a buffer, so the whole model is
 * unit testable and the engine's own suite can use the real functions rather
 * than a stub. `interior-glyph-field.ts` is the half that owns the mesh.
 */

import { clamp01 } from '../contracts';

/**
 * Hard cap on suspended glyphs.
 *
 * The per-frame cost is linear in this: a billboard, a view depth and twelve
 * position writes each, plus one sort. 512 is well past where the field stops
 * reading as text in glass and starts reading as a snow globe, so the cap is
 * a guard against a host typing a large number, not a performance target. It
 * also keeps the quad indices inside a `Uint16Array` with room to spare.
 */
export const INTERIOR_GLYPH_MAX = 512;

/** Height slices used to describe the body's centre line. */
export const INTERIOR_AXIS_SLICES = 32;

/**
 * How far a site slides from its surface vertex toward the body axis, as a
 * fraction of the distance. Bounded away from 0 so nothing is welded to the
 * inside of the skin, and away from 1 so the field does not collapse onto the
 * centre line.
 */
export const INTERIOR_DEPTH_MIN = 0.35;
export const INTERIOR_DEPTH_MAX = 0.9;

/**
 * Minimum inward slide from the source vertex, as a fraction of the body's
 * bounding diagonal.
 *
 * The centre line meets the surface at the crown and under the chin, so the
 * slide there is zero at any `depth` and the site lands ON the skin, where
 * its billboard pokes out of the silhouette. On the shipped bust the diagonal
 * is 1.4 units and this floor is 0.028, comfortably past the 0.024 a
 * default-sized sprite spans.
 */
export const INTERIOR_MIN_CLEARANCE = 0.02;

/** Redraws allowed before a site that cannot clear the surface is abandoned. */
const CLEARANCE_ATTEMPTS = 8;

/**
 * Share of a glyph's own clearance the drift is allowed to spend.
 *
 * A hard clamp at the full clearance would let a glyph graze the inside of the
 * skin at the top of its cycle, which reads as stuck to the surface rather
 * than suspended in it. Keeping a fifth of the clearance in reserve keeps the
 * gap legible, and absorbs the fact that the surface a glyph is measured
 * against deforms with the rig after the clearance was measured.
 */
export const INTERIOR_DRIFT_MARGIN = 0.8;

/** Spring stiffness at `inertia: 0`, where the glyphs track the rig exactly. */
export const INTERIOR_STIFFNESS_RIGID = 420;

/** Spring stiffness at `inertia: 1`, where they wallow behind a head turn. */
export const INTERIOR_STIFFNESS_LOOSE = 5;

/**
 * Damping ratio of the spring. Under 1 on purpose: a critically damped glyph
 * slides back into place, and an under-damped one overshoots slightly and
 * settles, which is what a mote suspended in a fluid actually does.
 */
export const INTERIOR_DAMPING_RATIO = 0.55;

/**
 * Longest integration step, seconds. A backgrounded tab or a stalled frame
 * hands back a large `dt`, and the explicit integrator below is only stable
 * while `dt * sqrt(stiffness)` stays under 2. At the rigid end that bound is
 * 0.097 s, so this leaves roughly a factor of two of headroom.
 */
export const INTERIOR_MAX_STEP = 1 / 20;

/**
 * Share of the drift that survives `prefers-reduced-motion`. Not zero, for the
 * reason the pool's `REDUCED_DRIVE` is not zero: a field of perfectly frozen
 * glyphs inside a head that is still breathing reads as a bug rather than as a
 * preference. The lag, which is the actual shake response, IS removed.
 */
export const INTERIOR_REDUCED_DRIFT = 0.25;

/** Angular rates of the three drift components, radians per second. */
const DRIFT_RATE_X = 0.37;
const DRIFT_RATE_Y = 0.29;
const DRIFT_RATE_Z = 0.23;

/** Vertical drift is smaller: sinking and rising reads as gravity, not fluid. */
const DRIFT_VERTICAL_SCALE = 0.7;

/**
 * The body's centre line, sliced by height: the mean x and z of every vertex
 * in each slice.
 *
 * A site slides from its surface vertex toward this line at its own height,
 * which is what puts a forehead sample in the middle of the skull. A single
 * whole-body centroid would send it down into the neck instead, because a bust
 * has most of its mass at the shoulders.
 */
export interface InteriorAxis {
  readonly minY: number;
  readonly maxY: number;
  /** Mean x per slice, low to high. */
  readonly cx: Float32Array;
  /** Mean z per slice, low to high. */
  readonly cz: Float32Array;
}

/**
 * Build the centre line from a flat XYZ position buffer in bind space.
 *
 * Empty slices inherit the nearest populated one below them, so a rig with a
 * gap in its height distribution does not hand back a zeroed axis that would
 * fling every site in that band to the model origin.
 */
export function interiorBodyAxis(
  positions: ArrayLike<number>,
  slices: number = INTERIOR_AXIS_SLICES,
): InteriorAxis {
  const n = Math.max(1, Math.floor(slices));
  const cx = new Float32Array(n);
  const cz = new Float32Array(n);
  const count = Math.floor(positions.length / 3);
  if (count === 0) return { minY: 0, maxY: 0, cx, cz };

  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < count; i++) {
    const y = positions[i * 3 + 1] ?? 0;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return { minY: 0, maxY: 0, cx, cz };

  const span = maxY - minY;
  const tally = new Float64Array(n);
  for (let i = 0; i < count; i++) {
    const y = positions[i * 3 + 1] ?? 0;
    const t = span > 0 ? (y - minY) / span : 0;
    const slice = Math.min(n - 1, Math.max(0, Math.floor(t * n)));
    cx[slice] = (cx[slice] ?? 0) + (positions[i * 3] ?? 0);
    cz[slice] = (cz[slice] ?? 0) + (positions[i * 3 + 2] ?? 0);
    tally[slice] = (tally[slice] ?? 0) + 1;
  }

  let lastX = 0;
  let lastZ = 0;
  for (let s = 0; s < n; s++) {
    const hits = tally[s] ?? 0;
    if (hits > 0) {
      lastX = (cx[s] ?? 0) / hits;
      lastZ = (cz[s] ?? 0) / hits;
    }
    cx[s] = lastX;
    cz[s] = lastZ;
  }
  return { minY, maxY, cx, cz };
}

/** Linearly interpolated centre line at bind-space height `y`. */
export function interiorAxisAt(axis: InteriorAxis, y: number): { x: number; z: number } {
  const n = axis.cx.length;
  if (n === 0) return { x: 0, z: 0 };
  const span = axis.maxY - axis.minY;
  if (!(span > 0)) return { x: axis.cx[0] ?? 0, z: axis.cz[0] ?? 0 };
  // Slice centres sit half a slice in, so the interpolation is between
  // centres rather than between edges and the ends do not shear.
  const t = ((y - axis.minY) / span) * n - 0.5;
  const lo = Math.min(n - 1, Math.max(0, Math.floor(t)));
  const hi = Math.min(n - 1, lo + 1);
  const f = clamp01(t - lo);
  return {
    x: (axis.cx[lo] ?? 0) * (1 - f) + (axis.cx[hi] ?? 0) * f,
    z: (axis.cz[lo] ?? 0) * (1 - f) + (axis.cz[hi] ?? 0) * f,
  };
}

/**
 * Nearest-surface distance queries against a static triangle mesh.
 *
 * The number a suspended glyph needs is its distance to the NEAREST point on
 * the skin, not to the vertex it was seeded from: a site slides toward the body
 * axis, so the surface it ends up closest to is routinely the side of the head
 * rather than the patch behind it. A vertex-only search has the same flaw in
 * miniature, because a triangle's interior passes closer to an interior point
 * than any of its corners do, and both errors point the same unsafe way, at a
 * clearance larger than the real one.
 *
 * Exact, and brute force behind a bounding-sphere reject: a query costs one
 * squared centroid distance and a compare per triangle, and the exact
 * point-triangle solve runs only on triangles that could still win. Built once
 * for at most `INTERIOR_GLYPH_MAX` queries, on a field the shipped
 * configuration never switches on, so a spatial index would be code to carry
 * for no measurable gain.
 */
export interface SurfaceProbe {
  /** Distance from `(x, y, z)` to the nearest point on the mesh. */
  distance(x: number, y: number, z: number): number;
}

/**
 * Build a probe over a flat XYZ position buffer.
 *
 * `indices` null means the buffer is triangle soup, which is what a
 * non-indexed `BufferGeometry` is, so consecutive triples are the triangles.
 * Geometry with no readable triangle in it yields a probe that reports 0 at
 * every point: no room anywhere, which holds the glyphs still. Degrade, do not
 * throw, and degrade toward the safe end, because the alternative reading of an
 * unmeasurable surface is unbounded room, which is the leak this bounds.
 */
export function createSurfaceProbe(
  positions: ArrayLike<number>,
  indices: ArrayLike<number> | null,
): SurfaceProbe {
  const vertices = Math.floor(positions.length / 3);
  const triangles = indices ? Math.floor(indices.length / 3) : Math.floor(vertices / 3);
  // Corner positions are inlined rather than indexed at query time: three
  // lookups through `indices` per triangle per glyph is the entire cost of the
  // reject pass, and the copy is dropped with the probe.
  const corners = new Float64Array(triangles * 9);
  // Centroid xyz plus the radius of the sphere about it that contains the
  // triangle, which is what the reject tests against.
  const bounds = new Float64Array(triangles * 4);
  let kept = 0;
  for (let t = 0; t < triangles; t++) {
    const ia = indices ? (indices[t * 3] ?? 0) : t * 3;
    const ib = indices ? (indices[t * 3 + 1] ?? 0) : t * 3 + 1;
    const ic = indices ? (indices[t * 3 + 2] ?? 0) : t * 3 + 2;
    if (ia >= vertices || ib >= vertices || ic >= vertices) continue;
    const base = kept * 9;
    corners[base] = positions[ia * 3] ?? 0;
    corners[base + 1] = positions[ia * 3 + 1] ?? 0;
    corners[base + 2] = positions[ia * 3 + 2] ?? 0;
    corners[base + 3] = positions[ib * 3] ?? 0;
    corners[base + 4] = positions[ib * 3 + 1] ?? 0;
    corners[base + 5] = positions[ib * 3 + 2] ?? 0;
    corners[base + 6] = positions[ic * 3] ?? 0;
    corners[base + 7] = positions[ic * 3 + 1] ?? 0;
    corners[base + 8] = positions[ic * 3 + 2] ?? 0;
    const cx = ((corners[base] ?? 0) + (corners[base + 3] ?? 0) + (corners[base + 6] ?? 0)) / 3;
    const cy = ((corners[base + 1] ?? 0) + (corners[base + 4] ?? 0) + (corners[base + 7] ?? 0)) / 3;
    const cz = ((corners[base + 2] ?? 0) + (corners[base + 5] ?? 0) + (corners[base + 8] ?? 0)) / 3;
    let radiusSq = 0;
    for (let c = 0; c < 3; c++) {
      const dx = (corners[base + c * 3] ?? 0) - cx;
      const dy = (corners[base + c * 3 + 1] ?? 0) - cy;
      const dz = (corners[base + c * 3 + 2] ?? 0) - cz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d > radiusSq) radiusSq = d;
    }
    const slot = kept * 4;
    bounds[slot] = cx;
    bounds[slot + 1] = cy;
    bounds[slot + 2] = cz;
    bounds[slot + 3] = Math.sqrt(radiusSq);
    kept++;
  }

  return {
    distance(x: number, y: number, z: number): number {
      // No measurable surface means no measurable room.
      if (kept === 0) return 0;
      let best = Number.POSITIVE_INFINITY;
      let bestSq = Number.POSITIVE_INFINITY;
      for (let t = 0; t < kept; t++) {
        const slot = t * 4;
        const dx = (bounds[slot] ?? 0) - x;
        const dy = (bounds[slot + 1] ?? 0) - y;
        const dz = (bounds[slot + 2] ?? 0) - z;
        // `best` is Infinity until the first solve, so the limit is too and
        // that triangle is never rejected.
        const limit = best + (bounds[slot + 3] ?? 0);
        if (dx * dx + dy * dy + dz * dz > limit * limit) continue;
        const sq = pointTriangleDistanceSq(x, y, z, corners, t * 9);
        if (sq < bestSq) {
          bestSq = sq;
          best = Math.sqrt(sq);
        }
      }
      return best;
    },
  };
}

/**
 * Squared distance from a point to the triangle whose corners start at `base`
 * in `corners`.
 *
 * Ericson's barycentric region walk: the triangle's seven Voronoi regions are
 * tested in order and the first hit returns, so a point over the face costs two
 * dot products and a corner case never reaches a projection it does not need.
 */
function pointTriangleDistanceSq(
  x: number,
  y: number,
  z: number,
  corners: Float64Array,
  base: number,
): number {
  const ax = corners[base] ?? 0;
  const ay = corners[base + 1] ?? 0;
  const az = corners[base + 2] ?? 0;
  const abx = (corners[base + 3] ?? 0) - ax;
  const aby = (corners[base + 4] ?? 0) - ay;
  const abz = (corners[base + 5] ?? 0) - az;
  const acx = (corners[base + 6] ?? 0) - ax;
  const acy = (corners[base + 7] ?? 0) - ay;
  const acz = (corners[base + 8] ?? 0) - az;
  const apx = x - ax;
  const apy = y - ay;
  const apz = z - az;

  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;

  const bpx = apx - abx;
  const bpy = apy - aby;
  const bpz = apz - abz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const ex = apx - abx * v;
    const ey = apy - aby * v;
    const ez = apz - abz * v;
    return ex * ex + ey * ey + ez * ez;
  }

  const cpx = apx - acx;
  const cpy = apy - acy;
  const cpz = apz - acz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const ex = apx - acx * w;
    const ey = apy - acy * w;
    const ez = apz - acz * w;
    return ex * ex + ey * ey + ez * ez;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    const ex = apx - abx - (acx - abx) * w;
    const ey = apy - aby - (acy - aby) * w;
    const ez = apz - abz - (acz - abz) * w;
    return ex * ex + ey * ey + ez * ez;
  }

  const denom = va + vb + vc;
  // A collinear triangle, which a decimated or badly authored GLB does contain,
  // has no interior region: every barycentric determinant vanishes and the
  // region tests above can all miss, because they are gated on signs that a
  // zero-area triangle does not produce. Its nearest point is on one of its
  // three edges, so measure them. Overreporting here would licence a drift
  // straight through the skin, which is the whole defect this bounds.
  if (!(denom > 0)) {
    const bx = ax + abx;
    const by = ay + aby;
    const bz = az + abz;
    const cx = ax + acx;
    const cy = ay + acy;
    const cz = az + acz;
    return Math.min(
      pointSegmentDistanceSq(x, y, z, ax, ay, az, bx, by, bz),
      pointSegmentDistanceSq(x, y, z, bx, by, bz, cx, cy, cz),
      pointSegmentDistanceSq(x, y, z, cx, cy, cz, ax, ay, az),
    );
  }
  const v = vb / denom;
  const w = vc / denom;
  const ex = apx - abx * v - acx * w;
  const ey = apy - aby * v - acy * w;
  const ez = apz - abz * v - acz * w;
  return ex * ex + ey * ey + ez * ez;
}

/** Squared distance from a point to the segment `a` to `b`. */
function pointSegmentDistanceSq(
  x: number,
  y: number,
  z: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  const ex = bx - ax;
  const ey = by - ay;
  const ez = bz - az;
  const px = x - ax;
  const py = y - ay;
  const pz = z - az;
  const lenSq = ex * ex + ey * ey + ez * ez;
  // A segment of no length is a point, and its projection parameter is 0.
  const t = lenSq > 0 ? Math.min(1, Math.max(0, (px * ex + py * ey + pz * ez) / lenSq)) : 0;
  const dx = px - ex * t;
  const dy = py - ey * t;
  const dz = pz - ez * t;
  return dx * dx + dy * dy + dz * dz;
}

/** A sampled field of suspension sites, in the source geometry's bind space. */
export interface InteriorSites {
  readonly count: number;
  /** Flat XYZ rest positions, `count * 3` long. */
  readonly positions: Float32Array;
  /** Index of the text-skin grid cell each glyph shows. */
  readonly cells: Uint16Array;
  /** Drift phase per glyph, radians, so no two move together. */
  readonly phases: Float32Array;
  /**
   * Distance from each site to the nearest point on the surface it was sampled
   * from, in the same units as `positions`. This is the room the glyph has to
   * drift in, and it is per glyph because where a site could be seeded decides
   * how much room it got.
   */
  readonly clearances: Float32Array;
}

/**
 * Sample suspension sites from a body's surface and its baked thickness.
 *
 * Thickness is a WEIGHT here, never a distance. `aThickness` is normalised to
 * [0,1] by the largest chord in the mesh, so it says which parts of the body
 * are thick without saying how thick they are in world units, and marching
 * inward by it would need a scale that the bake threw away. Weighting the
 * vertex choice by it is enough to do the job it is needed for: keep glyphs
 * out of the nose, the ears and the chin, where there is no interior to be
 * suspended in.
 *
 * With no usable thickness (over budget, or a rig that never got a bake) the
 * weights fall back to uniform and the field still populates. Degrade, do not
 * throw.
 *
 * Returns AT MOST `count` sites. A draw that lands too close to the surface
 * is retried and then abandoned, so the caller must read `count` off the
 * result rather than assuming what it asked for.
 */
export function sampleInteriorSites(
  positions: ArrayLike<number>,
  indices: ArrayLike<number> | null,
  thickness: ArrayLike<number> | null,
  count: number,
  cells: number,
  rng: () => number,
): InteriorSites {
  const wanted = Math.max(0, Math.floor(count));
  const vertices = Math.floor(positions.length / 3);
  if (wanted === 0 || vertices === 0) {
    return {
      count: 0,
      positions: new Float32Array(0),
      cells: new Uint16Array(0),
      phases: new Float32Array(0),
      clearances: new Float32Array(0),
    };
  }

  // Cumulative thickness, so a vertex is drawn with probability proportional
  // to how much body sits behind it. One pass, one binary search per site.
  const cdf = new Float64Array(vertices);
  let total = 0;
  for (let i = 0; i < vertices; i++) {
    const w = thickness ? (thickness[i] ?? 0) : 1;
    total += w > 0 && Number.isFinite(w) ? w : 0;
    cdf[i] = total;
  }
  const weighted = total > 0;

  const axis = interiorBodyAxis(positions);
  const clearance = INTERIOR_MIN_CLEARANCE * bodyDiagonal(positions);
  const cellCount = Math.max(1, Math.floor(cells));
  const out = new Float32Array(wanted * 3);
  const cellOf = new Uint16Array(wanted);
  const phases = new Float32Array(wanted);
  const clearances = new Float32Array(wanted);
  const probe = createSurfaceProbe(positions, indices);

  let kept = 0;
  for (let g = 0; g < wanted; g++) {
    for (let attempt = 0; attempt < CLEARANCE_ATTEMPTS; attempt++) {
      const vertex = weighted
        ? pickWeighted(cdf, rng() * total)
        : Math.min(vertices - 1, Math.floor(rng() * vertices));
      const x = positions[vertex * 3] ?? 0;
      const y = positions[vertex * 3 + 1] ?? 0;
      const z = positions[vertex * 3 + 2] ?? 0;
      const centre = interiorAxisAt(axis, y);
      const depth = INTERIOR_DEPTH_MIN + rng() * (INTERIOR_DEPTH_MAX - INTERIOR_DEPTH_MIN);
      const dx = (centre.x - x) * depth;
      const dz = (centre.z - z) * depth;
      // At the crown and under the chin the centre line meets the surface, so
      // the slide inward is zero however large `depth` is, and a site lands
      // ON the skin where its billboard pokes straight out of the silhouette.
      // Retry rather than accept it; a body is only degenerate like this at
      // its poles, so this costs a handful of extra draws in total.
      if (Math.hypot(dx, dz) < clearance) continue;
      out[kept * 3] = x + dx;
      out[kept * 3 + 1] = y;
      out[kept * 3 + 2] = z + dz;
      cellOf[kept] = Math.min(cellCount - 1, Math.floor(rng() * cellCount));
      phases[kept] = rng() * Math.PI * 2;
      clearances[kept] = probe.distance(x + dx, y, z + dz);
      kept++;
      break;
    }
  }

  return {
    count: kept,
    positions: out.subarray(0, kept * 3),
    cells: cellOf.subarray(0, kept),
    phases: phases.subarray(0, kept),
    clearances: clearances.subarray(0, kept),
  };
}

/**
 * Longest diagonal of the body's bounding box, which is what every tolerance
 * here is relative to, so a rig authored in millimetres behaves exactly like
 * one authored in metres.
 */
function bodyDiagonal(positions: ArrayLike<number>): number {
  const n = Math.floor(positions.length / 3);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3] ?? 0;
    const y = positions[i * 3 + 1] ?? 0;
    const z = positions[i * 3 + 2] ?? 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) return 0;
  return Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
}

/** First index whose cumulative weight reaches `target`. */
function pickWeighted(cdf: Float64Array, target: number): number {
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((cdf[mid] ?? 0) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Spring constants for an inertia in [0,1].
 *
 * Logarithmic, because stiffness is felt as a ratio: a linear ramp from 420 to
 * 5 spends most of the slider's travel in a range the eye cannot tell apart
 * and collapses the interesting part into the last few per cent.
 */
export function interiorSpring(inertia: number): { stiffness: number; damping: number } {
  const t = clamp01(inertia);
  const stiffness =
    INTERIOR_STIFFNESS_RIGID * (INTERIOR_STIFFNESS_LOOSE / INTERIOR_STIFFNESS_RIGID) ** t;
  return { stiffness, damping: 2 * INTERIOR_DAMPING_RATIO * Math.sqrt(stiffness) };
}

/**
 * One semi-implicit Euler step of the spring-damper, in place over flat XYZ
 * buffers.
 *
 * This IS the fictitious force the field needs, and it is the whole motion
 * model. The target is the rest site carried by the head's frame, so turning
 * the head sweeps the target away from the glyph, the spring pulls it after,
 * and the damping settles it. Writing it as an explicit force in the
 * non-inertial frame instead would mean differentiating the head's orientation
 * twice per frame, and every jitter in the frame time would come back as a
 * kick.
 *
 * Allocation free: it runs over every glyph, every frame.
 */
export function interiorIntegrate(
  positions: Float32Array,
  velocities: Float32Array,
  targets: Float32Array,
  count: number,
  stiffness: number,
  damping: number,
  dt: number,
): void {
  const step = Math.min(Math.max(0, dt), INTERIOR_MAX_STEP);
  if (step === 0) return;
  const n = Math.max(0, Math.floor(count)) * 3;
  for (let i = 0; i < n; i++) {
    const x = positions[i] ?? 0;
    const v = velocities[i] ?? 0;
    const accel = ((targets[i] ?? 0) - x) * stiffness - v * damping;
    const next = v + accel * step;
    velocities[i] = next;
    positions[i] = x + next * step;
  }
}

/**
 * Turn per-glyph clearances into the WORLD-space radius each glyph may leave its
 * rest position by, in place over `out`.
 *
 * `scale` carries the clearances out of the space they were measured in and into
 * world units, because `extent` is in world units and the two have to be
 * subtracted in the same space. `extent` is the distance from a sprite's centre
 * to its furthest corner, so it is the billboard that stays behind the skin
 * rather than the point it hangs from, and `INTERIOR_DRIFT_MARGIN` keeps a
 * reserve on top of that. A glyph with no room left gets a budget of 0 and holds
 * still, which is the honest answer for a site its own sprite already fills.
 */
export function interiorDriftBudgets(
  out: Float32Array,
  clearances: Float32Array,
  count: number,
  extent: number,
  scale: number,
): void {
  const n = Math.max(0, Math.floor(count));
  const reach = Math.max(0, extent);
  const factor = Math.max(0, scale);
  for (let g = 0; g < n; g++) {
    out[g] = Math.max(0, (clearances[g] ?? 0) * factor - reach) * INTERIOR_DRIFT_MARGIN;
  }
}

/**
 * Write `rest + drift` into `targets`, in place, with each glyph's drift
 * bounded by its own budget.
 *
 * Three slow sines at incommensurable rates, offset per glyph by its phase.
 * Not curl noise: the field never has to be divergence free, because nothing
 * is being advected through it, and three sines cost three multiplies where a
 * gradient of a noise field costs six lookups.
 *
 * `amplitude` is what the host asked for and is a CEILING, not the offset: a
 * glyph moves by the lesser of it and `budgets[g]`. One global amplitude is
 * what let a glyph seeded near the face translate straight through the skin,
 * and the glyphs with the least room are exactly the ones a viewer is looking
 * at.
 *
 * The cap is on the offset's LENGTH, not on its components: the three sines
 * peak together on the diagonal, at 1.58 times what any one axis shows, so
 * per-axis clamping would still leave the corner of the cycle outside the
 * skin. Below the cap the offset is bit-for-bit what an unbounded field
 * produced, so a default-drift head is unchanged and a damped one stays
 * damped.
 */
export function interiorDriftTargets(
  targets: Float32Array,
  rest: Float32Array,
  phases: Float32Array,
  budgets: Float32Array,
  count: number,
  time: number,
  amplitude: number,
): void {
  const n = Math.max(0, Math.floor(count));
  for (let g = 0; g < n; g++) {
    const phase = phases[g] ?? 0;
    const ox = Math.sin(time * DRIFT_RATE_X + phase);
    const oy = Math.sin(time * DRIFT_RATE_Y + phase * 1.7 + 1.3) * DRIFT_VERTICAL_SCALE;
    const oz = Math.sin(time * DRIFT_RATE_Z + phase * 2.3 + 2.6);
    const budget = budgets[g] ?? 0;
    const span = Math.hypot(ox, oy, oz);
    // An infinite budget takes the first branch, which is the untouched
    // amplitude.
    const scale = span * amplitude <= budget ? amplitude : span > 0 ? budget / span : 0;
    targets[g * 3] = (rest[g * 3] ?? 0) + ox * scale;
    targets[g * 3 + 1] = (rest[g * 3 + 1] ?? 0) + oy * scale;
    targets[g * 3 + 2] = (rest[g * 3 + 2] ?? 0) + oz * scale;
  }
}

/**
 * Pull every glyph back inside the ball of radius `budgets[g]` about its own
 * carried rest position, in place, and take the outward velocity with it.
 *
 * Bounding the drift TARGET is not enough. The spring chases its target through
 * world space, under-damped on purpose, so a head turn drags a glyph out and
 * the settle overshoots on the way back: at any inertia above 0 the glyph's
 * actual position is not the bounded one. This is the last word on where a
 * glyph may be, and it runs after the integrator.
 *
 * The outward radial component of the velocity is dropped when a glyph is
 * caught, because a spring that keeps pushing into the wall would hold the
 * glyph pinned against it for as long as the head keeps turning, which reads as
 * a glyph stuck to the inside of the skin. The tangential component survives,
 * so a caught glyph slides rather than stops.
 */
export function interiorContain(
  positions: Float32Array,
  velocities: Float32Array,
  centres: Float32Array,
  budgets: Float32Array,
  count: number,
): void {
  const n = Math.max(0, Math.floor(count));
  for (let g = 0; g < n; g++) {
    const budget = budgets[g] ?? 0;
    if (!Number.isFinite(budget)) continue;
    const i = g * 3;
    const dx = (positions[i] ?? 0) - (centres[i] ?? 0);
    const dy = (positions[i + 1] ?? 0) - (centres[i + 1] ?? 0);
    const dz = (positions[i + 2] ?? 0) - (centres[i + 2] ?? 0);
    const dist = Math.hypot(dx, dy, dz);
    if (dist <= budget) continue;
    if (!(dist > 0)) {
      positions[i] = centres[i] ?? 0;
      positions[i + 1] = centres[i + 1] ?? 0;
      positions[i + 2] = centres[i + 2] ?? 0;
      continue;
    }
    const nx = dx / dist;
    const ny = dy / dist;
    const nz = dz / dist;
    positions[i] = (centres[i] ?? 0) + nx * budget;
    positions[i + 1] = (centres[i + 1] ?? 0) + ny * budget;
    positions[i + 2] = (centres[i + 2] ?? 0) + nz * budget;
    const outward =
      (velocities[i] ?? 0) * nx + (velocities[i + 1] ?? 0) * ny + (velocities[i + 2] ?? 0) * nz;
    if (outward <= 0) continue;
    velocities[i] = (velocities[i] ?? 0) - nx * outward;
    velocities[i + 1] = (velocities[i + 1] ?? 0) - ny * outward;
    velocities[i + 2] = (velocities[i + 2] ?? 0) - nz * outward;
  }
}

/**
 * Brightness scale for a glyph at view depth `depth`, given the field's own
 * front-to-back span this frame.
 *
 * Normalised against the field rather than against the camera's clip range, so
 * the head reads as having depth at any distance, and a degenerate span (one
 * glyph, or a camera looking along the field's thin axis) dims nothing rather
 * than dividing by zero.
 */
export function interiorDepthDim(depth: number, near: number, far: number, fade: number): number {
  const span = far - near;
  if (!(span > 0)) return 1;
  return 1 - clamp01(fade) * clamp01((depth - near) / span);
}
