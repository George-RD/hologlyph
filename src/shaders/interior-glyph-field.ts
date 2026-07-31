/**
 * Interior glyph field: the GPU half (dec.liquid-glass-architecture, item 10).
 *
 * One extra draw call between the two glass passes: a few hundred
 * camera-facing quads suspended in the body's interior volume, each showing
 * one cell of the text-skin canvas the surface already samples. No new asset,
 * no new atlas, no second upload.
 *
 * Everything is placed on the CPU. At a few hundred sprites that is cheaper
 * than arguing with a vertex shader about billboarding, instancing and sort
 * order, and it keeps the whole motion model in `interior-glyphs.ts`, where it
 * can be unit tested without a GPU.
 *
 * No GPU resources are constructed at module load, so importing this under
 * happy-dom is safe; `createInteriorGlyphField` builds them.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  NormalBlending,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { attribute, luminance, mix, smoothstep, texture, uniform, uv, vec3 } from 'three/tsl';
import type * as THREE from 'three';
import type { Disposable, HeadInteriorConfig } from '../contracts';
import {
  INTERIOR_GLYPH_MAX,
  INTERIOR_REDUCED_DRIFT,
  interiorContain,
  interiorDepthDim,
  interiorDriftBudgets,
  interiorDriftTargets,
  interiorIntegrate,
  interiorSpring,
  sampleInteriorSites,
} from './interior-glyphs.js';

/**
 * Where the field sits in the draw order from item 1:
 *
 *   -1     interior   back-facing far wall
 *   -0.5   THIS       suspended glyphs
 *    0     mask       front surface depth only
 *    1     internals  eyeballs, mouth cavity, eye trim
 *    2     skin       translucent front surface
 *
 * After the far wall so it composites over it, and before the occlusion mask
 * so the mask's depth write cannot cull it: every glyph is behind the front
 * surface by construction, so a depth test against that surface would erase
 * the whole field. Fractional on purpose. The alternative is renumbering four
 * existing passes to make room, and those four numbers are load bearing for
 * the approved look.
 */
export const INTERIOR_RENDER_ORDER = -0.5;

/**
 * Luminance window that keys the cell background out of the sprite.
 *
 * The text-skin canvas is a dim base (`#05070a`, luminance 0.03 as sampled,
 * with no colour-space decode on the way in) carrying brighter glyphs
 * (`#9fe7ff`, 0.85). Anything between the two is an antialiased letterform
 * edge, which is exactly what should survive: without the key each sprite
 * would be a faintly glowing square.
 */
const KEY_LOW = 0.08;
const KEY_HIGH = 0.45;

/** Live values the field's node graph reads. */
interface FieldUniforms {
  tint: { value: THREE.Color };
  brightness: { value: number };
}

export interface InteriorGlyphFieldOptions {
  /** Flat XYZ bind-space positions of the body the glyphs are suspended in. */
  readonly positions: ArrayLike<number>;
  /**
   * The body's triangle index, or null when the geometry is not indexed and
   * its positions are already triangle soup. Needed to measure how much room
   * each glyph has before it reaches the skin.
   */
  readonly indices: ArrayLike<number> | null;
  /** Per-vertex baked `aThickness`, or null when the rig has no bake. */
  readonly thickness: ArrayLike<number> | null;
  /**
   * Maps a bind-space point into the frame the field is carried by. For a
   * body skinned wholly to one bone that is `boneInverse * bindMatrix`, which
   * is what three does to skin such a vertex; for an unskinned mesh it is the
   * mesh's own local matrix.
   */
  readonly bindToFrame: THREE.Matrix4;
  /** The text-skin canvas the sprites sample. Owned by the caller. */
  readonly texture: THREE.Texture;
  /** Grid shape of that canvas, so a sprite can address one cell. */
  readonly grid: { readonly cols: number; readonly rows: number };
  readonly config: HeadInteriorConfig;
  /** Injectable for deterministic tests. */
  readonly rng?: () => number;
}

/** Per-frame inputs the field cannot read for itself. */
export interface InteriorGlyphState {
  /** Frame-to-world matrix of the bone (or object) carrying the glyphs. */
  readonly frameMatrix: THREE.Matrix4;
  readonly camera: THREE.Camera;
  readonly reduced: boolean;
}

export interface InteriorGlyphField extends Disposable {
  readonly object: THREE.Object3D;
  setConfig(config: HeadInteriorConfig): void;
  update(dt: number, state: InteriorGlyphState): void;
}

/**
 * Build the field.
 *
 * `INTERIOR_GLYPH_MAX` sites are sampled once, here, and `config.count` then
 * picks a prefix of them. So moving the count slider changes a draw range and
 * nothing else: no resample, no reallocation, and a glyph keeps its identity
 * across the whole travel of the slider rather than teleporting on every step.
 */
export function createInteriorGlyphField(options: InteriorGlyphFieldOptions): InteriorGlyphField {
  const { cols, rows } = options.grid;
  const rng = options.rng ?? Math.random;
  const sites = sampleInteriorSites(
    options.positions,
    options.indices,
    options.thickness,
    INTERIOR_GLYPH_MAX,
    Math.max(1, cols * rows),
    rng,
  );
  const max = sites.count;

  // Rest positions live in the carrying frame, so the head transform applies
  // to them once per frame as a matrix rather than per glyph as a rotation.
  const rest = new Float32Array(max * 3);
  const point = new Vector3();
  for (let g = 0; g < max; g++) {
    point
      .set(sites.positions[g * 3] ?? 0, sites.positions[g * 3 + 1] ?? 0, sites.positions[g * 3 + 2] ?? 0)
      .applyMatrix4(options.bindToFrame);
    rest[g * 3] = point.x;
    rest[g * 3 + 1] = point.y;
    rest[g * 3 + 2] = point.z;
  }

  // Clearances were measured in bind space, and the rest positions they bound
  // have just been carried into the frame, so they carry with them. The
  // SMALLEST of the matrix's three scales, because a clearance measured along
  // one axis and spent along another would otherwise overstate the room.
  const bindScale = new Vector3().setFromMatrixScale(options.bindToFrame);
  const clearanceScale = Math.min(bindScale.x, bindScale.y, bindScale.z);
  const clearances = new Float32Array(max);
  for (let g = 0; g < max; g++) clearances[g] = (sites.clearances[g] ?? 0) * clearanceScale;

  // World-space integration state. The spring chases a target the head's frame
  // carries, which is what turns a head turn into a drag and a settle.
  const world = new Float32Array(max * 3);
  const velocity = new Float32Array(max * 3);
  const targets = new Float32Array(max * 3);
  // The carried rest positions, in world space, recomputed each frame: the
  // centre of the ball each glyph is held inside.
  const restWorld = new Float32Array(max * 3);
  const depths = new Float32Array(max);
  const order: number[] = [];

  const positionData = new Float32Array(max * 4 * 3);
  const uvData = new Float32Array(max * 4 * 2);
  const dimData = new Float32Array(max * 4);
  const indexData = new Uint16Array(max * 6);

  // Static: each site owns one cell for its whole life. Inset by one texel so
  // a sprite cannot bleed a stripe of its neighbour in at the edges.
  const insetU = cols > 0 ? 1 / (cols * 16) : 0;
  const insetV = rows > 0 ? 1 / (rows * 16) : 0;
  for (let g = 0; g < max; g++) {
    const cell = sites.cells[g] ?? 0;
    const col = cell % cols;
    const row = Math.floor(cell / cols);
    const u0 = col / cols + insetU;
    const u1 = (col + 1) / cols - insetU;
    // The canvas has its origin top left and the texture is uploaded with
    // three's default flipY, so row 0 is at the TOP of v.
    const v1 = 1 - row / rows - insetV;
    const v0 = 1 - (row + 1) / rows + insetV;
    const base = g * 8;
    uvData[base] = u0;
    uvData[base + 1] = v0;
    uvData[base + 2] = u1;
    uvData[base + 3] = v0;
    uvData[base + 4] = u1;
    uvData[base + 5] = v1;
    uvData[base + 6] = u0;
    uvData[base + 7] = v1;
  }

  const positionAttr = new BufferAttribute(positionData, 3);
  positionAttr.setUsage(DynamicDrawUsage);
  const dimAttr = new BufferAttribute(dimData, 1);
  dimAttr.setUsage(DynamicDrawUsage);
  const indexAttr = new BufferAttribute(indexData, 1);
  indexAttr.setUsage(DynamicDrawUsage);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', positionAttr);
  geometry.setAttribute('uv', new BufferAttribute(uvData, 2));
  geometry.setAttribute('aDim', dimAttr);
  geometry.setIndex(indexAttr);
  geometry.setDrawRange(0, 0);

  const uTint = uniform(new Color(options.config.tint));
  const uBrightness = uniform(options.config.brightness);
  const uniforms: FieldUniforms = {
    tint: uTint as unknown as { value: THREE.Color },
    brightness: uBrightness as unknown as { value: number },
  };

  const material = new MeshBasicNodeMaterial();
  material.name = 'interior_glyphs';
  material.transparent = true;
  material.depthTest = true;
  // Never writes depth. The field is unsorted against everything except
  // itself, and a depth write would let a near glyph punch a hole in the front
  // surface that draws after it.
  material.depthWrite = false;
  material.blending = NormalBlending;
  // The quads are billboarded, so only one face is ever toward the camera;
  // DoubleSide costs nothing here and survives a mirrored frame matrix.
  material.side = DoubleSide;

  const sampled = texture(options.texture, uv());
  const lum = luminance(sampled.rgb);
  const dim = attribute('aDim', 'float');
  // Dimmed AND desaturated with depth: the tint survives at the front of the
  // field and washes out toward the back, which is what a coloured mote seen
  // through more of a body actually does, and it stops the far half of the
  // field competing with the surface glyphs for the eye.
  //
  // Brightness is the product of the sampled letterform, a value clamped to
  // [0,1] by `normaliseHeadConfig`, and the depth dim, so an interior glyph
  // can never outshine the same glyph on the surface.
  const tinted = mix(vec3(1, 1, 1), uTint, dim);
  material.colorNode = tinted.mul(lum).mul(uBrightness).mul(dim);
  material.opacityNode = smoothstep(KEY_LOW, KEY_HIGH, lum).mul(dim);

  const mesh = new Mesh(geometry, material as unknown as THREE.Material);
  mesh.name = 'interior_glyphs';
  mesh.renderOrder = INTERIOR_RENDER_ORDER;
  // Positions are world space and rewritten every frame, so the bounding
  // sphere three would cull against is a frame stale before it is used.
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;

  let config = options.config;
  let count = Math.min(max, config.count);
  let time = 0;
  /**
   * How many glyphs have ever been placed on a target. Raising `count` exposes
   * slots whose world position is still the zero the buffer was allocated
   * with, and at any inertia above 0 the spring would then fly them in from
   * the world origin, which is inside the head. They have to be seeded where
   * they belong the first time they are drawn.
   */
  let seededCount = 0;
  let disposed = false;

  const cameraRight = new Vector3();
  const cameraUp = new Vector3();
  const cameraForward = new Vector3();
  const cameraPos = new Vector3();
  const frameScale = new Vector3();

  /**
   * The frame scales and sprite extent the budgets were last built for. NaN
   * forces the first update to build them, and any later change of avatar scale
   * or sprite size rebuilds: a bigger sprite has less room, so a stale budget
   * would let the enlarged corners leak.
   */
  let budgetScaleMin = Number.NaN;
  let budgetScaleMax = Number.NaN;
  let budgetExtent = Number.NaN;
  /** World-space drift radius per glyph, which is what containment uses. */
  const budgetsWorld = new Float32Array(max);
  /** The same radii in frame units, which is where the drift is authored. */
  const budgetsFrame = new Float32Array(max);

  /**
   * Two scales, used in opposite directions. A clearance is turned into world
   * units by the SMALLEST of the frame's scales, because a clearance measured
   * along one axis and spent along another must assume the least generous one.
   * The world budget is turned back into frame units by the LARGEST, because a
   * frame-space offset lying on the most stretched axis is the one that reaches
   * furthest in world space.
   */
  function rebuildBudgets(minScale: number, maxScale: number, extent: number): void {
    budgetScaleMin = minScale;
    budgetScaleMax = maxScale;
    budgetExtent = extent;
    interiorDriftBudgets(budgetsWorld, clearances, max, extent, minScale);
    const inv = maxScale > 0 ? 1 / maxScale : 0;
    for (let g = 0; g < max; g++) budgetsFrame[g] = (budgetsWorld[g] ?? 0) * inv;
  }

  /** Place glyphs `[from, to)` on their targets with no velocity. */
  function snapRange(from: number, to: number): void {
    if (to <= from) return;
    world.set(targets.subarray(from * 3, to * 3), from * 3);
    velocity.fill(0, from * 3, to * 3);
  }

  function writeBuffers(): void {
    const half = config.size;
    const rx = cameraRight.x * half;
    const ry = cameraRight.y * half;
    const rz = cameraRight.z * half;
    const ux = cameraUp.x * half;
    const uy = cameraUp.y * half;
    const uz = cameraUp.z * half;

    let near = Number.POSITIVE_INFINITY;
    let far = Number.NEGATIVE_INFINITY;
    for (let g = 0; g < count; g++) {
      const x = world[g * 3] ?? 0;
      const y = world[g * 3 + 1] ?? 0;
      const z = world[g * 3 + 2] ?? 0;
      const depth =
        (x - cameraPos.x) * cameraForward.x +
        (y - cameraPos.y) * cameraForward.y +
        (z - cameraPos.z) * cameraForward.z;
      depths[g] = depth;
      if (depth < near) near = depth;
      if (depth > far) far = depth;

      const base = g * 12;
      positionData[base] = x - rx - ux;
      positionData[base + 1] = y - ry - uy;
      positionData[base + 2] = z - rz - uz;
      positionData[base + 3] = x + rx - ux;
      positionData[base + 4] = y + ry - uy;
      positionData[base + 5] = z + rz - uz;
      positionData[base + 6] = x + rx + ux;
      positionData[base + 7] = y + ry + uy;
      positionData[base + 8] = z + rz + uz;
      positionData[base + 9] = x - rx + ux;
      positionData[base + 10] = y - ry + uy;
      positionData[base + 11] = z - rz + uz;
    }

    for (let g = 0; g < count; g++) {
      const shade = interiorDepthDim(depths[g] ?? 0, near, far, config.depthFade);
      const base = g * 4;
      dimData[base] = shade;
      dimData[base + 1] = shade;
      dimData[base + 2] = shade;
      dimData[base + 3] = shade;
    }

    // Back to front, so a nearer glyph covers a farther one and the field
    // reads as a volume rather than as a flat scatter.
    //
    // A glyph with no budget is culled here rather than drawn still: a budget of
    // 0 means the sprite is wider than the room its site has, so the quad pokes
    // out of the silhouette at rest, before any drift. Dropping it from the
    // index is how it stops being drawn without disturbing the seeding, and it
    // follows a later change of `interior.size` for free.
    order.length = 0;
    for (let g = 0; g < count; g++) {
      if ((budgetsWorld[g] ?? 0) > 0) order.push(g);
    }
    order.sort((a, b) => (depths[b] ?? 0) - (depths[a] ?? 0));
    const drawn = order.length;
    for (let k = 0; k < drawn; k++) {
      const g = order[k] ?? 0;
      const vertex = g * 4;
      const slot = k * 6;
      indexData[slot] = vertex;
      indexData[slot + 1] = vertex + 1;
      indexData[slot + 2] = vertex + 2;
      indexData[slot + 3] = vertex;
      indexData[slot + 4] = vertex + 2;
      indexData[slot + 5] = vertex + 3;
    }

    positionAttr.needsUpdate = true;
    dimAttr.needsUpdate = true;
    indexAttr.needsUpdate = true;
    geometry.setDrawRange(0, drawn * 6);
  }

  return {
    object: mesh,

    setConfig(next: HeadInteriorConfig): void {
      if (disposed) return;
      config = next;
      count = Math.min(max, next.count);
      uniforms.tint.value.set(next.tint);
      uniforms.brightness.value = next.brightness;
    },

    update(dt: number, state: InteriorGlyphState): void {
      if (disposed || count === 0) {
        geometry.setDrawRange(0, 0);
        return;
      }

      // The frame's scale decides how a bind-space clearance and a world-space
      // sprite compare, and it can change under a scaled or swapped avatar, so
      // it is read every frame and the budgets follow it. `config.size` is the
      // sprite's HALF-size along both billboard axes, so its furthest corner is
      // that times root two.
      frameScale.setFromMatrixScale(state.frameMatrix);
      const minScale = Math.min(frameScale.x, frameScale.y, frameScale.z);
      const maxScale = Math.max(frameScale.x, frameScale.y, frameScale.z);
      const extent = config.size * Math.SQRT2;
      if (minScale !== budgetScaleMin || maxScale !== budgetScaleMax || extent !== budgetExtent) {
        rebuildBudgets(minScale, maxScale, extent);
      }

      const drift = state.reduced ? config.drift * INTERIOR_REDUCED_DRIFT : config.drift;
      time += Math.max(0, dt) * (state.reduced ? INTERIOR_REDUCED_DRIFT : 1);
      interiorDriftTargets(targets, rest, sites.phases, budgetsFrame, count, time, drift);

      // Frame-local targets and rest positions to world. The rest positions are
      // the centres containment holds the glyphs around, so they travel with
      // the head exactly as the targets do.
      const m = state.frameMatrix.elements;
      for (let g = 0; g < count; g++) {
        const x = targets[g * 3] ?? 0;
        const y = targets[g * 3 + 1] ?? 0;
        const z = targets[g * 3 + 2] ?? 0;
        targets[g * 3] = (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0);
        targets[g * 3 + 1] = (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0);
        targets[g * 3 + 2] = (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0);
        const rx = rest[g * 3] ?? 0;
        const ry = rest[g * 3 + 1] ?? 0;
        const rz = rest[g * 3 + 2] ?? 0;
        restWorld[g * 3] = (m[0] ?? 0) * rx + (m[4] ?? 0) * ry + (m[8] ?? 0) * rz + (m[12] ?? 0);
        restWorld[g * 3 + 1] = (m[1] ?? 0) * rx + (m[5] ?? 0) * ry + (m[9] ?? 0) * rz + (m[13] ?? 0);
        restWorld[g * 3 + 2] = (m[2] ?? 0) * rx + (m[6] ?? 0) * ry + (m[10] ?? 0) * rz + (m[14] ?? 0);
      }

      // Reduced motion removes the lag, because the lag IS the shake response.
      if (state.reduced || config.inertia === 0) {
        snapRange(0, count);
      } else {
        // Glyphs the count slider has just exposed start ON their target
        // rather than at the world origin the buffer was allocated with.
        snapRange(seededCount, count);
        const spring = interiorSpring(config.inertia);
        interiorIntegrate(world, velocity, targets, count, spring.stiffness, spring.damping, dt);
      }
      // The last word on where a glyph may be, after both paths: a bounded
      // target is not a bounded glyph, because the spring is under-damped and
      // the head keeps moving while it chases.
      interiorContain(world, velocity, restWorld, budgetsWorld, count);
      // Follows `count` in BOTH directions. Dropping the count and raising it
      // again must re-seed the slots it exposes, or they come back holding a
      // world position from whatever pose the head was in when they were last
      // drawn.
      seededCount = count;

      const view = state.camera.matrixWorld.elements;
      cameraRight.set(view[0] ?? 1, view[1] ?? 0, view[2] ?? 0).normalize();
      cameraUp.set(view[4] ?? 0, view[5] ?? 1, view[6] ?? 0).normalize();
      cameraForward.set(-(view[8] ?? 0), -(view[9] ?? 0), -(view[10] ?? 1)).normalize();
      cameraPos.set(view[12] ?? 0, view[13] ?? 0, view[14] ?? 0);

      writeBuffers();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
