/**
 * Tier 1 pool surface: the GPU half (dec.liquid-glass-architecture, item 3).
 *
 * `pool.ts` holds the arithmetic; this module is the only place that owns GPU
 * objects. A ping-pong pair of half-float render targets carries the height
 * field, a fullscreen quad advances it with the same damped wave update
 * `poolWaveStep` defines, and a subdivided plane reads the field back as
 * vertex displacement plus an analytic meniscus around the body's contour.
 *
 * No GPU resource is constructed at module load, so importing this under
 * happy-dom is safe; everything is built inside `createPoolSurface`.
 *
 * Two details are load bearing and easy to undo by accident:
 *
 * - The renderer's clipping plane is global (three offers no per-material
 *   opt-out), so every fragment below world Y 0 is discarded. The surface is
 *   therefore lifted to `bias` and the wave is clamped to `+/- bias`: the rest
 *   height and the amplitude bound are the same number, and a trough can reach
 *   the plane but never cross it.
 * - Ping-pong is done by swapping whole materials rather than by writing a new
 *   texture into one `TextureNode`. `TextureNode.sample()` clones share their
 *   value through `referenceNode`, so a value swap would probably work, but
 *   "probably" buys nothing here: two materials with fixed bindings cost one
 *   extra pipeline, built once, and cannot silently freeze the surface.
 */

import {
  ClampToEdgeWrapping,
  Color,
  DoubleSide,
  Group,
  HalfFloatType,
  Mesh,
  LinearFilter,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  RenderTarget,
  Scene,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  cameraPosition,
  dot,
  exp,
  float,
  positionLocal,
  positionWorld,
  pow,
  saturate,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import type * as THREE from 'three';
import type { Disposable, HeadPoolConfig } from '../contracts.js';
import {
  MAX_SIM_STEPS,
  POOL_EXTENT,
  POOL_RESOLUTION,
  POOL_SEGMENTS,
  SIM_HZ,
  WAVE_DAMPING,
  WAVE_SPEED,
  poolImpulseDecay,
  poolSimulationSteps,
} from './pool.js';

/**
 * Half-width of the injected ring, in world units. One head radius is about
 * 0.25, so 0.07 puts the wave crest clearly outside the contact contour
 * without smearing it into a dome that reads as a bulge rather than a splash.
 */
const RING_WIDTH = 0.07;

/**
 * Sponge width at the field border, in texels. A hard zero border is a
 * Dirichlet wall and reflects the wave back inverted, which settles into a
 * standing checker within a couple of seconds. Grading the field to zero over
 * a band absorbs instead. 24 of 256 texels is 0.56 world units at the default
 * extent, comfortably wider than `RING_WIDTH`.
 */
const SPONGE_TEXELS = 24;

/**
 * Decay width of the meniscus outside the contact contour, world units.
 * Surface tension on water climbs a wall over roughly a capillary length,
 * which is millimetres; at this scale the number is chosen to read rather than
 * to be dimensionally true, and it is deliberately tighter than `RING_WIDTH`
 * so the lift sits inside the splash rather than fighting it.
 */
const MENISCUS_WIDTH = 0.045;

/** Slope gain when turning the height gradient into a shading normal. */
const SLOPE_GAIN = 6;

/** Radial fraction of the plane where the surface starts fading to nothing. */
const EDGE_FADE_START = 0.3;

/** Radial fraction of the plane where the surface has fully faded out. */
const EDGE_FADE_END = 0.48;

/** Flat-water alpha before fresnel, ring and edge fade are applied. */
const BASE_ALPHA = 0.28;

/**
 * World Y of the offscreen simulation quad. Any value clear of the engine's
 * global clipping plane at Y 0 works; 8 is far enough that a future plane
 * moved a little above the origin still leaves the pass intact.
 */
const SIM_QUAD_Y = 8;

export interface PoolSurfaceState {
  /** Root-group Y translation the emergence ramp is applying (<= 0). */
  readonly rootOffsetY: number;
  /** Radius of the hole the body makes in the water, world units. */
  readonly waterlineRadius: number;
  /** Ring-impulse drive for this frame, 0..1, already reduced-motion damped. */
  readonly drive: number;
}

export interface PoolSurface extends Disposable {
  /** Added to the scene by the engine; the pool never reparents itself. */
  readonly object: THREE.Object3D;
  setConfig(config: HeadPoolConfig): void;
  update(dt: number, state: PoolSurfaceState): void;
}

/** The subset of the renderer this module drives, so `unknown` can be narrowed. */
interface PoolRenderer {
  setRenderTarget(target: RenderTarget | null): void;
  render(scene: unknown, camera: unknown): unknown;
}

function isPoolRenderer(value: unknown): value is PoolRenderer {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.setRenderTarget === 'function' && typeof candidate.render === 'function';
}

function createFieldTarget(): RenderTarget {
  const target = new RenderTarget(POOL_RESOLUTION, POOL_RESOLUTION, {
    type: HalfFloatType,
    format: RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    // Linear, and that is exact for the simulation as well as smooth for the
    // surface. The simulation runs on a fullscreen quad, so every fragment
    // lands on a texel centre and every neighbour tap is one whole texel away:
    // linear sampling returns the texel value with no blend. The rendered
    // surface has only 192 segments across 256 texels, and point sampling
    // there turns every wave crest into visible stair steps.
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
  });
  target.texture.colorSpace = NoColorSpace;
  return target;
}

/**
 * Live values the pool's node graphs read. The nodes themselves are TSL
 * objects; these are the narrow `{ value }` views the rest of the module
 * writes through, matching how `HeadUniforms` is surfaced in `materials.ts`.
 */
export interface PoolUniforms {
  readonly amount: { value: number };
  readonly bias: { value: number };
  readonly meniscus: { value: number };
  readonly contact: { value: number };
  readonly tint: { value: THREE.Color };
  /** Radius of the body's cross-section at the waterline, world units. */
  readonly radius: { value: number };
  /** Live ring-impulse amplitude, decaying between splashes. */
  readonly impulse: { value: number };
}

export function createPoolSurface(renderer: unknown, config: HeadPoolConfig): PoolSurface {
  const group = new Group();
  group.name = 'hologlyph_pool';

  const uAmount = uniform(config.amount);
  const uBias = uniform(config.bias);
  const uMeniscus = uniform(config.meniscus);
  const uContact = uniform(config.contact);
  const uTint = uniform(new Color(config.tint));
  const uRadius = uniform(0);
  const uImpulse = uniform(0);

  const uniforms: PoolUniforms = {
    amount: uAmount as unknown as { value: number },
    bias: uBias as unknown as { value: number },
    meniscus: uMeniscus as unknown as { value: number },
    contact: uContact as unknown as { value: number },
    tint: uTint as unknown as { value: THREE.Color },
    radius: uRadius as unknown as { value: number },
    impulse: uImpulse as unknown as { value: number },
  };

  /** CPU-side ripple gain. Not a uniform: it scales the injected amplitude. */
  let ripple = config.ripple;

  const gpu = isPoolRenderer(renderer) ? renderer : null;
  const texel = 1 / POOL_RESOLUTION;

  /**
   * Simulation pass reading `source`. `r` is the height now, `g` the height
   * one step ago; `b` and `a` are unused and written as 0 and 1 so a debug
   * readback of the target is legible.
   */
  function buildSimMaterial(source: THREE.Texture): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial();
    material.toneMapped = false;
    material.transparent = false;
    material.depthTest = false;
    material.depthWrite = false;

    const field = texture(source);
    const uvc = uv();
    const centre = field.sample(uvc);
    const h = centre.r;
    const hPrev = centre.g;
    const laplacian = field
      .sample(uvc.add(vec2(texel, 0)))
      .r.add(field.sample(uvc.sub(vec2(texel, 0))).r)
      .add(field.sample(uvc.add(vec2(0, texel))).r)
      .add(field.sample(uvc.sub(vec2(0, texel))).r)
      .sub(h.mul(4));

    // Exactly `poolWaveStep`: h + velocity * (1 - damping) + c^2 * laplacian.
    const stepped = h
      .add(h.sub(hPrev).mul(1 - WAVE_DAMPING))
      .add(laplacian.mul(WAVE_SPEED * WAVE_SPEED));

    // One ring source. Scroll and emergence both push the same contour, which
    // is where a body entering water actually makes its wave, so tier 1 needs
    // no second emitter.
    const world = uvc.sub(0.5).mul(POOL_EXTENT);
    const distance = world.length();
    const offset = distance.sub(uRadius).div(RING_WIDTH);
    const ring = exp(offset.mul(offset).negate()).mul(uImpulse);

    const edge = float(SPONGE_TEXELS * texel);
    const sponge = smoothstep(0, edge, uvc.x)
      .mul(smoothstep(0, edge, uvc.y))
      .mul(smoothstep(0, edge, float(1).sub(uvc.x)))
      .mul(smoothstep(0, edge, float(1).sub(uvc.y)));

    material.colorNode = vec3(stepped.add(ring).mul(sponge), h.mul(sponge), 0);
    return material;
  }

  /** Rendered surface reading `source`. */
  function buildSurfaceMaterial(source: THREE.Texture): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.side = DoubleSide;

    const field = texture(source);
    const planar = positionLocal.xz;
    const fuv = planar.div(POOL_EXTENT).add(0.5);
    const height = field.sample(fuv).r;

    // The wave is expressed in field units and scaled by the bias, so the rest
    // height and the amplitude bound are one number and a trough can reach the
    // clip plane but never cross it.
    const wave = height.mul(uBias).clamp(uBias.negate(), uBias);
    const distanceLocal = planar.length();
    const lift = exp(distanceLocal.sub(uRadius).max(0).div(MENISCUS_WIDTH).negate());
    const meniscus = uBias.mul(uMeniscus).mul(lift);
    material.positionNode = positionLocal.add(vec3(0, uBias.add(wave).add(meniscus), 0));

    // Shading normal from the height gradient, not from the geometry: the
    // plane is flat and its own normal carries no wave information.
    const slopeX = field
      .sample(fuv.add(vec2(texel, 0)))
      .r.sub(field.sample(fuv.sub(vec2(texel, 0))).r);
    const slopeZ = field
      .sample(fuv.add(vec2(0, texel)))
      .r.sub(field.sample(fuv.sub(vec2(0, texel))).r);
    const normal = vec3(slopeX.mul(-SLOPE_GAIN), 1, slopeZ.mul(-SLOPE_GAIN)).normalize();

    const viewDir = cameraPosition.sub(positionWorld).normalize();
    const facing = saturate(dot(normal, viewDir));
    const fresnel = pow(float(1).sub(facing), 4);

    const distanceWorld = positionWorld.xz.length();
    const ringOffset = distanceWorld.sub(uRadius).div(RING_WIDTH);
    const ring = exp(ringOffset.mul(ringOffset).negate()).mul(uContact);

    // A square of water with a visible border reads as a prop, so the sheet
    // fades radially well inside its own extent.
    const edgeFade = float(1).sub(
      smoothstep(POOL_EXTENT * EDGE_FADE_START, POOL_EXTENT * EDGE_FADE_END, distanceWorld),
    );
    // No water over the body's own cross-section.
    const outside = smoothstep(uRadius.sub(0.012), uRadius.add(0.024), distanceWorld);

    const tinted = uTint.mul(float(0.35).add(fresnel.mul(0.65)));
    material.colorNode = tinted.add(uTint.mul(ring));
    material.opacityNode = float(BASE_ALPHA)
      .add(fresnel.mul(0.5))
      .add(ring)
      .mul(edgeFade)
      .mul(outside)
      .mul(uAmount)
      .clamp(0, 1);
    return material;
  }

  const geometry = new PlaneGeometry(POOL_EXTENT, POOL_EXTENT, POOL_SEGMENTS, POOL_SEGMENTS);
  geometry.rotateX(-Math.PI / 2);

  const targets: RenderTarget[] = [];
  const simMaterials: MeshBasicNodeMaterial[] = [];
  const surfaceMaterials: MeshBasicNodeMaterial[] = [];
  let mesh: Mesh | null = null;
  let simMesh: Mesh | null = null;
  let simGeometry: PlaneGeometry | null = null;
  let simScene: Scene | null = null;
  let simCamera: OrthographicCamera | null = null;

  if (gpu) {
    targets.push(createFieldTarget(), createFieldTarget());
    for (const target of targets) {
      simMaterials.push(buildSimMaterial(target.texture));
      surfaceMaterials.push(buildSurfaceMaterial(target.texture));
    }

    // three's own `QuadMesh` sits astride the world origin, and the engine's
    // clipping plane is GLOBAL: it would discard the lower half of the
    // simulation quad and silently freeze half the height field. So the pass
    // owns a quad lifted clear of the waterline instead of borrowing that one.
    simGeometry = new PlaneGeometry(2, 2);
    simGeometry.translate(0, SIM_QUAD_Y, 0);
    simMesh = new Mesh(simGeometry, simMaterials[0] as unknown as THREE.Material);
    simMesh.frustumCulled = false;
    simScene = new Scene();
    simScene.add(simMesh);
    simCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 2);
    simCamera.position.set(0, SIM_QUAD_Y, 1);

    mesh = new Mesh(geometry, surfaceMaterials[0] as unknown as THREE.Material);
    mesh.frustumCulled = false;
    mesh.name = 'hologlyph_pool_surface';
    // After the shell (renderOrder 2 in `EngineImpl.replaceAvatar`), so the
    // water resolves against a head that has already written its depth.
    // `renderOrder` is per drawable and is not inherited from the group.
    mesh.renderOrder = 3;
    group.add(mesh);
  }

  /** Index of the target holding the current field. */
  let read = 0;
  let impulse = 0;
  /** Sub-step remainder, so the simulation rate does not follow the frame rate. */
  let carry = 0;
  let failed = false;
  let disposed = false;

  function runStep(): void {
    if (!gpu || !simMesh || !mesh) return;
    const write = read ^ 1;
    simMesh.material = simMaterials[read] as unknown as THREE.Material;
    gpu.setRenderTarget(targets[write] as RenderTarget);
    const result = gpu.render(simScene, simCamera);
    if (result && typeof (result as Promise<void>).catch === 'function') {
      (result as Promise<void>).catch(() => {});
    }
    read = write;
    mesh.material = surfaceMaterials[read] as unknown as THREE.Material;
  }

  return {
    object: group,

    setConfig(next: HeadPoolConfig): void {
      uniforms.amount.value = next.amount;
      uniforms.bias.value = next.bias;
      uniforms.meniscus.value = next.meniscus;
      uniforms.contact.value = next.contact;
      uniforms.tint.value.set(next.tint);
      ripple = next.ripple;
    },

    update(dt: number, state: PoolSurfaceState): void {
      if (disposed || failed || !gpu) return;
      // Second line of defence against a non-finite drive. A single NaN texel
      // is fatal and silent: the Laplacian spreads it across the whole field
      // within a second and damping never removes it, so guard where the CPU
      // meets the GPU rather than trusting every caller upstream.
      uniforms.radius.value = Number.isFinite(state.waterlineRadius)
        ? Math.max(0, state.waterlineRadius)
        : 0;

      // A fresh drive raises the held amplitude but never lowers it: a splash
      // rings down on its own clock, it does not stop when the scroll does.
      const driven = Number.isFinite(state.drive) ? state.drive * ripple : 0;
      if (driven > impulse) impulse = driven;
      impulse = poolImpulseDecay(impulse, dt);
      uniforms.impulse.value = impulse;

      // The step count is capped, so an uncapped accumulator would keep the
      // debt from a backgrounded tab forever and run the maximum number of
      // steps on every frame from then on. Drop what cannot be repaid.
      carry += Number.isFinite(dt) && dt > 0 ? dt : 0;
      const ceiling = MAX_SIM_STEPS / SIM_HZ;
      if (carry > ceiling) carry = ceiling;
      const steps = poolSimulationSteps(carry);
      if (steps === 0) return;
      carry -= steps / SIM_HZ;
      if (carry < 0) carry = 0;

      try {
        for (let i = 0; i < steps; i++) runStep();
      } catch {
        // The pool is decoration. A backend that refuses the ping-pong leaves
        // a flat sheet rather than taking the page down with it.
        failed = true;
      } finally {
        gpu.setRenderTarget(null);
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (mesh) group.remove(mesh);
      if (simMesh && simScene) simScene.remove(simMesh);
      geometry.dispose();
      simGeometry?.dispose();
      for (const material of simMaterials) material.dispose();
      for (const material of surfaceMaterials) material.dispose();
      for (const target of targets) target.dispose();
      simMaterials.length = 0;
      surfaceMaterials.length = 0;
      targets.length = 0;
      mesh = null;
      simMesh = null;
      simGeometry = null;
      simScene = null;
      simCamera = null;
    },
  };
}
