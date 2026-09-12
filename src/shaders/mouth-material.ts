import { FrontSide, NoBlending, type Material } from 'three';
import { NodeMaterial, type MeshStandardNodeMaterial } from 'three/webgpu';
import {
  Fn, attribute, dot, float, luminance, mix, normalGeometry, normalView,
  positionGeometry, pow, reference, saturate, smoothstep, texture, vec2, vec3,
} from 'three/tsl';
import type { TextSkinEngine } from '../contracts';
import { inheritLiquidInterior } from './liquid-material';

/** The same atlas dimensions the face projection consumes. */
export const MOUTH_ATLAS_COLUMNS = 96;
export const MOUTH_ATLAS_ROWS = 64;
/** Cells per model unit: finer than the face, close to the eyes' scale. */
export const MOUTH_TEETH_DENSITY = 320;
export const MOUTH_TONGUE_DENSITY = 220;

const glyphSources = new WeakMap<Material, TextSkinEngine>();

/** Internal VFX binding. The mouth borrows this atlas; it never owns it. */
export function bindMouthGlyphSource(surface: Material, skin: TextSkinEngine): void {
  glyphSources.set(surface, skin);
}

/**
 * Source-labelled teeth and tongue, built from letters rather than enamel.
 * A dark, opaque backing keeps the glyphs readable on arbitrary page colours.
 * Source labels, not coordinate bands, decide which surface is which.
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

  const roles = Fn((builder) => builder.geometry.hasAttribute('_oral_region')
    ? attribute('_oral_region', 'vec2') : vec2(0))();
  const teeth = roles.x.saturate();
  const tongue = roles.y.saturate().mul(float(1).sub(teeth));
  const surfaceColour = vec3(front.colorNode ?? vec3(0));
  const source = glyphSources.get(surface);
  // Legacy standalone builders retain their borrowed glyph source. The VFX
  // factory supplies the live atlas for the finer, surface-following field.
  let ink = float(luminance(surfaceColour).clamp(0, 1));
  if (source) {
    const density = mix(MOUTH_TONGUE_DENSITY, MOUTH_TEETH_DENSITY, teeth);
    const p = positionGeometry.mul(density);
    const scroll = reference('scrollOffset', 'float', source);
    const scale = vec2(1 / MOUTH_ATLAS_COLUMNS, 1 / MOUTH_ATLAS_ROWS);
    const flow = vec2(0, scroll);
    const onX = luminance(texture(source.texture, vec2(p.z, p.y).mul(scale).add(flow)).rgb);
    const onY = luminance(texture(source.texture, vec2(p.x, p.z.negate()).mul(scale).add(flow)).rgb);
    const onZ = luminance(texture(source.texture, vec2(p.x, p.y).mul(scale).add(flow)).rgb);
    // Bind-space projections follow the tongue's upper surface and tooth
    // fronts. Sharp weights avoid a cloudy double image around curved edges.
    const weights = pow(normalGeometry.abs().add(0.0001), 12);
    const total = weights.x.add(weights.y).add(weights.z);
    ink = float(onX.mul(weights.x).add(onY.mul(weights.y)).add(onZ.mul(weights.z)).div(total));
  }
  const letters = smoothstep(0.06, 0.68, ink);
  // normalView resolves material.normalNode inside Three's NORMAL sub-build.
  // Embedding front.normalNode here instead recursively evaluates the normal
  // graph from the colour sub-build and can black out the entire surface.
  const normal = normalView;
  const key = saturate(dot(normal, vec3(1.2, 1.6, 2).normalize()));
  const fill = saturate(dot(normal, vec3(-1.5, 0.4, 1).normalize()));
  const shade = key.mul(0.63).add(fill.mul(0.19)).add(0.18);
  // Illuminate the strokes, not an enamel fill. A modest floor keeps side
  // teeth readable instead of reducing their finer letters to dim speckles.
  const glyphLight = shade.mul(0.7).add(0.3);
  const depthLight = mix(0.35, 1, smoothstep(0.1, 0.255, positionGeometry.z));
  const liveLight = luminance(surfaceColour).clamp(0, 1).mul(0.08).add(0.92);
  const teethColour = vec3(0.46, 0.76, 1).mul(letters).mul(glyphLight).mul(liveLight)
    .add(vec3(0.003, 0.009, 0.017).mul(shade)).mul(depthLight);
  const tipLight = smoothstep(0.12, 0.235, positionGeometry.z).mul(0.65).add(0.35);
  const roundedSides = float(1).sub(smoothstep(0.016, 0.046, positionGeometry.x.abs()).mul(0.25));
  const centreGroove = smoothstep(0.001, 0.006, positionGeometry.x.abs()).mul(0.12).add(0.88);
  const tongueColour = vec3(0.52, 0.17, 0.8).mul(letters).mul(glyphLight).mul(liveLight)
    .add(vec3(0.012, 0.0025, 0.018).mul(shade))
    .mul(tipLight).mul(roundedSides).mul(centreGroove);
  const cavity = vec3(0.001, 0.0015, 0.003);
  material.colorNode = mix(mix(cavity, tongueColour, tongue), teethColour, teeth).clamp(0, 1);
  material.positionNode = front.positionNode;
  material.normalNode = front.normalNode;
  inheritLiquidInterior(surface, material);

  const release = material.dispose.bind(material);
  let disposed = false;
  material.dispose = () => {
    if (disposed) return;
    disposed = true;
    release();
  };
  return material;
}
