import { Mesh, SphereGeometry, Vector4, type DataTexture } from 'three';
import { MeshStandardNodeMaterial, type NodeMaterial } from 'three/webgpu';
import {
  cross, dFdx, dFdy, float, luminance, normalView, positionGeometry,
  positionLocal, positionView, reference, smoothstep, texture, uniform, vec2, vec3,
} from 'three/tsl';
import type { TextSkinEngine } from '../contracts';
import { LIQUID_BOUNDARY_RADIUS } from './liquid-boundary';
import { LIQUID_MAX_HEIGHT, LIQUID_THICKNESS, type LiquidDynamics } from './liquid-dynamics';

/**
 * A single connected closed surface, independent of the avatar's vertices.
 * Borrows the live glyph atlas and wave texture. Its owner supplies the only
 * simulation clock and attaches the mesh to the complete rig's carrier.
 */
export class LiquidFreeSurface {
  readonly amount = uniform(0);
  readonly minY = uniform(0);
  readonly extent = uniform(0);
  private readonly modes = uniform(new Vector4());
  private readonly areaScale = uniform(1);
  private surface: Mesh<SphereGeometry, MeshStandardNodeMaterial> | null = null;

  /** Owned render mesh, allocated lazily when a skin is attached. */
  get mesh(): Mesh<SphereGeometry, MeshStandardNodeMaterial> | null { return this.surface; }

  /**
   * Shared target for the collapsing head and the independent surface. Angular
   * harmonics are evaluated algebraically, avoiding an undefined atan at poles.
   * The radial mode cap makes every horizontal cross-section remain positive.
   */
  position(direction: NonNullable<NodeMaterial['positionNode']>, field: DataTexture): NonNullable<NodeMaterial['positionNode']> {
    const input = vec3(direction);
    const unit = input.div(input.length().max(1e-8));
    const horizontal = unit.xz.div(unit.xz.length().max(1e-8));
    const c = horizontal.x;
    const s = horizontal.y;
    const c2 = c.mul(c).sub(s.mul(s));
    const s2 = c.mul(s).mul(2);
    const c3 = c.mul(c).mul(c).sub(c.mul(s).mul(s).mul(3));
    const s3 = c.mul(c).mul(s).mul(3).sub(s.mul(s).mul(s));
    const radius = float(1).add(c2.mul(this.modes.x)).add(s2.mul(this.modes.y))
      .add(c3.mul(this.modes.z)).add(s3.mul(this.modes.w)).mul(this.areaScale);
    const span = this.extent.max(0.0001);
    const xz = unit.xz.mul(radius).mul(span.mul(LIQUID_BOUNDARY_RADIUS));
    const uv = unit.xz.mul(0.5).add(0.5);
    const packed = texture(field, uv).level(float(0));
    const wave = packed.r.mul(65280).add(packed.g.mul(255)).sub(32768)
      .div(32767).mul(LIQUID_MAX_HEIGHT).mul(span);
    const height = unit.y.add(1).mul(0.5);
    return vec3(xz.x, this.minY.add(height.mul(span).mul(LIQUID_THICKNESS))
      .add(wave.mul(height)), xz.y);
  }

  /** Allocate one modest closed mesh and shade it using the existing atlas. */
  attach(skin: TextSkinEngine, field: DataTexture): void {
    this.dispose();
    const material = new MeshStandardNodeMaterial();
    material.name = 'hologlyph_liquid_surface';
    material.transparent = true;
    material.depthWrite = false;
    material.roughness = 0.38;
    material.metalness = 0.12;
    material.positionNode = this.position(positionGeometry, field);
    const gradient = cross(dFdx(positionView), dFdy(positionView));
    material.normalNode = gradient.div(gradient.length().max(1e-8));
    const scroll = reference('scrollOffset', 'float', skin);
    const uv = vec2(positionLocal.x, positionLocal.z.negate())
      .mul(vec2(90 / 96, 90 / 64)).add(vec2(0, scroll));
    const letters = smoothstep(0.06, 0.68, luminance(texture(skin.texture, uv).rgb));
    const glow = letters.mul(normalView.z.abs().mul(0.5).add(0.5));
    material.colorNode = vec3(0.08, 0.43, 0.85).mul(glow).add(vec3(0.002, 0.014, 0.035));
    material.emissiveNode = vec3(0.025, 0.15, 0.32).mul(glow);
    material.opacityNode = smoothstep(0.65, 0.95, this.amount).mul(0.96);
    const mesh = new Mesh(new SphereGeometry(1, 64, 24), material);
    mesh.name = 'hologlyph_liquid_surface';
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.surface = mesh;
  }

  /** Synchronise uniforms only; never advance the simulation from rendering. */
  sync(body: LiquidDynamics): void {
    this.amount.value = body.amount;
    this.modes.value.set(...body.boundary.modes);
    this.areaScale.value = body.boundary.areaScale;
    if (this.surface) {
      this.surface.visible = body.amount > 0.65 && this.extent.value > 0;
      // During handover the translucent surface must not cut holes in the
      // still-visible head. Once it owns the body, it owns depth as well.
      this.surface.material.depthWrite = body.amount >= 0.95;
    }
  }

  /** Release the mesh, but never the borrowed atlas or wave texture. */
  dispose(): void {
    this.surface?.removeFromParent();
    this.surface?.geometry.dispose();
    this.surface?.material.dispose();
    this.surface = null;
  }
}
