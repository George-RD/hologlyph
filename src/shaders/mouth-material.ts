/**
 * An inner surface, not a second skin or an anatomical insert.
 *
 * The shipped teeth, gums and tongue share one primitive. Borrow the face's
 * live glyph graph so its source, density, palette and flow cannot drift, but
 * keep the cavity mostly dark and suppress flesh-coloured feature tinting.
 * No extra atlas, uniform updater, render pass or material per tooth.
 */
import { FrontSide, NoBlending, type Material } from 'three';
import { NodeMaterial, type MeshStandardNodeMaterial } from 'three/webgpu';
import { dot, float, luminance, mix, normalView, positionViewDirection, pow, saturate, vec3 } from 'three/tsl';

export function buildMouthMaterial(surface: Material): Material {
  const front = surface as MeshStandardNodeMaterial;
  // MeshBasicNodeMaterial ignores normalNode in Three r178. The unlit base
  // honours it, so the shared deformation has matching shading normals too.
  const material = new NodeMaterial();
  // The engine recognises this name as an internal depth-writing surface.
  material.name = 'mouth_interior';
  material.side = FrontSide;
  material.transparent = false;
  material.blending = NoBlending;
  material.depthTest = true;
  material.depthWrite = true;

  // No alpha holes: a transparent tongue would reveal the back of the gums,
  // and a luminous tooth would become a floating object behind closed lips.
  const colour = vec3(front.colorNode ?? vec3(0));
  const etched = mix(vec3(luminance(colour)), colour, 0.25).mul(0.32);
  const rim = pow(saturate(float(1).sub(dot(normalView, positionViewDirection))), 3);
  material.colorNode = vec3(0.002, 0.004, 0.006)
    .add(etched)
    .add(vec3(0.012, 0.020, 0.028).mul(rim))
    .clamp(0, 0.22);

  // Reuse the actual graph, not a rest-position copy: morphs and skinning run
  // first, then the same melt/flow map and corrected normals as the shell.
  material.positionNode = front.positionNode;
  material.normalNode = front.normalNode;
  // Core and a custom avatar may both release installed materials. Keep this
  // surface idempotent without taking ownership of the shared graph/texture.
  const release = material.dispose.bind(material);
  let disposed = false;
  material.dispose = () => {
    if (disposed) return;
    disposed = true;
    release();
  };
  return material;
}
