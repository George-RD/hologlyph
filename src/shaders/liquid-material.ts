import {
  DataTexture, LinearFilter, RGBAFormat, UnsignedByteType, Vector2,
  type Material,
} from 'three';
import type { MeshStandardNodeMaterial, NodeMaterial } from 'three/webgpu';
import {
  Fn, If, cross, dFdx, dFdy, float, luminance, mix, normalView,
  positionLocal, positionView, reference, select, smoothstep,
  texture, uniform, vec2, vec3,
} from 'three/tsl';
import type { SkinMaterials, TextSkinEngine, VFXEngine } from '../contracts';
import {
  LIQUID_LAG, LIQUID_MAX_HEIGHT, LIQUID_RESOLUTION, LIQUID_THICKNESS,
  LiquidDynamics, type LiquidPoint,
} from './liquid-dynamics';

export interface LiquidControls {
  readonly amount: number;
  readonly targetAmount: number;
  readonly position: LiquidPoint;
  readonly velocity: LiquidPoint;
  readonly canSteer: boolean;
  /** 0 is the speaking head, 1 is liquid. Interrupted transitions are continuous. */
  setAmount(amount: number, immediate?: boolean): void;
  /** Model-space X/Y placement. Enabled only once the body is fully liquid. */
  steerTo(x: number, y: number): boolean;
  release(): void;
  /** Disturb the surface at local disc coordinates in [-1,1]. */
  impulse(x: number, y: number, strength?: number): void;
}

const owners = new WeakMap<VFXEngine, LiquidMaterialOwner>();
const surfaceOwners = new WeakMap<Material, LiquidMaterialOwner>();

/** Opt-in controls. The VFX engine owns the clock and all GPU resources. */
export function liquidBody(vfx: VFXEngine): LiquidControls {
  const owner = owners.get(vfx);
  if (!owner) throw new Error('This VFX engine has no liquid-body binding');
  return owner.dynamics;
}

export function bindLiquidEngine(vfx: VFXEngine, owner: LiquidMaterialOwner): void {
  owners.set(vfx, owner);
}

/** Keep labelled mouth internals on the body's existing deformation graph. */
export function inheritLiquidInterior(surface: Material, material: NodeMaterial): void {
  surfaceOwners.get(surface)?.gateInterior(material);
}

/** Visibility factor for authored trim that has not adopted the liquid graph. */
export function liquidInteriorVisibility(vfx: VFXEngine): number {
  const amount = owners.get(vfx)?.dynamics.amount ?? 0;
  return 1 - Math.min(1, Math.max(0, amount / 0.08));
}

export class LiquidMaterialOwner {
  readonly dynamics = new LiquidDynamics();
  private readonly amount = uniform(0);
  private readonly minY = uniform(0);
  private readonly extent = uniform(0);
  private readonly offset = uniform(new Vector2());
  private readonly pixels = new Uint8Array(LIQUID_RESOLUTION ** 2 * 4);
  private field: DataTexture | null = null;
  private dead = false;
  private fieldWasActive = false;

  private fieldTexture(): DataTexture {
    if (!this.field) {
      this.dynamics.writeTexture(this.pixels);
      this.field = new DataTexture(this.pixels, LIQUID_RESOLUTION, LIQUID_RESOLUTION, RGBAFormat, UnsignedByteType);
      this.field.minFilter = LinearFilter;
      this.field.magFilter = LinearFilter;
      this.field.generateMipmaps = false;
      this.field.needsUpdate = true;
    }
    return this.field;
  }

  private projection(original: NodeMaterial['positionNode']): NonNullable<NodeMaterial['positionNode']> {
    const field = this.fieldTexture();
    const amount = this.amount;
    const minY = this.minY;
    const extent = this.extent;
    const offset = this.offset;
    return Fn(([input = positionLocal]) => {
      const p = vec3(input).toVar();
      const result = p.toVar();
      If(amount.greaterThan(0).and(extent.greaterThan(0)), () => {
        const span = extent.max(0.0001);
        const h = p.y.sub(minY).div(span).clamp(0, 1);
        const raw = amount.mul(1 + LIQUID_LAG).sub(h.mul(LIQUID_LAG));
        const q = raw.clamp(0, 1);
        const progress = q.mul(q).mul(float(3).sub(q.mul(2)));
        const slope = select(
          raw.greaterThan(0).and(raw.lessThan(1)).and(p.y.greaterThanEqual(minY)).and(p.y.lessThanEqual(minY.add(span))),
          q.mul(float(1).sub(q)).mul(-6 * LIQUID_LAG).div(span),
          float(0),
        );
        const vertical = float(1).sub(progress.mul(1 - LIQUID_THICKNESS));
        const derivative = vertical.sub(p.y.sub(minY).mul(1 - LIQUID_THICKNESS).mul(slope));
        const radial = derivative.max(LIQUID_THICKNESS).pow(-0.5);
        const xz = p.xz.mul(radial);
        const uv = xz.div(span.mul(2.2)).add(0.5).clamp(0, 1);
        const packed = texture(field, uv);
        const wave = packed.r.mul(65280).add(packed.g.mul(255)).sub(32768)
          .div(32767).mul(LIQUID_MAX_HEIGHT).mul(span);
        result.assign(vec3(xz.x, minY.add(p.y.sub(minY).mul(vertical)).add(wave.mul(h).mul(progress)), xz.y));
      });
      // Placement survives re-forming. It is not multiplied by melt amount.
      return result.add(vec3(offset.x, offset.y, 0));
    })(vec3(original ?? positionLocal));
  }

  private normal(original: NodeMaterial['normalNode']): NonNullable<NodeMaterial['normalNode']> {
    const flat = cross(dFdx(positionView), dFdy(positionView)).add(vec3(0, 0, 0.000001)).normalize();
    return select(
      this.amount.greaterThan(0).and(this.extent.greaterThan(0)),
      mix(original ?? normalView, flat, smoothstep(0, 0.6, this.amount)).normalize(),
      original ?? normalView,
    );
  }

  attachSurface(materials: SkinMaterials, skin: TextSkinEngine): void {
    if (this.dead) throw new Error('Liquid material owner is disposed');
    const front = materials.front as MeshStandardNodeMaterial;
    const interior = materials.interior as MeshStandardNodeMaterial;
    const mask = materials.mask as NodeMaterial;
    const projection = this.projection(front.positionNode);
    const normal = vec3(this.normal(front.normalNode));
    const transition = smoothstep(0.2, 0.9, this.amount);
    const local = positionLocal.sub(vec3(this.offset.x, this.offset.y, 0));
    const scroll = reference('scrollOffset', 'float', skin);
    const uv = vec2(local.x, local.z.negate()).mul(vec2(90 / 96, 90 / 64)).add(vec2(0, scroll));
    const letters = smoothstep(0.06, 0.68, luminance(texture(skin.texture, uv).rgb));
    const lighting = normal.z.abs().mul(0.5).add(0.5);
    const glow = letters.mul(lighting);
    const liquidColour = vec3(0.08, 0.43, 0.85).mul(glow).add(vec3(0.002, 0.014, 0.035));
    front.colorNode = mix(front.colorNode ?? vec3(0), liquidColour, transition);
    front.emissiveNode = mix(front.emissiveNode ?? vec3(0), vec3(0.025, 0.15, 0.32).mul(glow), transition);
    front.opacityNode = mix(front.opacityNode ?? float(1), float(0.94), transition);
    interior.colorNode = mix(interior.colorNode ?? vec3(0), liquidColour.mul(0.35), transition);
    interior.emissiveNode = mix(interior.emissiveNode ?? vec3(0), liquidColour.mul(0.08), transition);
    for (const material of [front, interior, mask]) {
      material.positionNode = projection;
      material.normalNode = normal;
      surfaceOwners.set(material, this);
    }
  }

  attachEye(material: Material): void {
    const node = material as NodeMaterial;
    node.positionNode = this.projection(node.positionNode);
    node.normalNode = this.normal(node.normalNode);
    this.gateInterior(node);
  }

  gateInterior(material: NodeMaterial): void {
    const visibility = float(1).sub(smoothstep(0.5, 0.88, this.amount));
    material.opacityNode = float(material.opacityNode ?? float(1)).mul(visibility);
    material.alphaTestNode = float(0.02);
    if (material.colorNode) material.colorNode = vec3(material.colorNode).mul(visibility);
  }

  setExtent(minY: number, maxY: number): void {
    const span = maxY - minY;
    const usable = Number.isFinite(minY) && Number.isFinite(maxY) && span > 0;
    this.minY.value = usable ? minY : 0;
    this.extent.value = usable ? span : 0;
  }

  setReducedMotion(reduced: boolean): void {
    this.dynamics.setReducedMotion(reduced);
    this.sync();
  }

  update(dt: number): void {
    if (this.dead) return;
    this.dynamics.update(dt);
    this.sync();
  }

  private sync(): void {
    this.amount.value = this.dynamics.amount;
    this.offset.value.x = this.dynamics.position[0];
    this.offset.value.y = this.dynamics.position[1];
    if (this.field && (this.dynamics.amount > 0 || this.fieldWasActive)) {
      this.dynamics.writeTexture(this.pixels);
      this.field.needsUpdate = true;
    }
    this.fieldWasActive = this.dynamics.amount > 0;
  }

  get verticalOffset(): number { return this.dynamics.position[1]; }

  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    this.dynamics.dispose();
    this.field?.dispose();
    this.field = null;
  }
}
