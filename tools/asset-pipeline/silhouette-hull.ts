/**
 * hologlyph asset pipeline - silhouette hull bake.
 *
 * Build-time only (dec.hologlyph-blueprint: the pipeline lives under tools/,
 * never in src/). Produces the low-poly outline hull that
 * `dec.liquid-glass-architecture` names as the shared contract between the
 * backdrop ladder and the shape stages: baked offline, projected on the CPU per
 * frame, never read back from the GPU.
 *
 * The hull is an OUTER bound, not a fit. Every point the runtime can drive the
 * mesh to lies inside it, so the 2D convex hull of the projected hull points
 * contains the rendered silhouette for any camera. Two facts make that
 * provable rather than sampled:
 *
 *  - Skinning. Each vertex is bound to its joints with weights that sum to one,
 *    so its skinned position is a convex combination of its per-joint rigid
 *    images. Building one polytope per joint over every vertex that joint
 *    touches means the union of the transformed polytopes contains the skinned
 *    result whatever the pose. A joint whose geometry provably stays inside the
 *    primary polytope under any rotation of its own bone contributes no
 *    polytope at all (the eyeballs of the shipped bust).
 *  - Morphs. Three applies morph targets additively, so the positions one
 *    vertex can reach form a zonotope and its support in a direction is the
 *    base projection plus the positive delta projections. Which deltas may sum
 *    is bounded by `MORPH_GROUPS` below, which mirrors how MotionEngine
 *    composes weights: the public surface (`Engine.motion`) exposes semantic
 *    expressions and viseme frames, not raw per-morph writes, so the sum of an
 *    arbitrary thirty morphs at full weight is not reachable and would inflate
 *    the hull by more than half the head's height.
 *
 * The polytope itself is the intersection of `DIRECTION_COUNT` support
 * half-spaces. Its vertices come from intersecting plane triples and keeping
 * the ones that satisfy every half-space, which is exact for a shape this size
 * and needs no hull algorithm.
 */

import type { Document, Node as GLTFNode, Primitive } from '@gltf-transform/core';

/** Schema version written into the GLB scene extras. */
export const SILHOUETTE_HULL_VERSION = 1;

/** Extras key on the glTF scene carrying the baked hull. */
export const SILHOUETTE_HULL_KEY = 'hologlyphSilhouetteHull';

/**
 * Support directions for the joint carrying most of the mesh. Thirty-two
 * directions yield a 60-vertex polytope, which tightens the compositor clip
 * toward the silhouette while staying within its measured per-frame budget.
 */
export const DIRECTION_COUNT = 32;

/** Support directions for any further joint that needs its own polytope. */
export const SECONDARY_DIRECTION_COUNT = 8;

/** Hard ceiling on baked points; the bake fails rather than blow the budget. */
export const MAX_HULL_POINTS = 60;

/** Coordinates are rounded to this many decimals so the bake is byte-stable. */
const ROUND_DECIMALS = 6;

/**
 * Outward slack added to every support plane, in model units.
 *
 * Rounding a vertex to six decimals can move it inward by up to 5e-7 per axis
 * and the runtime narrows the same coordinates to float32 (about 3e-8 at this
 * scale), so an unpadded bound would be a hair inside the reachable set. Two
 * micrometres covers both with room to spare and is 0.002 px on a 512 px
 * render, which keeps the containment claim strict rather than approximate.
 */
const SUPPORT_PADDING = 2e-6;

/**
 * How many morph targets of one anatomical group may add their displacement at
 * once, read off `MotionEngine.update`:
 *
 *  - mouth: two. The library's own speech path emits one viseme at full weight
 *    per frame (`weightsForViseme`), and the attack/release smoothing means the
 *    releasing shape and the attacking one overlap. This is the one budget that
 *    costs anything: raising it to three widens the hull 0.112 downward and
 *    0.046 forward on a bust 1.0 tall, so it is also the one a host can exceed,
 *    by handing `applyVisemeFrame` a frame that drives more than two mouth
 *    morphs at once. `VisemeFrame` documents that, and MotionEngine warns.
 *  - tongue: two. `tongueTargets` derives three values from the viseme frame
 *    and they smooth independently.
 *  - blink: three. `setBlinkHold` drives all three blink morphs together.
 *  - brow: one. `exp_brow_up` and `exp_brow_down` only ever cross-fade, and
 *    their weights sum below one across `EXPRESSION_MAP`.
 *  - expression: two. Semantic expressions cross-fade, and no entry in
 *    `EXPRESSION_MAP` sums above 1.1 within this group.
 *
 * The tongue and blink widenings were measured to cost nothing at all on the
 * shipped bust: identical support values in all six axis directions.
 */
export const MORPH_GROUPS = [
  { name: 'mouth', simultaneous: 2, match: (n: string) => /^viseme_/.test(n) || n === 'jaw_open' || n === 'mouth_round' },
  { name: 'tongue', simultaneous: 2, match: (n: string) => /^tongue_/.test(n) },
  { name: 'brow', simultaneous: 1, match: (n: string) => /^exp_brow/.test(n) },
  { name: 'blink', simultaneous: 3, match: (n: string) => /^exp_blink/.test(n) },
  { name: 'expression', simultaneous: 2, match: () => true },
] as const;

/** One rigidly-transformed piece of the hull. */
export interface SilhouetteHullGroup {
  /** Joint node name; the runtime resolves it against the loaded rig. */
  joint: string;
  /** Column-major inverse bind matrix for that joint. */
  inverseBind: number[];
  /** Flat xyz triples in bind space. */
  points: number[];
}

export interface SilhouetteHullData {
  version: number;
  groups: SilhouetteHullGroup[];
  /** Joints proven to stay inside the hull under any rotation of their bone. */
  containedJoints: string[];
}

type Vec3 = [number, number, number];

/** Direction components are snapped to this many decimals; see below. */
const DIRECTION_DECIMALS = 9;

/**
 * Near-uniform sphere sampling with no RNG.
 *
 * ECMAScript does not specify `Math.sin`/`Math.cos` to the last bit, so a
 * future engine could shift a direction by one ulp, move a support value, and
 * break the regenerate-from-source byte equality for no real reason. Snapping
 * each component to nine decimals makes the set reproducible from decimals
 * alone. The vectors stop being exactly unit length by about 1e-9, which
 * nothing here is sensitive to: support planes do not need unit normals, and
 * the only place a length is assumed is the ball test in `jointStaysInside`,
 * which clears by 0.07 on the shipped rig.
 */
export function fibonacciDirections(count: number): Vec3[] {
  const out: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const snap = 10 ** DIRECTION_DECIMALS;
  const fix = (v: number): number => {
    const r = Math.round(v * snap) / snap;
    return r === 0 ? 0 : r;
  };
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * i + 1) / count;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    out.push([fix(Math.cos(theta) * r), fix(y), fix(Math.sin(theta) * r)]);
  }
  return out;
}

/** A vertex plus the morph deltas that can displace it, grouped for bounding. */
export interface ReachableVertex {
  x: number;
  y: number;
  z: number;
  /** Per morph group, the deltas belonging to it, flattened xyz. */
  deltas: Float64Array[];
}

/**
 * Support of the reachable set in `dir`: the furthest any vertex can be pushed
 * along it, given the per-group simultaneity bounds.
 */
export function supportValue(vertices: readonly ReachableVertex[], dir: Vec3): number {
  const [dx, dy, dz] = dir;
  const top: number[][] = MORPH_GROUPS.map((g) => new Array<number>(g.simultaneous).fill(0));
  let best = Number.NEGATIVE_INFINITY;
  for (const v of vertices) {
    let s = v.x * dx + v.y * dy + v.z * dz;
    for (let g = 0; g < MORPH_GROUPS.length; g++) {
      const deltas = v.deltas[g];
      if (!deltas || deltas.length === 0) continue;
      const slots = top[g] as number[];
      slots.fill(0);
      const last = slots.length - 1;
      for (let k = 0; k < deltas.length; k += 3) {
        const t = (deltas[k] as number) * dx + (deltas[k + 1] as number) * dy + (deltas[k + 2] as number) * dz;
        if (t <= (slots[last] as number)) continue;
        let j = last;
        while (j > 0 && (slots[j - 1] as number) < t) {
          slots[j] = slots[j - 1] as number;
          j--;
        }
        slots[j] = t;
      }
      for (let j = 0; j <= last; j++) s += slots[j] as number;
    }
    if (s > best) best = s;
  }
  return best;
}

/**
 * Vertices of `{ x : dir_i . x <= support_i }`, by intersecting every plane
 * triple and keeping the intersections that satisfy all the half-spaces.
 * Returns [] when the half-spaces do not bound a solid.
 *
 * Two preconditions, both met by `paddedSupports` and `fibonacciDirections`
 * and neither checked here:
 *
 *  - Supports must already carry outward slack. Returned coordinates are
 *    rounded to `ROUND_DECIMALS` for byte stability, which can pull a vertex
 *    inward by up to 5e-7 per axis, so an unpadded call returns a polytope
 *    fractionally smaller than the one asked for.
 *  - The direction set must be well conditioned. A plane triple whose
 *    determinant falls below 1e-9 is treated as parallel and skipped, so a
 *    bounded solid built from near-dependent normals can come back empty
 *    rather than wrong. Callers detect that as a short vertex list.
 */
export function halfSpaceVertices(dirs: readonly Vec3[], supports: readonly number[]): Vec3[] {
  const n = dirs.length;
  // Scale-relative slack: a vertex sits exactly on three planes, so rounding
  // must not reject it against the other n-3.
  let scale = 0;
  for (const s of supports) scale = Math.max(scale, Math.abs(s));
  const slack = scale * 1e-9 + 1e-12;
  const out: Vec3[] = [];
  const seen = new Set<string>();
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        const p = intersectPlanes(dirs[a] as Vec3, supports[a] as number, dirs[b] as Vec3, supports[b] as number, dirs[c] as Vec3, supports[c] as number);
        if (!p) continue;
        let inside = true;
        for (let i = 0; i < n; i++) {
          const d = dirs[i] as Vec3;
          if (d[0] * p[0] + d[1] * p[1] + d[2] * p[2] > (supports[i] as number) + slack) {
            inside = false;
            break;
          }
        }
        if (!inside) continue;
        const key = `${round(p[0])},${round(p[1])},${round(p[2])}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([round(p[0]), round(p[1]), round(p[2])]);
      }
    }
  }
  // Deterministic order regardless of triple enumeration rounding.
  out.sort((u, w) => u[0] - w[0] || u[1] - w[1] || u[2] - w[2]);
  return out;
}

function round(v: number): number {
  const f = 10 ** ROUND_DECIMALS;
  // -0 would serialise differently from 0 and break byte equality.
  const r = Math.round(v * f) / f;
  return r === 0 ? 0 : r;
}

function intersectPlanes(n1: Vec3, d1: number, n2: Vec3, d2: number, n3: Vec3, d3: number): Vec3 | null {
  const c23: Vec3 = [n2[1] * n3[2] - n2[2] * n3[1], n2[2] * n3[0] - n2[0] * n3[2], n2[0] * n3[1] - n2[1] * n3[0]];
  const det = n1[0] * c23[0] + n1[1] * c23[1] + n1[2] * c23[2];
  if (Math.abs(det) < 1e-9) return null;
  const c31: Vec3 = [n3[1] * n1[2] - n3[2] * n1[1], n3[2] * n1[0] - n3[0] * n1[2], n3[0] * n1[1] - n3[1] * n1[0]];
  const c12: Vec3 = [n1[1] * n2[2] - n1[2] * n2[1], n1[2] * n2[0] - n1[0] * n2[2], n1[0] * n2[1] - n1[1] * n2[0]];
  return [
    (d1 * c23[0] + d2 * c31[0] + d3 * c12[0]) / det,
    (d1 * c23[1] + d2 * c31[1] + d3 * c12[1]) / det,
    (d1 * c23[2] + d2 * c31[2] + d3 * c12[2]) / det,
  ];
}

/** Build the polytope for one set of reachable vertices. */
export function buildPolytope(vertices: readonly ReachableVertex[], directionCount: number): Vec3[] {
  const dirs = fibonacciDirections(directionCount);
  const supports = paddedSupports(vertices, dirs);
  return halfSpaceVertices(dirs, supports);
}

// ---------------------------------------------------------------------------
// Document extraction
// ---------------------------------------------------------------------------

interface JointVertices {
  joint: string;
  inverseBind: number[];
  vertices: ReachableVertex[];
  /** Bind-space position of the joint's own pivot. */
  pivot: Vec3;
}

function groupIndexFor(name: string): number {
  for (let i = 0; i < MORPH_GROUPS.length; i++) {
    if (MORPH_GROUPS[i]?.match(name) === true) return i;
  }
  return MORPH_GROUPS.length - 1;
}

/**
 * The document is outside what the bake can bound soundly. `optimize.ts`
 * treats this as "no hull for this asset" rather than a build failure: the
 * optimiser is a general tool and most GLBs are not rigs.
 */
export class SilhouetteHullUnsupported extends Error {
  override readonly name = 'SilhouetteHullUnsupported';
}

function collectJointVertices(doc: Document): JointVertices[] {
  const root = doc.getRoot();
  const skins = root.listSkins();
  if (skins.length === 0) throw new SilhouetteHullUnsupported('document has no skin');
  // Joint indices are per-skin, so a second skin would be read through the
  // first skin's table and produce a plausible but wrong hull.
  if (skins.length > 1) throw new SilhouetteHullUnsupported('document has more than one skin');
  const skin = skins[0] as NonNullable<(typeof skins)[number]>;
  const joints = skin.listJoints();
  const ibmAccessor = skin.getInverseBindMatrices();
  if (!ibmAccessor) throw new SilhouetteHullUnsupported('skin has no inverse bind matrices');

  const perJoint = new Map<number, JointVertices>();
  const ibmScratch: number[] = [];
  // The hull addresses joints by name at runtime, so an empty or repeated one
  // would resolve two groups onto the same bone and silently transform half the
  // hull by the wrong matrix.
  const seenNames = new Set<string>();
  for (let j = 0; j < joints.length; j++) {
    const node = joints[j] as GLTFNode;
    const name = node.getName();
    if (name === '') throw new SilhouetteHullUnsupported(`joint ${j} has no name`);
    if (seenNames.has(name)) throw new SilhouetteHullUnsupported(`joint name ${name} is not unique`);
    seenNames.add(name);
    ibmAccessor.getElement(j, ibmScratch);
    const inverseBind = ibmScratch.slice(0, 16);
    perJoint.set(j, {
      joint: name,
      inverseBind,
      vertices: [],
      pivot: invertTranslation(inverseBind),
    });
  }

  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    // Unskinned geometry rides its node transform, not a joint, so it would be
    // silently left out of every polytope and could poke through the outline.
    if (node.getSkin() !== skin) {
      throw new SilhouetteHullUnsupported(`mesh node ${node.getName()} is not bound to the document's skin`);
    }
    if (!isIdentityTransform(node)) {
      throw new SilhouetteHullUnsupported(`skinned node ${node.getName()} has a non-identity transform`);
    }
    for (const prim of mesh.listPrimitives()) {
      appendPrimitive(prim, perJoint);
    }
  }
  return [...perJoint.values()].filter((g) => g.vertices.length > 0);
}

function isIdentityTransform(node: GLTFNode): boolean {
  const t = node.getTranslation();
  const r = node.getRotation();
  const s = node.getScale();
  return (
    t[0] === 0 && t[1] === 0 && t[2] === 0 &&
    r[0] === 0 && r[1] === 0 && r[2] === 0 && r[3] === 1 &&
    s[0] === 1 && s[1] === 1 && s[2] === 1
  );
}

function invertTranslation(ibm: number[]): Vec3 {
  // Rotation-free rigs keep the pivot in the IBM translation; for a general
  // rigid IBM the pivot is -R^T t.
  const tx = ibm[12] as number;
  const ty = ibm[13] as number;
  const tz = ibm[14] as number;
  return [
    -((ibm[0] as number) * tx + (ibm[1] as number) * ty + (ibm[2] as number) * tz),
    -((ibm[4] as number) * tx + (ibm[5] as number) * ty + (ibm[6] as number) * tz),
    -((ibm[8] as number) * tx + (ibm[9] as number) * ty + (ibm[10] as number) * tz),
  ];
}

function appendPrimitive(prim: Primitive, perJoint: Map<number, JointVertices>): void {
  const position = prim.getAttribute('POSITION');
  const jointsAttr = prim.getAttribute('JOINTS_0');
  const weightsAttr = prim.getAttribute('WEIGHTS_0');
  if (!position || !jointsAttr || !weightsAttr) {
    // Renders, but rides no joint we can transform, so it would be missing from
    // every polytope and could poke through the outline.
    throw new SilhouetteHullUnsupported('a primitive on a skinned mesh has no POSITION/JOINTS_0/WEIGHTS_0');
  }
  const targets = prim
    .listTargets()
    .map((t) => ({ group: groupIndexFor(t.getName()), accessor: t.getAttribute('POSITION') }))
    .filter((t): t is { group: number; accessor: NonNullable<typeof t.accessor> } => t.accessor !== null);

  const pos: number[] = [];
  const jnt: number[] = [];
  const wgt: number[] = [];
  const delta: number[] = [];
  const count = position.getCount();
  for (let i = 0; i < count; i++) {
    position.getElement(i, pos);
    jointsAttr.getElement(i, jnt);
    weightsAttr.getElement(i, wgt);

    const buckets: number[][] = MORPH_GROUPS.map(() => []);
    let any = false;
    for (const t of targets) {
      t.accessor.getElement(i, delta);
      const dx = delta[0] as number;
      const dy = delta[1] as number;
      const dz = delta[2] as number;
      // Exactly zero, not near zero: a tolerance here would quietly lower a
      // support plane and cost the bound its exactness.
      if (dx === 0 && dy === 0 && dz === 0) continue;
      (buckets[t.group] as number[]).push(dx, dy, dz);
      any = true;
    }
    const deltas = any
      ? buckets.map((b) => Float64Array.from(b))
      : (EMPTY_DELTAS as Float64Array[]);

    for (let k = 0; k < 4; k++) {
      if ((wgt[k] as number) <= 0) continue;
      const group = perJoint.get(jnt[k] as number);
      if (!group) continue;
      group.vertices.push({ x: pos[0] as number, y: pos[1] as number, z: pos[2] as number, deltas });
    }
  }
}

const EMPTY_DELTAS: Float64Array[] = MORPH_GROUPS.map(() => new Float64Array(0));

/**
 * True when every reachable position of `group` stays inside the polytope
 * `{ dir_i . x <= support_i }` under an arbitrary rotation of the group's own
 * bone. Rotation is about the joint pivot, so the reachable set is contained in
 * the ball around that pivot, and a ball of radius `R` reaches
 * `dir . centre + R * |dir|` along a plane normal that is not unit length.
 */
function jointStaysInside(group: JointVertices, dirs: readonly Vec3[], supports: readonly number[]): boolean {
  const [cx, cy, cz] = group.pivot;
  let radius = 0;
  for (const v of group.vertices) {
    // Morph displacement is bounded by the same per-group simultaneity rule as
    // the support planes, taken as magnitudes so the bound is direction free.
    const r = Math.hypot(v.x - cx, v.y - cy, v.z - cz) + morphRadius(v);
    if (r > radius) radius = r;
  }
  for (let i = 0; i < dirs.length; i++) {
    const d = dirs[i] as Vec3;
    const centre = d[0] * cx + d[1] * cy + d[2] * cz;
    if (centre + radius * Math.hypot(d[0], d[1], d[2]) > (supports[i] as number)) return false;
  }
  return true;
}

/** Longest displacement the morph groups can add to one vertex, any direction. */
function morphRadius(v: ReachableVertex): number {
  let total = 0;
  for (let g = 0; g < MORPH_GROUPS.length; g++) {
    const deltas = v.deltas[g];
    if (!deltas || deltas.length === 0) continue;
    const slots = new Array<number>((MORPH_GROUPS[g] as { simultaneous: number }).simultaneous).fill(0);
    const last = slots.length - 1;
    for (let k = 0; k < deltas.length; k += 3) {
      const m = Math.hypot(deltas[k] as number, deltas[k + 1] as number, deltas[k + 2] as number);
      if (m <= (slots[last] as number)) continue;
      let j = last;
      while (j > 0 && (slots[j - 1] as number) < m) {
        slots[j] = slots[j - 1] as number;
        j--;
      }
      slots[j] = m;
    }
    for (const s of slots) total += s;
  }
  return total;
}

/**
 * Support values for `dirs`, each pushed out by `SUPPORT_PADDING` so that the
 * rounding and float32 narrowing downstream cannot pull the bound inside the
 * reachable set.
 */
function paddedSupports(vertices: readonly ReachableVertex[], dirs: readonly Vec3[]): number[] {
  return dirs.map((d) => supportValue(vertices, d) + SUPPORT_PADDING * Math.hypot(d[0], d[1], d[2]));
}

/**
 * Bake the silhouette hull for a fully-optimised document. Call after every
 * geometry transform: the hull must bound the geometry that actually ships.
 *
 * Throws `SilhouetteHullUnsupported` for a document the bake cannot bound
 * soundly; callers optimising arbitrary GLBs should treat that as "no hull".
 */
export function buildSilhouetteHull(doc: Document): SilhouetteHullData {
  const groups = collectJointVertices(doc);
  if (groups.length === 0) throw new SilhouetteHullUnsupported('no skinned vertices found');
  groups.sort((a, b) => b.vertices.length - a.vertices.length || (a.joint < b.joint ? -1 : a.joint > b.joint ? 1 : 0));

  const primary = groups[0] as JointVertices;
  const primaryDirs = fibonacciDirections(DIRECTION_COUNT);
  // Two support sets on purpose. The padded one is enumerated into vertices, so
  // the slack survives rounding and float32. The raw one decides which joints
  // are retired, so that proof never spends the slack it does not own.
  const rawSupports = primaryDirs.map((d) => supportValue(primary.vertices, d));
  const paddedPrimary = rawSupports.map(
    (s, i) => s + SUPPORT_PADDING * Math.hypot(...(primaryDirs[i] as Vec3)),
  );
  const primaryPoints = halfSpaceVertices(primaryDirs, paddedPrimary);
  // A direction set too ill-conditioned to intersect leaves no solid, and an
  // empty group would ship as a hull that bounds nothing.
  if (primaryPoints.length < 4) {
    throw new SilhouetteHullUnsupported('support half-spaces do not bound a solid');
  }
  const out: SilhouetteHullGroup[] = [
    {
      joint: primary.joint,
      inverseBind: primary.inverseBind,
      points: flatten(primaryPoints),
    },
  ];
  const contained: string[] = [];
  for (const group of groups.slice(1)) {
    if (jointStaysInside(group, primaryDirs, rawSupports)) {
      contained.push(group.joint);
      continue;
    }
    const points = buildPolytope(group.vertices, SECONDARY_DIRECTION_COUNT);
    if (points.length < 4) {
      throw new SilhouetteHullUnsupported(`joint ${group.joint} has no boundable solid`);
    }
    out.push({ joint: group.joint, inverseBind: group.inverseBind, points: flatten(points) });
  }

  const total = out.reduce((n, g) => n + g.points.length / 3, 0);
  if (total > MAX_HULL_POINTS) {
    throw new SilhouetteHullUnsupported(`${total} points exceeds the ${MAX_HULL_POINTS} point budget`);
  }
  return { version: SILHOUETTE_HULL_VERSION, groups: out, containedJoints: contained.sort() };
}

function flatten(points: readonly Vec3[]): number[] {
  const out: number[] = [];
  for (const p of points) out.push(p[0], p[1], p[2]);
  return out;
}
