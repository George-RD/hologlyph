/**
 * Single-source TSL text-skin material (dec.renderer-posture).
 *
 * bind-space triplanar glyph sampling (so side surfaces keep readable
 * character density) and derives a translucent holo look from sampled colour.
 *
 * No GPU resources are constructed at module load: the material and its node
 * graph are built lazily inside `buildSkinMaterial`, so importing this module
 * under happy-dom is safe.
 */

import { LinearFilter, RepeatWrapping } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  dot,
  float,
  floor,
  fract,
  luminance,
  normalGeometry,
  normalView,
  normalWorld,
  positionGeometry,
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
export const PLANAR_DENSITY = 20;

/** Horizontal projection scale: u advances this much per world unit of x. */
export const U_SCALE = PLANAR_DENSITY / GRID_COLS;

/** Vertical projection scale: v advances this much per world unit of y. */
export const V_SCALE = PLANAR_DENSITY / GRID_ROWS;

/** Opacity floor for unlit backdrop pixels; lit glyphs approach full opacity. */
export const BASE_OPACITY = 0.02;

/** Multiplier on the sampled glyph colour that drives the emissive glow. */
export const GLOW_GAIN = 1.9;

/** Strength of the cool fresnel rim added to the emissive for the holo edge. */
export const RIM_GAIN = 0.12;
/** Key directional-light weight for the matte skin-shading term (scene key intensity 2.2, white). */
export const SHADE_KEY_WEIGHT = 2.2;

/** Fill directional-light weight for the matte skin-shading term (scene fill intensity 0.8, cool). */
export const SHADE_FILL_WEIGHT = 0.8;

/** Small additive ambient floor so shadowed skin keeps a faint base luminance. */
export const SHADE_AMBIENT = 0.08;

/** Lower clamp on the skin-shading term so facial glyphs never read fully black. */
export const SHADE_FLOOR = 0.12;

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
 * centred on x=0 and v stays anchored to bind-pose y; row flow advances u.
 * Mirrors the maths used inside `buildSkinMaterial`.
 */
export function planarUV(x: number, y: number): { u: number; v: number } {
  return { u: x * U_SCALE + 0.5, v: y * V_SCALE };
}

/** Pure row-staggered flow UVs, mirroring the shader's bind-pose mapping. */
export function rowFlowUV(
  x: number,
  y: number,
  scroll: number,
): { u: number; v: number; rowRate: number } {
  const row = Math.floor(y * PLANAR_DENSITY);
  const phase = ((row * 0.618) % 1 + 1) % 1;
  const rowRate = 0.75 + phase * 0.5;
  return {
    u: x * U_SCALE + 0.5 + scroll * rowRate,
    v: y * V_SCALE,
    rowRate,
  };
}

/** Pure squared normal weights used by bind-space triplanar sampling. */
export function triplanarWeights(
  nx: number,
  ny: number,
  nz: number,
): { x: number; y: number; z: number } {
  const x = nx * nx;
  const y = ny * ny;
  const z = nz * nz;
  const sum = x + y + z || 1;
  return { x: x / sum, y: y / sum, z: z / sum };
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

  // Project one continuous grid across the visible front. Each bind-pose row
  // advances horizontally at its own GPU scroll rate. RepeatWrapping tiles
  // content without breaking surface anchoring; grazing-angle stretching is
  // intentional for this projected hologram.
  material.transparent = true;
  material.depthTest = true;
  material.depthWrite = true;

  const skinTexture = skin.texture;
  skinTexture.wrapS = RepeatWrapping;
  skinTexture.wrapT = RepeatWrapping;
  skinTexture.generateMipmaps = false;
  skinTexture.minFilter = LinearFilter;
  skinTexture.magFilter = LinearFilter;
  skinTexture.anisotropy = Math.max(skinTexture.anisotropy, 4);
  const scroll = uniform(0);
  // Sample XY, ZY, and XZ planes in bind space. Squared normal weights make
  // the dominant surface axis win while softening transitions at corners.
  const bindNormal = normalGeometry.normalize();
  const axisWeights = bindNormal.abs().pow(2);
  const weights = axisWeights.div(axisWeights.dot(vec3(1)));
  const rowY = floor(positionGeometry.y.mul(PLANAR_DENSITY));
  const rowZ = floor(positionGeometry.z.mul(PLANAR_DENSITY));
  const rateY = float(0.75).add(fract(rowY.mul(0.618)).mul(0.5));
  const rateZ = float(0.75).add(fract(rowZ.mul(0.618)).mul(0.5));
  const sampleXY = texture(
    skinTexture,
    vec2(
      positionGeometry.x.mul(U_SCALE).add(0.5).add(scroll.mul(rateY)),
      positionGeometry.y.mul(V_SCALE),
    ),
  );
  const sampleZY = texture(
    skinTexture,
    vec2(
      positionGeometry.z.mul(U_SCALE).add(0.5).add(scroll.mul(rateY)),
      positionGeometry.y.mul(V_SCALE),
    ),
  );
  const sampleXZ = texture(
    skinTexture,
    vec2(
      positionGeometry.x.mul(U_SCALE).add(0.5).add(scroll.mul(rateZ)),
      positionGeometry.z.mul(V_SCALE),
    ),
  );
  const sampled = sampleXY.mul(weights.z).add(sampleZY.mul(weights.x)).add(sampleXZ.mul(weights.y));

  // Matte skin shading: the glyphs encode the bust's key/fill illumination.
  const keyDir = vec3(1.2, 1.6, 2.0).normalize();
  const fillDir = vec3(-1.5, 0.4, 1.0).normalize();
  const shade = saturate(dot(normalWorld, keyDir)).mul(SHADE_KEY_WEIGHT)
    .add(saturate(dot(normalWorld, fillDir)).mul(SHADE_FILL_WEIGHT))
    .add(SHADE_AMBIENT)
    .clamp(SHADE_FLOOR, 1);

  // The unlit surface disappears between glyphs; characters carry luminance.
  const luma = luminance(sampled.rgb);
  material.colorNode = sampled.rgb.mul(shade);
  material.opacityNode = luma.mul(1 - BASE_OPACITY).add(BASE_OPACITY);

  // Emissive glow (also shaded by the skin term) plus a subtle cool fresnel
  // rim for the holographic edge. The rim stays un-shaded so the holo
  // contour reads at full strength regardless of facial angle.
  const rim = pow(
    saturate(float(1).sub(dot(normalView, positionViewDirection))),
    3,
  ).mul(RIM_GAIN);
  const rimTint = vec3(0.5, 0.7, 1.0).mul(rim);
  material.emissiveNode = sampled.rgb.mul(GLOW_GAIN).mul(shade).add(rimTint);

  return {
    material: material as unknown as THREE.Material,
    scroll: scroll as unknown as ScrollUniform,
  };
}
