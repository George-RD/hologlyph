/**
 * Single-source TSL text-skin material (dec.renderer-posture).
 *
 * One NodeMaterial serves both WebGPU and WebGL2 backends. It samples the skin
 * CanvasTexture and offsets the lookup UV by a `scroll` uniform that the engine
 * drives from `skin.scrollOffset` each frame (GPU UV scroll, no CPU redraw).
 * An emissive term derived from the sampled glyph colour readies the skin for
 * selective HDR bloom.
 *
 * No GPU resources are constructed at module load: the material and its node
 * graph are built lazily inside `buildSkinMaterial`, so importing this module
 * under happy-dom is safe.
 */

import { MeshStandardNodeMaterial } from 'three/webgpu';
import { texture, uv, uniform, vec2 } from 'three/tsl';
import type * as THREE from 'three';
import type { TextSkinEngine } from '../contracts';

/** The float uniform we advance each frame from `skin.scrollOffset`. */
export interface ScrollUniform {
  value: number;
}

export interface BuiltSkinMaterial {
  material: THREE.Material;
  scroll: ScrollUniform;
}

/**
 * Build the single TSL text-skin material for `skin`.
 *
 * The scroll uniform starts at 0; the engine writes `skin.scrollOffset` into
 * `scroll.value` every `update(dt)`.
 */
export function buildSkinMaterial(skin: TextSkinEngine): BuiltSkinMaterial {
  const material = new MeshStandardNodeMaterial();
  material.metalness = 0.1;
  material.roughness = 0.6;

  // Vertical UV scroll: offset the V coordinate by the scroll phase.
  const scroll = uniform(0);
  const uvOffset = uv().add(vec2(0, scroll));
  const sampled = texture(skin.texture, uvOffset);

  // Glyph colour straight from the texture.
  material.colorNode = sampled.rgb;

  // Emissive from glyph luminance-ish colour for selective-bloom readiness.
  material.emissiveNode = sampled.rgb.mul(0.8);

  return {
    material: material as unknown as THREE.Material,
    scroll: scroll as unknown as ScrollUniform,
  };
}
