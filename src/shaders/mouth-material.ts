import { FrontSide, NoBlending, type Material } from 'three';
import { NodeMaterial, type MeshStandardNodeMaterial } from 'three/webgpu';
import {
  Fn, attribute, dot, float, luminance, mix, normalWorld,
  positionGeometry, pow, saturate, smoothstep, vec2, vec3,
} from 'three/tsl';

/**
 * Opaque, source-labelled anatomy inside the holographic face.
 *
 * The asset carries [teeth, tongue] weights from the source material groups
 * and authored tongue mask. Gums are neither. No coordinate bands decide
 * anatomical identity, so a bright gum wall cannot masquerade as teeth.
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

  // GLTFLoader lowercases custom attribute semantics. A legacy/custom avatar
  // without the labels keeps a dark cavity, without guessing its anatomy.
  const roles = Fn((builder) => builder.geometry.hasAttribute('_oral_region')
    ? attribute('_oral_region', 'vec2') : vec2(0))();
  const teeth = roles.x.saturate();
  const tongue = roles.y.saturate().mul(float(1).sub(teeth));
  const surfaceColour = vec3(front.colorNode ?? vec3(0));
  const glyph = mix(vec3(luminance(surfaceColour)), surfaceColour, 0.2).clamp(0, 1);

  // The same world-space key/fill directions as the face. Shape comes from
  // normals, not a flat emissive fill or a rim around the entire concavity.
  const key = saturate(dot(normalWorld, vec3(1.2, 1.6, 2).normalize()));
  const fill = saturate(dot(normalWorld, vec3(-1.5, 0.4, 1).normalize()));
  const shade = key.mul(0.72).add(fill.mul(0.18)).add(0.1);
  // Light recedes into the mouth. This affects illumination only, not labels.
  const depthLight = mix(0.25, 1, smoothstep(0.1, 0.255, positionGeometry.z));
  const enamel = vec3(0.24, 0.29, 0.31).mul(pow(shade, 1.25))
    .add(glyph.mul(vec3(0.10, 0.13, 0.14)))
    .add(vec3(0.035, 0.05, 0.055).mul(pow(key, 12)))
    .mul(depthLight);
  // A dark root, rounded sides and a restrained centre groove reveal the
  // tongue's volume. These terms shade the labelled surface; they do not
  // colour the gum wall or manufacture a tongue where no tongue exists.
  const tipLight = pow(smoothstep(0.14, 0.24, positionGeometry.z), 1.3);
  const roundedSides = float(1).sub(smoothstep(0.014, 0.044, positionGeometry.x.abs()).mul(0.4));
  const centreGroove = smoothstep(0.001, 0.006, positionGeometry.x.abs()).mul(0.23).add(0.77);
  const tongueSurface = mix(vec3(0.006, 0.004, 0.01), vec3(0.15, 0.085, 0.17), tipLight)
    .mul(shade.mul(0.85).add(0.15)).mul(roundedSides).mul(centreGroove)
    .add(glyph.mul(vec3(0.055, 0.035, 0.065)).mul(tipLight));
  const cavity = vec3(0.001, 0.0015, 0.0025).add(glyph.mul(0.012));
  material.colorNode = mix(mix(cavity, tongueSurface, tongue), enamel, teeth).clamp(0, 0.45);
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
