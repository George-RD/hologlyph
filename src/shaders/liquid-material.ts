import {
  DataTexture, LinearFilter, RGBAFormat, UnsignedByteType, Vector2,
  type Group, type Material,
} from 'three';
import type { MeshStandardNodeMaterial, NodeMaterial } from 'three/webgpu';
import {
  cross, dFdx, dFdy, float, luminance, mix, normalView,
  positionGeometry, positionLocal, positionView, reference, select, smoothstep,
  texture, uniform, vec2, vec3,
} from 'three/tsl';
import type { SkinMaterials, TextSkinEngine, VFXEngine } from '../contracts';
import {
  LIQUID_LAG, LIQUID_MAX_HEIGHT, LIQUID_RESOLUTION, LIQUID_THICKNESS,
  LiquidDynamics, type LiquidBounds, type LiquidPoint,
} from './liquid-dynamics';
import { LiquidFreeSurface } from './liquid-free-surface';
import { liquidFootprint, type LiquidFootprint } from './liquid-footprint';
import { createLiquidScene, type LiquidSceneBinding } from './liquid-scene';

export interface LiquidControls {
  readonly amount: number;
  readonly targetAmount: number;
  readonly position: LiquidPoint;
  readonly velocity: LiquidPoint;
  readonly canSteer: boolean;
  /** Immutable model-space limits for the carrier origin, not the mesh contour. */
  readonly bounds: LiquidBounds;
  /** Replace host limits, containing held targets and released momentum. */
  setBounds(bounds: LiquidBounds): void;
  /** 0 is the speaking head, 1 is liquid. Interrupted transitions are continuous. */
  setAmount(amount: number, immediate?: boolean): void;
  /** Model-space X/Y placement. Enabled only once the body is fully liquid. */
  steerTo(x: number, y: number): boolean;
  /** Release the drag target without discarding bounded momentum. */
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

/** Conservative endpoint footprint; null until the avatar has a usable extent. */
export function liquidBodyFootprint(vfx: VFXEngine): LiquidFootprint | null {
  const owner = owners.get(vfx);
  if (!owner) throw new Error('This VFX engine has no liquid-body binding');
  return owner.footprint;
}

/** Associate the engine with its existing liquid owner; never create another clock. */
export function bindLiquidEngine(vfx: VFXEngine, owner: LiquidMaterialOwner): void {
  owners.set(vfx, owner);
}

/** Core lifecycle hook. Null releases a replaced or disposed avatar. */
export function bindLiquidScene(vfx: VFXEngine, root: Group | null): void {
  owners.get(vfx)?.bindScene(root);
}

/** Report an active or requested deformation so head-only effects can suspend. */
export function liquidBodyChanging(vfx: VFXEngine): boolean {
  const body = owners.get(vfx)?.dynamics;
  return body !== undefined && (body.amount > 0 || body.targetAmount > 0);
}

/** The legacy pool and collision profile are anchored to the original body. */
export function liquidBodySpaceChanged(vfx: VFXEngine): boolean {
  const body = owners.get(vfx)?.dynamics;
  return body !== undefined && (body.amount > 0 || body.targetAmount > 0
    || body.position[0] !== 0 || body.position[1] !== 0);
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

/** Own the wave texture, per-avatar scene binding and liquid material graphs. */
export class LiquidMaterialOwner {
  readonly dynamics = new LiquidDynamics();
  private readonly free = new LiquidFreeSurface();
  private readonly amount = this.free.amount;
  private readonly minY = this.free.minY;
  private readonly extent = this.free.extent;
  private readonly offset = uniform(new Vector2());
  private readonly pixels = new Uint8Array(LIQUID_RESOLUTION ** 2 * 4);
  private field: DataTexture | null = null;
  private scene: LiquidSceneBinding | null = null;
  private dead = false;
  private fieldWasActive = false;

  /** Restore the previous avatar's hierarchy before binding its replacement. */
  bindScene(root: Group | null): void {
    if (this.dead) return;
    this.free.mesh?.removeFromParent();
    this.scene?.dispose();
    this.scene = root ? createLiquidScene(root) : null;
    if (this.scene && this.free.mesh) this.scene.carrier.add(this.free.mesh);
    this.sync();
  }

  /** Lazily allocate the shared RGBA8 wave texture for either renderer backend. */
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

  /** Collapse the authored head, then converge onto the independent closed surface. */
  private projection(original: NodeMaterial['positionNode']): NonNullable<NodeMaterial['positionNode']> {
    // Real node edges preserve upstream morph/skinning/deformation graphs.
    // Every operand remains bounded while the feature is disabled.
    const p = vec3(original ?? positionLocal);
    const span = this.extent.max(0.0001);
    const h = p.y.sub(this.minY).div(span).clamp(0, 1);
    const raw = this.amount.mul(1 + LIQUID_LAG).sub(h.mul(LIQUID_LAG));
    const q = raw.clamp(0, 1);
    const progress = q.mul(q).mul(float(3).sub(q.mul(2)));
    const slope = select(
      raw.greaterThan(0).and(raw.lessThan(1)).and(p.y.greaterThanEqual(this.minY))
        .and(p.y.lessThanEqual(this.minY.add(span))),
      q.mul(float(1).sub(q)).mul(-6 * LIQUID_LAG).div(span),
      float(0),
    );
    const vertical = float(1).sub(progress.mul(1 - LIQUID_THICKNESS));
    const derivative = vertical.sub(p.y.sub(this.minY).mul(1 - LIQUID_THICKNESS).mul(slope));
    const radial = derivative.max(LIQUID_THICKNESS).pow(-0.5);
    const xz = p.xz.mul(radial);
    const uv = xz.div(span.mul(2.2)).add(0.5).clamp(0, 1);
    const field = this.fieldTexture();
    const packed = texture(field, uv).level(float(0));
    const wave = packed.r.mul(65280).add(packed.g.mul(255)).sub(32768)
      .div(32767).mul(LIQUID_MAX_HEIGHT).mul(span);
    const collapsed = vec3(xz.x,
      this.minY.add(p.y.sub(this.minY).mul(vertical)).add(wave.mul(h).mul(progress)), xz.y);
    // The final outline must not depend on a live viseme or recursively copy
    // its entire graph into every angular term. Bind-space rays only assign
    // shell vertices to the shared target; the closed mesh owns the endpoint.
    const direction = positionGeometry.sub(vec3(0, this.minY.add(span.mul(0.5)), 0));
    const target = this.free.position(direction, field);
    const projected = mix(collapsed, target, smoothstep(0.32, 0.88, this.amount));
    // With a bound scene, placement is a real carrier transform. Standalone
    // material users retain the model-space offset path.
    return select(this.amount.greaterThan(0).and(this.extent.greaterThan(0)), projected, p)
      .add(vec3(this.offset.x, this.offset.y, 0));
  }

  /** Preserve the head normal path and blend towards bounded surface gradients. */
  private normal(original: NodeMaterial['normalNode']): NonNullable<NodeMaterial['normalNode']> {
    const gradient = cross(dFdx(positionView), dFdy(positionView));
    const flat = gradient.div(gradient.length().max(1e-8));
    // Evaluate the original normal before the alternate one, outside a
    // conditional branch. normalView is a cached toVar in Three r178: sharing
    // it across separate select branches can leave the off branch uninitialised.
    // The alternate vector is bounded even for a degenerate triangle.
    const gate = smoothstep(0, 0.6, this.amount).mul(smoothstep(0, 0.0001, this.extent));
    return mix(original ?? normalView, flat, gate);
  }

  /** Attach shared deformation and live glyph colour to the existing skin passes. */
  attachSurface(materials: SkinMaterials, skin: TextSkinEngine): void {
    if (this.dead) throw new Error('Liquid material owner is disposed');
    const front = materials.front as MeshStandardNodeMaterial;
    const interior = materials.interior as MeshStandardNodeMaterial;
    const mask = materials.mask as NodeMaterial;
    const projection = this.projection(front.positionNode);
    // The back wall must retain its own side-flipped normal chain.
    front.normalNode = this.normal(front.normalNode);
    interior.normalNode = this.normal(interior.normalNode);
    const transition = smoothstep(0.2, 0.9, this.amount);
    const local = positionLocal.sub(vec3(this.offset.x, this.offset.y, 0));
    const scroll = reference('scrollOffset', 'float', skin);
    const uv = vec2(local.x, local.z.negate()).mul(vec2(90 / 96, 90 / 64)).add(vec2(0, scroll));
    const letters = smoothstep(0.06, 0.68, luminance(texture(skin.texture, uv).rgb));
    // Resolve normals in Three's NORMAL sub-build, never by evaluating the
    // custom normalNode directly from colour (which caused the black head).
    const lighting = normalView.z.abs().mul(0.5).add(0.5);
    const glow = letters.mul(lighting);
    const liquidColour = vec3(0.08, 0.43, 0.85).mul(glow).add(vec3(0.002, 0.014, 0.035));
    const headVisibility = float(1).sub(smoothstep(0.8, 0.95, this.amount));
    front.colorNode = mix(front.colorNode ?? vec3(0), liquidColour, transition);
    front.emissiveNode = mix(front.emissiveNode ?? vec3(0), vec3(0.025, 0.15, 0.32).mul(glow), transition);
    front.opacityNode = mix(front.opacityNode ?? float(1), float(0.94), transition).mul(headVisibility);
    interior.colorNode = mix(interior.colorNode ?? vec3(0), liquidColour.mul(0.35), transition);
    interior.emissiveNode = mix(interior.emissiveNode ?? vec3(0), liquidColour.mul(0.08), transition);
    interior.opacityNode = float(interior.opacityNode ?? float(1)).mul(headVisibility);
    for (const material of [front, interior, mask]) {
      material.positionNode = projection;
      surfaceOwners.set(material, this);
    }
    this.free.attach(skin, this.fieldTexture());
    if (this.scene && this.free.mesh) this.scene.carrier.add(this.free.mesh);
    this.sync();
  }

  /** Deform an authored eye material and hide it as the head becomes liquid. */
  attachEye(material: Material): void {
    const node = material as NodeMaterial;
    node.positionNode = this.projection(node.positionNode);
    node.normalNode = this.normal(node.normalNode);
    this.gateInterior(node);
  }

  /** Fade and discard rigid internals before the full-liquid endpoint. */
  gateInterior(material: NodeMaterial): void {
    const visibility = float(1).sub(smoothstep(0.5, 0.88, this.amount));
    material.opacityNode = float(material.opacityNode ?? float(1)).mul(visibility);
    material.alphaTestNode = float(0.02);
    if (material.colorNode) material.colorNode = vec3(material.colorNode).mul(visibility);
  }

  /** Set usable avatar height bounds, or disable projection for invalid extents. */
  setExtent(minY: number, maxY: number): void {
    const span = maxY - minY;
    const usable = Number.isFinite(minY) && Number.isFinite(maxY) && Number.isFinite(span) && span > 0;
    this.minY.value = usable ? minY : 0;
    this.extent.value = usable ? span : 0;
  }

  /** Maximum endpoint envelope, excluding carrier translation and root transforms. */
  get footprint(): LiquidFootprint | null {
    return this.dead ? null : liquidFootprint(this.minY.value, this.minY.value + this.extent.value);
  }

  /** Apply the reduced-motion policy and immediately synchronise render state. */
  setReducedMotion(reduced: boolean): void {
    this.dynamics.setReducedMotion(reduced);
    this.sync();
  }

  /** Advance only from the owning VFX clock, then synchronise render state. */
  update(dt: number): void {
    if (this.dead) return;
    this.dynamics.update(dt);
    this.sync();
  }

  /** Copy solver state into the rig carrier, uniforms and existing texture. */
  private sync(): void {
    this.free.sync(this.dynamics);
    this.offset.value.set(this.scene ? 0 : this.dynamics.position[0], this.scene ? 0 : this.dynamics.position[1]);
    // No usable extent means no replacement surface. Keep the authored head
    // and internals visible instead of switching to an invisible liquid mesh.
    const drawable = this.free.mesh !== null && this.extent.value > 0;
    this.amount.value = drawable ? this.dynamics.amount : 0;
    this.scene?.update({ amount: this.amount.value,
      targetAmount: drawable ? this.dynamics.targetAmount : 0, position: this.dynamics.position });
    if (this.field && (this.dynamics.amount > 0 || this.fieldWasActive)) {
      this.dynamics.writeTexture(this.pixels);
      this.field.needsUpdate = true;
    }
    this.fieldWasActive = this.dynamics.amount > 0;
  }

  /** Model-space vertical placement used by the owning VFX engine. */
  get verticalOffset(): number { return this.dynamics.position[1]; }

  /** Restore the avatar and release owned surface, texture and solver idempotently. */
  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    this.free.dispose();
    this.scene?.dispose();
    this.scene = null;
    this.dynamics.dispose();
    this.field?.dispose();
    this.field = null;
  }
}
