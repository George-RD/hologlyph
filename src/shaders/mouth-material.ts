import { FrontSide, NoBlending, type Material } from 'three';
import { NodeMaterial, type MeshStandardNodeMaterial } from 'three/webgpu';
import {
  dot,
  float,
  luminance,
  mix,
  normalView,
  positionGeometry,
  positionViewDirection,
  pow,
  saturate,
  smoothstep,
  vec3,
} from 'three/tsl';

/**
 * Give the mouth depth without turning its anatomy into a black void.
 *
 * The current shipped asset folds teeth, gums and tongue into one morph-bearing
 * primitive, so this pass separates their visible planes in bind space rather
 * than adding another mesh or breaking the speech rig. The treatment stays in
 * the head's visual language: every role borrows the same live glyph graph and
 * deformation, but teeth get a cool porcelain/cyan lift, the tongue a restrained
 * violet warmth, and the cavity remains dark enough to hold depth behind them.
 */
export function buildMouthMaterial(surface: Material): Material {
  const front = surface as MeshStandardNodeMaterial;
  const material = new NodeMaterial();
  material.name = 'mouth_interior';
  material.side = FrontSide;
  material.transparent = false;
  material.blending = NoBlending;
  material.depthTest = true;
  material.depthWrite = true;

  const surfaceColour = vec3(front.colorNode ?? vec3(0));
  const glyph = mix(vec3(luminance(surfaceColour)), surfaceColour, 0.3);
  const rim = pow(saturate(float(1).sub(dot(normalView, positionViewDirection))), 3);

  // Dental rows sit forward in the combined primitive, with the upper and
  // lower rows occupying stable bind-space bands across all authored visemes.
  const frontness = smoothstep(0.12, 0.235, positionGeometry.z);
  const upperDental = smoothstep(-0.005, 0.018, positionGeometry.y)
    .mul(float(1).sub(smoothstep(0.045, 0.065, positionGeometry.y)));
  const lowerDental = smoothstep(-0.075, -0.045, positionGeometry.y)
    .mul(float(1).sub(smoothstep(-0.02, 0.0, positionGeometry.y)));
  const dental = upperDental.add(lowerDental).clamp(0, 1).mul(frontness);

  // The visible tongue plane is central, lower and forward. Keep its edge soft
  // so the classification reads as illumination, not a painted vertex mask.
  const central = float(1).sub(smoothstep(0.045, 0.085, positionGeometry.x.abs()));
  const tongue = smoothstep(-0.09, -0.06, positionGeometry.y)
    .mul(float(1).sub(smoothstep(-0.015, 0.005, positionGeometry.y)))
    .mul(central)
    .mul(frontness)
    .mul(float(1).sub(dental));

  const cavityColour = vec3(0.002, 0.004, 0.007).add(glyph.mul(0.2));
  const tongueColour = vec3(0.075, 0.045, 0.09)
    .add(glyph.mul(vec3(0.38, 0.22, 0.42)))
    .add(vec3(0.035, 0.025, 0.05).mul(rim));
  const teethColour = vec3(0.12, 0.17, 0.2)
    .add(glyph.mul(0.55))
    .add(vec3(0.08, 0.12, 0.15).mul(rim));

  material.colorNode = mix(mix(cavityColour, tongueColour, tongue), teethColour, dental).clamp(0, 0.62);
  material.positionNode = front.positionNode;
  material.normalNode = front.normalNode;

  const release = material.dispose.bind(material);
  let disposed = false;
  material.dispose = () => {
    if (disposed) return;
    disposed = true;
    release();
  };
  return material;
}
