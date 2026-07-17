/**
 * Single-source TSL text-skin material (dec.renderer-posture).
 *
 * One NodeMaterial serves both WebGPU and WebGL2 backends. It projects a
 * frontal planar glyph grid straight from object space (so the grid is one
 * continuous constant-scale matrix across the face, neck, and chest;
 * authored UV islands are no longer in the sample path) and derives a
 * translucent holo look from the sampled glyph colour.
 *
 * No GPU resources are constructed at module load: the material and its node
 * graph are built lazily inside `buildSkinMaterial`, so importing this module
 * under happy-dom is safe.
 */

import { RepeatWrapping } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  dot,
  float,
  luminance,
  normalView,
  positionLocal,
  positionViewDirection,
  pow,
  saturate,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import type * as THREE from 'three';
import type { TextSkinEngine } from '../contracts';

/** Default glyph grid shape (mirrors DEFAULT_GRID in text-skin). */
const GRID_COLS = 96;
const GRID_ROWS = 64;

/** Glyph cells per world unit for the planar projection (tuned in the demo). */
export const PLANAR_DENSITY = 124;

/** Horizontal projection scale: u advances this much per world unit of x. */
export const U_SCALE = PLANAR_DENSITY / GRID_COLS;

/** Vertical projection scale: v advances this much per world unit of y. */
export const V_SCALE = PLANAR_DENSITY / GRID_ROWS;

/** Opacity floor for unlit backdrop pixels; lit glyphs approach full opacity. */
export const BASE_OPACITY = 0.35;

/** Multiplier on the sampled glyph colour that drives the emissive glow. */
export const GLOW_GAIN = 1.4;

/** Strength of the cool fresnel rim added to the emissive for the holo edge. */
export const RIM_GAIN = 0.12;

/** The float uniform we advance each frame from `skin.scrollOffset`. */
export interface ScrollUniform {
  value: number;
}

export interface BuiltSkinMaterial {
  material: THREE.Material;
  scroll: ScrollUniform;
}

/**
 * Pure frontal planar UV projection from object-space coordinates.
 *
 * The glyph grid is projected straight onto the XY plane (the bust faces +z),
 * so the visible front carries one continuous constant-scale grid: identical
 * columns and rows across face, neck, and chest. `U_SCALE`/`V_SCALE` are
 * aspect-corrected so cells stay square for the default 96x64 grid. u is
 * centred on x=0; v is unbounded so callers may add a scroll phase. Mirrors
 * the maths used inside `buildSkinMaterial`.
 */
export function planarUV(x: number, y: number): { u: number; v: number } {
  return { u: x * U_SCALE + 0.5, v: y * V_SCALE };
}

/**
 * Build the single TSL text-skin material for `skin`.
 *
 * The scroll uniform starts at 0; the engine writes `skin.scrollOffset` into
 * `scroll.value` every `update(dt)`.
 */
export function buildSkinMaterial(skin: TextSkinEngine): BuiltSkinMaterial {
  const material = new MeshStandardNodeMaterial();
  material.metalness = 0;
  material.roughness = 0.4;

  // Frontal planar object-space projection: one continuous constant-scale
  // grid across the whole visible front (the demo's canonical view), plus
  // the GPU scroll phase on v. RepeatWrapping lets the grid tile across
  // texture edges and under scroll without a manual fract. Glyphs stretch
  // along the silhouette at grazing angles, which reads as intentional for
  // a projected hologram, unlike UV-island seams or cylindrical crown
  // pinching.
  material.transparent = true;

  const skinTexture = skin.texture;
  skinTexture.wrapS = RepeatWrapping;
  skinTexture.wrapT = RepeatWrapping;

  const scroll = uniform(0);
  const projected = vec2(
    positionLocal.x.mul(U_SCALE).add(0.5),
    positionLocal.y.mul(V_SCALE).add(scroll),
  );
  const sampled = texture(skinTexture, projected);

  // Glyph colour straight from the texture.
  material.colorNode = sampled.rgb;

  // Translucency: unlit backdrop at BASE_OPACITY, lit glyphs approach opaque.
  const luma = luminance(sampled.rgb);
  material.opacityNode = luma.mul(1 - BASE_OPACITY).add(BASE_OPACITY);

  // Emissive glow plus a subtle cool fresnel rim for the holographic edge.
  const rim = pow(
    saturate(float(1).sub(dot(normalView, positionViewDirection))),
    3,
  ).mul(RIM_GAIN);
  const rimTint = vec3(0.5, 0.7, 1.0).mul(rim);
  material.emissiveNode = sampled.rgb.mul(GLOW_GAIN).add(rimTint);

  return {
    material: material as unknown as THREE.Material,
    scroll: scroll as unknown as ScrollUniform,
  };
}
