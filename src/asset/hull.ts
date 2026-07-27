/**
 * Silhouette hull: read the baked outline and project it to screen space
 * (todo.liquid-glass-silhouette-hull, dec.liquid-glass-architecture).
 *
 * The hull is baked offline by `tools/asset-pipeline/silhouette-hull.ts` as an
 * outer bound on every position the rig can reach, stored in the glTF scene
 * extras and surfaced by three's GLTFLoader as scene `userData`. Because the
 * bound is outer and each group is rigidly bound to one joint, the 2D convex
 * hull of the projected points contains the rendered silhouette at any pose.
 *
 * The compositor glass layer needs that outline as a `clip-path` polygon every
 * frame. Deriving it from canvas alpha would force a GPU to CPU sync per frame
 * and cost more than the effect itself, so this path never reads back: it
 * transforms a few dozen baked points on the CPU into preallocated buffers.
 */

import { Matrix4 } from 'three';
import type * as THREE from 'three';
import type { LoadedAvatar, SilhouetteHull, SilhouetteHullGroup } from '../contracts';

/** Extras key written by the asset pipeline. */
export const SILHOUETTE_HULL_KEY = 'hologlyphSilhouetteHull';

/** Schema version this runtime understands. */
export const SILHOUETTE_HULL_VERSION = 1;

function isGroup(value: unknown): value is SilhouetteHullGroup {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as Partial<SilhouetteHullGroup>;
  return (
    typeof g.joint === 'string' &&
    Array.isArray(g.inverseBind) &&
    g.inverseBind.length === 16 &&
    Array.isArray(g.points) &&
    g.points.length > 0 &&
    g.points.length % 3 === 0 &&
    g.points.every((n) => Number.isFinite(n)) &&
    g.inverseBind.every((n) => Number.isFinite(n))
  );
}

/**
 * Pull the baked hull out of a loaded scene graph. Returns null for any asset
 * that does not carry one, or carries one this runtime cannot read: the hull is
 * an enhancement and its absence must change nothing.
 */
export function readSilhouetteHull(root: THREE.Object3D): SilhouetteHull | null {
  const raw = (root.userData as Record<string, unknown> | undefined)?.[SILHOUETTE_HULL_KEY];
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Partial<SilhouetteHull>;
  if (data.version !== SILHOUETTE_HULL_VERSION) return null;
  if (!Array.isArray(data.groups) || data.groups.length === 0) return null;
  if (!data.groups.every(isGroup)) return null;
  const containedJoints = Array.isArray(data.containedJoints)
    ? data.containedJoints.filter((n): n is string => typeof n === 'string')
    : [];
  return { version: data.version, groups: data.groups, containedJoints };
}

interface BoundGroup {
  bone: THREE.Bone;
  inverseBind: Matrix4;
  points: Float32Array;
}

/**
 * Resolve a glTF joint name to a bone. Three's GLTFLoader sanitises node names
 * (spaces and reserved characters replaced, duplicates suffixed) and keeps the
 * original in `userData.name`, so the original is matched first: with joints
 * `a b` and `a_b` in the same rig, three names them `a_b` and `a_b_1`, and
 * matching on the sanitised name would bind both hull groups to the first bone.
 *
 * Only a real bone counts: a mesh or group sharing the name must not stand in
 * for the joint.
 */
function findBone(root: THREE.Object3D, joint: string): THREE.Bone | null {
  let original: THREE.Bone | null = null;
  let sanitised: THREE.Bone | null = null;
  root.traverse((obj) => {
    const bone = obj as THREE.Bone;
    if (!bone.isBone) return;
    if (!original && bone.userData.name === joint) original = bone;
    if (!sanitised && bone.name === joint) sanitised = bone;
  });
  return original ?? sanitised;
}

/**
 * Projects a baked hull to a screen-space convex polygon.
 *
 * Every buffer is allocated once in the constructor; `update` writes into them
 * and allocates nothing. `polygon()` is the exception and unavoidably so: a CSS
 * `clip-path` value is an immutable string, so a changing outline costs one
 * fresh string per frame. Consumers that can take numbers should read `xy` and
 * `count` instead.
 */
export class SilhouetteProjector {
  /** Screen-space polygon vertices, xy pairs, valid for `count` points. */
  readonly xy: Float32Array;
  /** Number of polygon vertices written by the last successful `update`. */
  count = 0;

  private readonly _groups: BoundGroup[] = [];
  private readonly _sx: Float32Array;
  private readonly _sy: Float32Array;
  private readonly _order: Int32Array;
  private readonly _stack: Int32Array;
  private readonly _vp = new Matrix4();
  private readonly _m = new Matrix4();
  private readonly _total: number;

  /**
   * Resolves every hull group against the rig, all or nothing. A group that
   * cannot be resolved to a bone would silently remove part of the outline and
   * leave a hull that no longer contains the silhouette, so a single failure
   * makes the whole projector unusable rather than half right.
   *
   * Joints are matched on `Object3D.name` and then on `userData.name`, which is
   * where three's GLTFLoader keeps the original glTF name after sanitising it.
   *
   * The resolved bones are held for the projector's lifetime. Replacing the
   * avatar invalidates the projector: build a new one alongside the new rig.
   */
  constructor(hull: SilhouetteHull, avatar: LoadedAvatar) {
    let total = 0;
    let resolved = true;
    for (const group of hull.groups) {
      const bone = findBone(avatar.root, group.joint);
      if (!bone) {
        resolved = false;
        break;
      }
      const inverseBind = new Matrix4().fromArray(Array.from(group.inverseBind));
      const points = Float32Array.from(group.points);
      this._groups.push({ bone, inverseBind, points });
      total += points.length / 3;
    }
    if (!resolved) {
      this._groups.length = 0;
      total = 0;
    }
    this._total = total;
    this.xy = new Float32Array(total * 2);
    this._sx = new Float32Array(total);
    this._sy = new Float32Array(total);
    this._order = new Int32Array(total);
    this._stack = new Int32Array(total * 2);
  }

  /** False when the hull did not resolve fully against the rig. */
  get usable(): boolean {
    return this._total >= 3;
  }

  /**
   * Recompute the polygon for the current pose. Bone world matrices must
   * already be current for the frame (three updates them during render).
   *
   * `floorY` is an optional world-space waterline. The engine clips the body
   * at a horizontal plane during emergence, so the submerged part is not drawn
   * and must not be bounded either; passing the plane's height clamps each
   * hull point up onto it before projecting. That keeps the hull's one
   * load-bearing property intact by construction: a point moved up onto the
   * floor at the same x and z still OUTER-bounds the clipped body there, which
   * intersecting the projected polygon against the plane's vanishing line
   * would only achieve if the line construction were exactly right at every
   * camera tilt. Omitting it is byte-identical to not having the parameter.
   *
   * Returns false and leaves `count` at 0 when the outline is undefined for
   * this view: any hull point at or behind the eye plane means the camera sits
   * inside the head, where a clip polygon has no meaning.
   */
  update(camera: THREE.Camera, width: number, height: number, floorY?: number): boolean {
    this.count = 0;
    if (!this.usable || width <= 0 || height <= 0) return false;

    this._vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const halfW = width * 0.5;
    const halfH = height * 0.5;
    // Only finite floors clamp. `undefined` and NaN both take the untouched
    // path rather than turning every point into NaN.
    const clamped = floorY !== undefined && Number.isFinite(floorY);
    let n = 0;
    for (const group of this._groups) {
      this._m.multiplyMatrices(group.bone.matrixWorld, group.inverseBind);
      if (!clamped) this._m.premultiply(this._vp);
      const e = this._m.elements;
      const v = this._vp.elements;
      const pts = group.points;
      for (let i = 0; i < pts.length; i += 3) {
        const x = pts[i] as number;
        const y = pts[i + 1] as number;
        const z = pts[i + 2] as number;
        let cx: number;
        let cy: number;
        let w: number;
        if (clamped) {
          // World first, so the floor can be applied in the space it is
          // expressed in, then the view-projection by hand: composing a
          // second Matrix4 per group would allocate nothing but would also
          // have to be undone to reach world y.
          const wx = (e[0] as number) * x + (e[4] as number) * y + (e[8] as number) * z + (e[12] as number);
          let wy = (e[1] as number) * x + (e[5] as number) * y + (e[9] as number) * z + (e[13] as number);
          const wz = (e[2] as number) * x + (e[6] as number) * y + (e[10] as number) * z + (e[14] as number);
          if (wy < (floorY as number)) wy = floorY as number;
          w = (v[3] as number) * wx + (v[7] as number) * wy + (v[11] as number) * wz + (v[15] as number);
          if (!(w > 1e-6)) return false;
          cx = (v[0] as number) * wx + (v[4] as number) * wy + (v[8] as number) * wz + (v[12] as number);
          cy = (v[1] as number) * wx + (v[5] as number) * wy + (v[9] as number) * wz + (v[13] as number);
        } else {
          w = (e[3] as number) * x + (e[7] as number) * y + (e[11] as number) * z + (e[15] as number);
          if (!(w > 1e-6)) return false;
          cx = (e[0] as number) * x + (e[4] as number) * y + (e[8] as number) * z + (e[12] as number);
          cy = (e[1] as number) * x + (e[5] as number) * y + (e[9] as number) * z + (e[13] as number);
        }
        this._sx[n] = (cx / w) * halfW + halfW;
        this._sy[n] = halfH - (cy / w) * halfH;
        this._order[n] = n;
        n++;
      }
    }
    this.count = this._convexHull(n);
    return this.count >= 3;
  }

  /**
   * CSS `clip-path` value for the current polygon, or `none` when there is no
   * outline. Allocates one string; see the class note.
   */
  polygon(): string {
    if (this.count < 3) return 'none';
    let out = 'polygon(';
    for (let i = 0; i < this.count; i++) {
      if (i > 0) out += ', ';
      out += `${round2(this.xy[i * 2] as number)}px ${round2(this.xy[i * 2 + 1] as number)}px`;
    }
    return `${out})`;
  }

  /**
   * Andrew's monotone chain over the first `n` projected points, writing the
   * polygon into `xy` with a consistent winding.
   *
   * The lexicographic sort is an in-place insertion sort rather than
   * `TypedArray.prototype.sort`, which allocates two backing arrays whenever a
   * comparator is supplied (V8 `TypedArraySortCommon`). At a few dozen points
   * insertion sort is also the faster of the two, and it keeps the per-frame
   * path genuinely allocation free.
   */
  private _convexHull(n: number): number {
    if (n < 3) return 0;
    const order = this._order;
    const sx = this._sx;
    const sy = this._sy;
    for (let i = 1; i < n; i++) {
      const p = order[i] as number;
      const px = sx[p] as number;
      const py = sy[p] as number;
      let j = i - 1;
      while (j >= 0) {
        const q = order[j] as number;
        const qx = sx[q] as number;
        if (qx < px || (qx === px && (sy[q] as number) <= py)) break;
        order[j + 1] = q;
        j--;
      }
      order[j + 1] = p;
    }
    const stack = this._stack;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const p = order[i] as number;
      while (k >= 2 && this._cross(stack[k - 2] as number, stack[k - 1] as number, p) <= 0) k--;
      stack[k++] = p;
    }
    const lower = k + 1;
    for (let i = n - 2; i >= 0; i--) {
      const p = order[i] as number;
      while (k >= lower && this._cross(stack[k - 2] as number, stack[k - 1] as number, p) <= 0) k--;
      stack[k++] = p;
    }
    // The chain closes on its start point, which the polygon does not repeat.
    k--;
    // Fewer than three survivors means every point was collinear.
    if (k < 3) return 0;
    for (let i = 0; i < k; i++) {
      const p = stack[i] as number;
      this.xy[i * 2] = this._sx[p] as number;
      this.xy[i * 2 + 1] = this._sy[p] as number;
    }
    return k;
  }

  private _cross(o: number, a: number, b: number): number {
    const ox = this._sx[o] as number;
    const oy = this._sy[o] as number;
    return (
      ((this._sx[a] as number) - ox) * ((this._sy[b] as number) - oy) -
      ((this._sy[a] as number) - oy) * ((this._sx[b] as number) - ox)
    );
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
