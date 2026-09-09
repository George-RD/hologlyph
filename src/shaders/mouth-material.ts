import { FrontSide, NoBlending, type Material } from 'three';
import { NodeMaterial, type MeshStandardNodeMaterial } from 'three/webgpu';
import {
  float,
  luminance,
  mix,
  positionGeometry,
  smoothstep,
  vec3,
} from 'three/tsl';

/**
 * Keep the mouth legible as anatomy rather than a luminous cavity.
 *
 * ICT folds teeth/gums/tongue into one morph-bearing primitive. Classify only
 * the narrow bind-space regions that actually read as dental rows and tongue;
 * everything else stays close to black. Deliberately avoid view-facing rim
 * light here: it was lighting the whole concave shell and produced a fog/cloud
 * inside the mouth instead of discrete forms.
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
  const glyph = mix(vec3(luminance(surfaceColour)), surfaceColour, 0.22);

  // Require geometry to be genuinely forward before it can become bright.
  // This rejects the rear cavity and most gum/cheek wall vertices.
  const forward = smoothstep(0.185, 0.245, positionGeometry.z);
  const centreDental = float(1).sub(smoothstep(0.075, 0.125, positionGeometry.x.abs()));

  // Thin dental bands: enough white edge to read as teeth without turning the
  // entire upper/lower mouth shell into one glowing slab.
  const upperDental = smoothstep(0.006, 0.017, positionGeometry.y)
    .mul(float(1).sub(smoothstep(0.034, 0.046, positionGeometry.y)));
  const lowerDental = smoothstep(-0.061, -0.049, positionGeometry.y)
    .mul(float(1).sub(smoothstep(-0.031, -0.019, positionGeometry.y)));
  const dental = upperDental.add(lowerDental).clamp(0, 1).mul(forward).mul(centreDental);

  // Tongue is lower, central, and slightly less forward than the teeth. Its
  // mask is intentionally tighter and dimmer so it reads as a surface behind
  // the teeth, not as a second light source.
  const tongueCentre = float(1).sub(smoothstep(0.038, 0.068, positionGeometry.x.abs()));
  const tongueDepth = smoothstep(0.145, 0.205, positionGeometry.z)
    .mul(float(1).sub(smoothstep(0.225, 0.245, positionGeometry.z)));
  const tongueBand = smoothstep(-0.09, -0.073, positionGeometry.y)
    .mul(float(1).sub(smoothstep(-0.038, -0.02, positionGeometry.y)));
  const tongue = tongueBand.mul(tongueCentre).mul(tongueDepth).mul(float(1).sub(dental));

  // Near-black cavity is the dominant state. Glyph contribution is deliberately
  // tiny here: the mouth should contain negative space, not a glowing cloud.
  const cavityColour = vec3(0.0015, 0.002, 0.003).add(glyph.mul(0.025));
  const tongueColour = vec3(0.055, 0.024, 0.052).add(glyph.mul(vec3(0.12, 0.055, 0.13)));
  const teethColour = vec3(0.28, 0.32, 0.33).add(glyph.mul(vec3(0.2, 0.24, 0.25)));

  material.colorNode = mix(mix(cavityColour, tongueColour, tongue), teethColour, dental).clamp(0, 0.48);
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
