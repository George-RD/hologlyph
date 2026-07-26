/**
 * Shared rig schema validation and LoadedAvatar assembly for hologlyph.
 *
 * The schema (dec.asset-rig-schema) fixes one canonical naming vocabulary for
 * every shipped bust: a known set of viseme/expression morph targets and a small
 * set of skeleton bones. Consumers (motion, speech) drive blendshapes purely by
 * these canonical names, so a rig that is missing some of them still loads but
 * is flagged non-conformant.
 *
 * All logic here is pure and works on in-memory THREE objects, so it is fully
 * unit-testable without loading a GLB over the network.
 */

import { InterleavedBuffer, InterleavedBufferAttribute } from 'three';
import type * as THREE from 'three';
import {
  RIG_VISEME_MORPHS,
  RIG_TONGUE_MORPHS,
  RIG_EXPRESSION_MORPHS,
  RIG_BONES,
  clamp01,
  type LoadedAvatar,
} from '../contracts';
import { readSilhouetteHull } from './hull';

/** Canonical morph-target names every conformant rig must expose. */
const CANONICAL_MORPHS: readonly string[] = [
  ...RIG_VISEME_MORPHS,
  ...RIG_TONGUE_MORPHS,
  ...RIG_EXPRESSION_MORPHS,
];

/** Bone keys we resolve by their canonical object name. */
const BONE_KEYS = Object.keys(RIG_BONES) as (keyof typeof RIG_BONES)[];

/**
 * Result of validating a loaded scene against the shared rig schema.
 * `conformant` is true only when every canonical morph and bone is present.
 */
export interface RigReport {
  missingMorphs: string[];
  missingBones: string[];
  conformant: boolean;
}

/** Warn at most once per process about a non-conformant rig (dec.performance-budget). */
let warnedNonConformant = false;

function isMorphMesh(mesh: THREE.Mesh): boolean {
  const dict = mesh.morphTargetDictionary;
  if (!dict) return false;
  for (const name of CANONICAL_MORPHS) {
    if (name in dict) return true;
  }
  return false;
}

function collectBones(
  root: THREE.Object3D,
): Partial<Record<keyof typeof RIG_BONES, THREE.Bone>> {
  const bones: Partial<Record<keyof typeof RIG_BONES, THREE.Bone>> = {};
  for (const key of BONE_KEYS) {
    const boneName = RIG_BONES[key];
    const found = root.getObjectByName(boneName);
    if (found && (found as THREE.Bone).isBone) {
      bones[key] = found as THREE.Bone;
    }
  }
  return bones;
}

/**
 * Validate a loaded scene graph against the canonical rig schema.
 * Never throws: returns a structured report describing what is missing.
 */
export function validateRig(root: THREE.Object3D): RigReport {
  const foundMorphs = new Set<string>();

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!isMorphMesh(mesh)) return;
    const dict = mesh.morphTargetDictionary;
    if (!dict) return;
    for (const name of Object.keys(dict)) {
      if (CANONICAL_MORPHS.includes(name)) foundMorphs.add(name);
    }
  });

  const missingBones: string[] = [];
  for (const key of BONE_KEYS) {
    const boneName = RIG_BONES[key];
    const found = root.getObjectByName(boneName);
    if (!found || !(found as THREE.Bone).isBone) {
      missingBones.push(boneName);
    }
  }

  const missingMorphs = CANONICAL_MORPHS.filter((n) => !foundMorphs.has(n));
  const conformant = missingMorphs.length === 0 && missingBones.length === 0;
  return { missingMorphs, missingBones, conformant };
}

/**
 * Assemble a LoadedAvatar from an already-parsed scene graph.
 *
 * - Collects the meshes that carry canonical morph targets.
 * - Resolves canonical bones by name.
 * - Warns once (console.warn) on a non-conformant rig but still returns a usable avatar.
 * - `setMorph`/`getMorph` operate across every morph mesh, clamped to [0,1].
 * - `dispose()` is idempotent and frees geometries, materials, and textures.
 */
const FEATURE_GROUPS = {
  lips: ['viseme_pp', 'viseme_ff', 'viseme_ou', 'mouth_round', 'viseme_ss'],
  jaw: ['jaw_open', 'viseme_aa'],
  eyelid: ['exp_blink', 'exp_blink_l', 'exp_blink_r'],
  brow: ['exp_brow_up', 'exp_brow_down'],
} as const;

const ZONE_ATTR = {
  lips: 'aLips',
  jaw: 'aJaw',
  eyelid: 'aEyelid',
  brow: 'aBrow',
} as const;

/**
 * Upper bound on vertices we will ray-bake thickness for, per mesh.
 *
 * The bake is synchronous main-thread work at avatar load. Measured warm on
 * an M2 over the shipped bust's 7,472-vertex skin mesh: 700,259 intersection
 * tests in 72 ms, so roughly 10 us per vertex and 100 ns per test. The shipped bust and its mouth interior both sit well under this cap;
 * a pathological custom rig would otherwise stall the page for seconds. Over
 * budget, `aThickness` stays zero, which disables Beer-Lambert absorption and
 * leaves the flat translucent look (degrade, do not throw).
 */
export const THICKNESS_VERTEX_BUDGET = 12_000;

/** Matching cap on triangles, so a dense soup cannot blow the per-ray cost. */
export const THICKNESS_TRIANGLE_BUDGET = 40_000;

/**
 * Cap on triangle-to-cell references in the acceleration grid.
 *
 * Bucketing files a triangle under every cell its bounding box touches, so a
 * mesh of long thin slivers can reference nearly the whole grid per triangle.
 * The shipped bust needs about 5 references per triangle; 8 leaves ample room
 * for a legitimately awkward rig while keeping the table under 1.5 MB and the
 * counting pass linear.
 */
export const THICKNESS_CELL_REFERENCE_BUDGET = 8 * THICKNESS_TRIANGLE_BUDGET;

/**
 * Cap on ray-triangle intersection tests for one avatar load.
 *
 * The three budgets above are per-mesh shape limits and bound the grid, not
 * the walk through it: a mesh that files every reference along the ray paths
 * would still run vertices times references tests, and a rig of many legal
 * meshes would add up without limit. One `ThicknessBudget` is threaded through
 * every `bakeThickness` call for an avatar, so this is the whole allowance. Measured on an M2, one test costs about 100 ns and the
 * shipped bust's skin mesh needs 700,000 of them (72 ms). Two million caps the
 * whole avatar near a quarter of a second, which is the most synchronous work
 * a drop-in library may reasonably take at load.
 */
export const THICKNESS_WORK_BUDGET = 2_000_000;

/**
 * True when `geo` is too large for `computeThickness` to bake without stalling.
 *
 * Callers check this first so an over-budget mesh costs nothing at all, not
 * even the zeroed result array.
 */
export function thicknessOverBudget(geo: THREE.BufferGeometry): boolean {
  const count = (geo.attributes.position as THREE.BufferAttribute | undefined)?.count ?? 0;
  const indexed = geo.index?.count;
  // Floor, so the preflight counts the same usable triangles the bake does.
  const tris = Math.floor((indexed ?? count) / 3);
  return count > THICKNESS_VERTEX_BUDGET || tris > THICKNESS_TRIANGLE_BUDGET;
}

/**
 * Mutable work allowance shared by every `bakeThickness` call in one avatar
 * load, so a rig made of many individually legal meshes cannot add up to an
 * unbounded main-thread stall.
 */
export interface ThicknessBudget {
  remaining: number;
}

/** A fresh allowance. One per avatar, not one per mesh. */
export function createThicknessBudget(): ThicknessBudget {
  return { remaining: THICKNESS_WORK_BUDGET };
}

/**
 * Per-vertex body thickness: the distance from each vertex to the far interior
 * surface along the inward normal, normalised to [0,1] by the largest hit.
 *
 * Consumed by the glass skin material for Beer-Lambert absorption, so thick
 * regions (cranium, cheeks) absorb more than thin ones (nose, chin, ears).
 * A uniform grid keeps the raycast roughly linear in vertex count; vertices
 * whose ray escapes through an open boundary inherit their neighbours' value
 * so the attribute has no speckle.
 *
 * Every budget breach returns an all-zero mask, which disables absorption and
 * leaves the flat translucent look (degrade, do not throw).
 *
 * Exported for tests; `bakeThickness` is the production caller.
 */
export function computeThickness(
  geo: THREE.BufferGeometry,
  budget: ThicknessBudget = createThicknessBudget(),
): Float32Array {
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  const nor = geo.attributes.normal as THREE.BufferAttribute | undefined;
  const N = pos?.count ?? 0;
  if (!pos || !nor || N === 0) return new Float32Array(N);

  const index = geo.index;
  const tris = Math.floor((index ? index.count : N) / 3);

  const out = new Float32Array(N);
  if (thicknessOverBudget(geo) || tris === 0) return out;

  // Non-indexed geometry is a flat triangle soup: consecutive position triples
  // are its triangles. Materialising those indices once costs 12 bytes per
  // triangle and keeps the intersection loop a flat array read, which is worth
  // far more than the allocation: that loop runs about 700,000 times for the
  // shipped bust.
  let ia = index?.array;
  if (!ia) {
    const implicit = new Uint32Array(tris * 3);
    for (let i = 0; i < implicit.length; i++) implicit[i] = i;
    ia = implicit;
  }

  // Only vertices a triangle actually uses take part. A stray unreferenced
  // position (glTF exports leave them, and a synthesised index drops a
  // trailing one or two) would otherwise stretch the bounding box, coarsen
  // every tolerance derived from it, and cast a ray that can never be hit.
  const referenced = new Uint8Array(N);
  for (let k = 0; k < tris * 3; k++) referenced[ia[k] ?? 0] = 1;

  const px = new Float32Array(N);
  const py = new Float32Array(N);
  const pz = new Float32Array(N);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < N; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    px[i] = x; py[i] = y; pz[i] = z;
    if (!referenced[i]) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  // Every tolerance below is relative to the model's own extent, so a rig
  // authored in millimetres behaves exactly like one authored in metres.
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  if (!(diagonal > 0)) return out;

  // One grid cell per triangle on average keeps bucket occupancy near 1.
  const G = Math.min(48, Math.max(4, Math.round(Math.cbrt(tris)) || 4));
  const cx = (maxX - minX) / G || diagonal;
  const cy = (maxY - minY) / G || diagonal;
  const cz = (maxZ - minZ) / G || diagonal;
  const cells = G * G * G;
  const clampG = (v: number): number => (v < 0 ? 0 : v > G - 1 ? G - 1 : v);
  const cellOf = (gx: number, gy: number, gz: number): number => (gz * G + gy) * G + gx;

  // Two passes over the triangle list build a counting-sorted bucket table:
  // no per-triangle array allocation, so the bake produces no garbage.
  const counts = new Uint32Array(cells);
  const span = new Int32Array(6);
  const spanOf = (t: number): void => {
    const a = ia[t * 3] ?? 0, b = ia[t * 3 + 1] ?? 0, c = ia[t * 3 + 2] ?? 0;
    const ax = px[a] ?? 0, bx = px[b] ?? 0, ccx = px[c] ?? 0;
    const ay = py[a] ?? 0, by = py[b] ?? 0, ccy = py[c] ?? 0;
    const az = pz[a] ?? 0, bz = pz[b] ?? 0, ccz = pz[c] ?? 0;
    span[0] = clampG(Math.floor((Math.min(ax, bx, ccx) - minX) / cx));
    span[1] = clampG(Math.floor((Math.max(ax, bx, ccx) - minX) / cx));
    span[2] = clampG(Math.floor((Math.min(ay, by, ccy) - minY) / cy));
    span[3] = clampG(Math.floor((Math.max(ay, by, ccy) - minY) / cy));
    span[4] = clampG(Math.floor((Math.min(az, bz, ccz) - minZ) / cz));
    span[5] = clampG(Math.floor((Math.max(az, bz, ccz) - minZ) / cz));
  };
  let references = 0;
  for (let t = 0; t < tris; t++) {
    spanOf(t);
    references +=
      ((span[1] ?? 0) - (span[0] ?? 0) + 1) *
      ((span[3] ?? 0) - (span[2] ?? 0) + 1) *
      ((span[5] ?? 0) - (span[4] ?? 0) + 1);
    if (references > THICKNESS_CELL_REFERENCE_BUDGET) return out;
    for (let z = span[4] ?? 0; z <= (span[5] ?? 0); z++)
      for (let y = span[2] ?? 0; y <= (span[3] ?? 0); y++)
        for (let x = span[0] ?? 0; x <= (span[1] ?? 0); x++) {
          const cell = cellOf(x, y, z);
          counts[cell] = (counts[cell] ?? 0) + 1;
        }
  }
  const starts = new Uint32Array(cells + 1);
  let acc = 0;
  for (let i = 0; i < cells; i++) {
    starts[i] = acc;
    acc += counts[i] ?? 0;
  }
  starts[cells] = acc;
  const items = new Uint32Array(acc);
  const cursor = starts.slice(0, cells);
  for (let t = 0; t < tris; t++) {
    spanOf(t);
    for (let z = span[4] ?? 0; z <= (span[5] ?? 0); z++)
      for (let y = span[2] ?? 0; y <= (span[3] ?? 0); y++)
        for (let x = span[0] ?? 0; x <= (span[1] ?? 0); x++) {
          const cell = cellOf(x, y, z);
          const at = cursor[cell] ?? 0;
          items[at] = t;
          cursor[cell] = at + 1;
        }
  }

  // Moller-Trumbore against the buckets a DDA walk crosses, nearest hit wins.
  // Triangles incident on the origin vertex are skipped so the ray cannot
  // return its own fan at distance ~0 and collapse the whole attribute.
  const EPS = diagonal * 1e-6;
  const DET_EPS = diagonal * diagonal * 1e-12;
  const maxSteps = G * 3;
  // A triangle spans many cells, so the same ray meets it repeatedly as it
  // walks. Stamping the last ray that tested each triangle keeps the work
  // linear in distinct triangles rather than in bucket entries.
  const stamp = new Int32Array(tris).fill(-1);
  let hitMax = 0;
  for (let i = 0; i < N; i++) {
    if (!referenced[i]) continue;
    const ox = px[i] ?? 0, oy = py[i] ?? 0, oz = pz[i] ?? 0;
    let dx = -nor.getX(i), dy = -nor.getY(i), dz = -nor.getZ(i);
    const dl = Math.hypot(dx, dy, dz);
    if (dl === 0) {
      // Degenerate normal: no ray to cast, so mark it unresolved and let the
      // fill below take the neighbourhood value rather than claim zero.
      out[i] = -1;
      continue;
    }
    dx /= dl; dy /= dl; dz /= dl;
    let gx = clampG(Math.floor((ox - minX) / cx));
    let gy = clampG(Math.floor((oy - minY) / cy));
    let gz = clampG(Math.floor((oz - minZ) / cz));
    // A zero direction component never crosses a plane on that axis, so it
    // gets step 0 and an infinite crossing time instead of a fake tiny one.
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const dtX = stepX === 0 ? Infinity : Math.abs(cx / dx);
    const dtY = stepY === 0 ? Infinity : Math.abs(cy / dy);
    const dtZ = stepZ === 0 ? Infinity : Math.abs(cz / dz);
    let tMaxX = stepX === 0 ? Infinity : Math.abs((minX + (gx + (dx > 0 ? 1 : 0)) * cx - ox) / dx);
    let tMaxY = stepY === 0 ? Infinity : Math.abs((minY + (gy + (dy > 0 ? 1 : 0)) * cy - oy) / dy);
    let tMaxZ = stepZ === 0 ? Infinity : Math.abs((minZ + (gz + (dz > 0 ? 1 : 0)) * cz - oz) / dz);
    let best = Infinity;
    for (let step = 0; step < maxSteps; step++) {
      const cell = cellOf(gx, gy, gz);
      const from = starts[cell] ?? 0;
      const to = starts[cell + 1] ?? 0;
      for (let k = from; k < to; k++) {
        const t = items[k] ?? 0;
        if (stamp[t] === i) continue;
        stamp[t] = i;
        if (budget.remaining-- <= 0) return new Float32Array(N);
        const a = ia[t * 3] ?? 0, b = ia[t * 3 + 1] ?? 0, c = ia[t * 3 + 2] ?? 0;
        if (a === i || b === i || c === i) continue;
        const axp = px[a] ?? 0, ayp = py[a] ?? 0, azp = pz[a] ?? 0;
        const e1x = (px[b] ?? 0) - axp, e1y = (py[b] ?? 0) - ayp, e1z = (pz[b] ?? 0) - azp;
        const e2x = (px[c] ?? 0) - axp, e2y = (py[c] ?? 0) - ayp, e2z = (pz[c] ?? 0) - azp;
        const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
        const det = e1x * hx + e1y * hy + e1z * hz;
        if (det > -DET_EPS && det < DET_EPS) continue;
        const inv = 1 / det;
        const sx = ox - axp, sy = oy - ayp, sz = oz - azp;
        const u = (sx * hx + sy * hy + sz * hz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const hit = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (hit > EPS && hit < best) best = hit;
      }
      // Buckets hold triangle AABB overlaps, so a triangle filed under this
      // cell can be hit beyond the cell exit while a nearer surface waits in
      // the next cell. Only stop once the best hit is inside the span already
      // traversed.
      if (best <= Math.min(tMaxX, tMaxY, tMaxZ)) break;
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) { gx += stepX; if (gx < 0 || gx >= G) break; tMaxX += dtX; }
        else { gz += stepZ; if (gz < 0 || gz >= G) break; tMaxZ += dtZ; }
      } else if (tMaxY < tMaxZ) {
        gy += stepY; if (gy < 0 || gy >= G) break; tMaxY += dtY;
      } else {
        gz += stepZ; if (gz < 0 || gz >= G) break; tMaxZ += dtZ;
      }
      if (!Number.isFinite(Math.min(tMaxX, tMaxY, tMaxZ))) break;
    }
    if (best < Infinity) {
      out[i] = best;
      if (best > hitMax) hitMax = best;
    } else {
      out[i] = -1;
    }
  }
  if (hitMax <= 0) return new Float32Array(N);

  // Escaped rays (open boundaries such as the neck cut) and the odd grazing
  // miss inherit the mean of their hit neighbours, then one Laplacian pass
  // removes the remaining ring speckle around folds.
  const sum = new Float32Array(N);
  const deg = new Uint32Array(N);
  const link = (a: number, b: number): void => {
    const vb = out[b] ?? 0;
    if (vb < 0) return;
    sum[a] = (sum[a] ?? 0) + vb;
    deg[a] = (deg[a] ?? 0) + 1;
  };
  const linkAll = (): void => {
    sum.fill(0);
    deg.fill(0);
    for (let t = 0; t < tris; t++) {
      const a = ia[t * 3] ?? 0, b = ia[t * 3 + 1] ?? 0, c = ia[t * 3 + 2] ?? 0;
      link(a, b); link(a, c); link(b, a); link(b, c); link(c, a); link(c, b);
    }
  };
  for (let pass = 0; pass < 3; pass++) {
    linkAll();
    let unresolved = 0;
    for (let i = 0; i < N; i++) {
      if ((out[i] ?? 0) >= 0) continue;
      const d = deg[i] ?? 0;
      if (d > 0) out[i] = (sum[i] ?? 0) / d;
      else unresolved++;
    }
    if (unresolved === 0) break;
  }
  linkAll();
  for (let i = 0; i < N; i++) {
    const raw = out[i] ?? 0;
    const d = deg[i] ?? 0;
    const smoothed = raw < 0 ? 0 : d > 0 ? raw * 0.5 + ((sum[i] ?? 0) / d) * 0.5 : raw;
    out[i] = Math.min(1, Math.max(0, smoothed / hitMax));
  }
  return out;
}

export function bakeFeatureMasks(mesh: THREE.Mesh): void {
  const geo = mesh.geometry;
  if (!geo) return;
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos) return;
  const N = pos.count;
  if (!N) return;

  const dict = mesh.morphTargetDictionary || {};
  const morphs = ((geo.morphAttributes as Record<string, unknown> | undefined)?.position as THREE.BufferAttribute[] | undefined) || [];
  const nor = geo.attributes.normal as THREE.BufferAttribute | undefined;

  const out = {
    aLips: new Float32Array(N),
    aJaw: new Float32Array(N),
    aEyelid: new Float32Array(N),
    aBrow: new Float32Array(N),
    aCavity: new Float32Array(N),
    aNose: new Float32Array(N),
    aSocket: new Float32Array(N),
  };

  for (const [g, list] of Object.entries(FEATURE_GROUPS)) {
    const attrName = ZONE_ATTR[g as keyof typeof ZONE_ATTR];
    const arr = out[attrName];
    const isRelative = Boolean(geo.morphTargetsRelative);
    let gmax = 0;
    for (const nm of list) {
      const idx = dict[nm];
      if (idx === undefined || !morphs[idx]) continue;
      const m = morphs[idx];
      for (let i = 0; i < N; i++) {
        const dx = isRelative ? m.getX(i) : m.getX(i) - pos.getX(i);
        const dy = isRelative ? m.getY(i) : m.getY(i) - pos.getY(i);
        const dz = isRelative ? m.getZ(i) : m.getZ(i) - pos.getZ(i);
        const mag = Math.hypot(dx, dy, dz);
        const current = arr[i] ?? 0;
        if (mag > current) arr[i] = mag;
        const stored = arr[i] ?? 0;
        if (stored > gmax) gmax = stored;
      }
    }
    if (gmax > 0) {
      for (let i = 0; i < N; i++) arr[i] = Math.min(1, (arr[i] ?? 0) / gmax);
    }
  }

  // Vermilion lip band refinement: tight ellipsoidal falloff around positive-weight centroid
  {
    const lips = out.aLips;
    let cx = 0, cy = 0, cz = 0, cw = 0, wmax = 0;
    for (let i = 0; i < N; i++) {
      const v = lips[i] ?? 0;
      if (v > wmax) wmax = v;
    }
    const cut = wmax * 0.8;
    if (cut > 0) {
      for (let i = 0; i < N; i++) {
        const w = lips[i] ?? 0;
        if (w < cut) continue;
        cx += pos.getX(i) * w;
        cy += pos.getY(i) * w;
        cz += pos.getZ(i) * w;
        cw += w;
      }
      if (cw > 0) {
        cx /= cw;
        cy /= cw;
        cz /= cw;
        const RX = 0.16, RY = 0.075, RZ = 0.12;
        for (let i = 0; i < N; i++) {
          const dx = (pos.getX(i) - cx) / RX;
          const dy = (pos.getY(i) - cy) / RY;
          const dz = (pos.getZ(i) - cz) / RZ;
          lips[i] = (lips[i] ?? 0) * Math.exp(-(dx * dx + dy * dy + dz * dz));
        }
      }
    }
  }

  // Geometric cavity
  const cav = out.aCavity;
  const idxAttr = geo.index;
  if (nor && idxAttr) {
    const acc = new Float64Array(N);
    const cnt = new Uint32Array(N);
    const ia = idxAttr.array;
    const add = (a: number, b: number) => {
      const dx = pos.getX(b) - pos.getX(a);
      const dy = pos.getY(b) - pos.getY(a);
      const dz = pos.getZ(b) - pos.getZ(a);
      const len = Math.hypot(dx, dy, dz) || 1;
      acc[a] = (acc[a] ?? 0) + (dx / len) * nor.getX(a) + (dy / len) * nor.getY(a) + (dz / len) * nor.getZ(a);
      cnt[a] = (cnt[a] ?? 0) + 1;
    };
    for (let t = 0; t < ia.length; t += 3) {
      const a = ia[t], b = ia[t + 1], c = ia[t + 2];
      if (a === undefined || b === undefined || c === undefined) continue;
      add(a, b); add(a, c); add(b, a); add(b, c); add(c, a); add(c, b);
    }
    let cmax = 0;
    for (let i = 0; i < N; i++) {
      const count = cnt[i] ?? 0;
      const v = count > 0 ? Math.max(0, (acc[i] ?? 0) / count) : 0;
      cav[i] = v;
      if (v > cmax) cmax = v;
    }
    if (cmax > 0) {
      for (let i = 0; i < N; i++) cav[i] = Math.min(1, ((cav[i] ?? 0) / cmax) * 1.3);
    }
  }

  // Nose zone heuristic
  const noseArr = out.aNose;
  let zmax = -1e9;
  for (let i = 0; i < N; i++) {
    const y = pos.getY(i);
    if (y > 0.02 && y < 0.34 && Math.abs(pos.getX(i)) < 0.17) {
      if (pos.getZ(i) > zmax) zmax = pos.getZ(i);
    }
  }
  if (zmax > -1e9) {
    for (let i = 0; i < N; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (y <= 0.0 || y >= 0.36 || Math.abs(x) >= 0.17) continue;
      const depth = Math.max(0, Math.min(1, (z - (zmax - 0.30)) / 0.30));
      const lateral = Math.max(0, 1 - Math.abs(x) / 0.17);
      const band = Math.min(1, Math.min((y - 0.0) / 0.06, (0.36 - y) / 0.06));
      noseArr[i] = depth * depth * lateral * band;
    }
  }

  // Socket zone
  const sockArr = out.aSocket;
  const lid = out.aEyelid;
  const c = { l: { x: 0, y: 0, z: 0, w: 0 }, r: { x: 0, y: 0, z: 0, w: 0 } };
  for (let i = 0; i < N; i++) {
    const w = lid[i] ?? 0;
    if (w < 0.3) continue;
    const s = pos.getX(i) < 0 ? c.l : c.r;
    s.x += pos.getX(i) * w;
    s.y += pos.getY(i) * w;
    s.z += pos.getZ(i) * w;
    s.w += w;
  }
  if (c.l.w > 0) { c.l.x /= c.l.w; c.l.y /= c.l.w; c.l.z /= c.l.w; }
  if (c.r.w > 0) { c.r.x /= c.r.w; c.r.y /= c.r.w; c.r.z /= c.r.w; }
  const R = 0.16;
  if (c.l.w > 0 && c.r.w > 0) {
    for (let i = 0; i < N; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const s = x < 0 ? c.l : c.r;
      const d2 = (x - s.x) ** 2 + (y - s.y) ** 2 + (z - s.z) ** 2;
      sockArr[i] = Math.exp(-d2 / (R * R));
    }
  }

  const primary = new InterleavedBuffer(new Float32Array(N * 4), 4);
  const secondary = new InterleavedBuffer(new Float32Array(N * 4), 4);
  const packed = [
    ['aLips', primary, 0, out.aLips],
    ['aJaw', primary, 1, out.aJaw],
    ['aEyelid', primary, 2, out.aEyelid],
    ['aBrow', primary, 3, out.aBrow],
    ['aCavity', secondary, 0, out.aCavity],
    ['aNose', secondary, 1, out.aNose],
    ['aSocket', secondary, 2, out.aSocket],
    // Declared, not filled. The raycast is the one expensive mask, and only a
    // glass-shaded mesh ever samples it, so `bakeThickness` fills it later for
    // exactly those meshes. Zero here means "no absorption", never a broken
    // shader on a mesh that keeps its authored material.
    ['aThickness', secondary, 3, new Float32Array(N)],
  ] as const;
  for (const [name, buffer, offset, values] of packed) {
    for (let index = 0; index < N; index++) {
      buffer.array[index * buffer.stride + offset] = values[index] ?? 0;
    }
    geo.setAttribute(name, new InterleavedBufferAttribute(buffer, 1, offset));
  }
}

/**
 * Fill the `aThickness` mask declared by `bakeFeatureMasks`.
 *
 * Split out because the raycast dominates mask baking (72 ms for the shipped
 * bust's skin mesh against 166 ms for every mesh in the scene) and
 * only meshes wearing the glass skin material read the result. The caller that
 * decides which meshes those are owns the call, and passes one `budget` for
 * the whole avatar so a rig of many legal meshes still cannot stall the page.
 *
 * No-op when the attribute is absent, so an avatar that skipped mask baking
 * still renders, and when the geometry is over budget, so an oversized mesh
 * costs nothing at all rather than a discarded zero array.
 */
export function bakeThickness(
  mesh: THREE.Mesh,
  budget: ThicknessBudget = createThicknessBudget(),
): void {
  const geo = mesh.geometry;
  const attr = geo?.attributes.aThickness;
  if (!attr || budget.remaining <= 0 || thicknessOverBudget(geo)) return;
  const thickness = computeThickness(geo, budget);
  for (let i = 0; i < attr.count; i++) attr.setX(i, thickness[i] ?? 0);
  // `bakeFeatureMasks` declares this as one channel of an interleaved buffer,
  // and it is the BUFFER that carries the upload flag. A rig that arrives
  // with a plain `aThickness` attribute of its own is legal glTF, though, and
  // used to throw here on `attr.data`. Degrade, do not throw.
  const interleaved = (attr as THREE.InterleavedBufferAttribute).data;
  if (interleaved) interleaved.needsUpdate = true;
  else attr.needsUpdate = true;
}
export function buildLoadedAvatar(
  root: THREE.Object3D,
  animations: THREE.AnimationClip[] = [],
): LoadedAvatar {
  const report = validateRig(root);
  if (!report.conformant && !warnedNonConformant) {
    warnedNonConformant = true;
    console.warn(
      `[hologlyph] Non-conformant rig loaded: missing morphs [${report.missingMorphs.join(', ')}], ` +
        `missing bones [${report.missingBones.join(', ')}]. The avatar still renders, ` +
        `but some expressions or visemes may be unavailable.`,
    );
  }

  const morphMeshes: THREE.Mesh[] = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      if (isMorphMesh(mesh)) morphMeshes.push(mesh);
      bakeFeatureMasks(mesh);
    }
  });

  const bones = collectBones(root);
  const silhouetteHull = readSilhouetteHull(root);

  let disposed = false;

  const setMorph = (name: string, weight: number): void => {
    const w = clamp01(weight);
    for (const mesh of morphMeshes) {
      const dict = mesh.morphTargetDictionary;
      const infl = mesh.morphTargetInfluences;
      if (!dict || !infl) continue;
      const idx = dict[name];
      if (idx === undefined) continue;
      infl[idx] = w;
    }
  };

  const getMorph = (name: string): number => {
    for (const mesh of morphMeshes) {
      const dict = mesh.morphTargetDictionary;
      const infl = mesh.morphTargetInfluences;
      if (!dict || !infl) continue;
      const idx = dict[name];
      if (idx === undefined) continue;
      return infl[idx] ?? 0;
    }
    return 0;
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        for (const value of Object.values(material)) {
          const texture = value as THREE.Texture;
          if (texture?.isTexture) texture.dispose();
        }
        material.dispose();
      }
    });
  };

  return {
    root: root as THREE.Group,
    morphMeshes,
    bones,
    silhouetteHull,
    animations,
    setMorph,
    getMorph,
    dispose,
  };
}
