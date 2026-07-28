/**
 * VFX engine (dec.renderer-posture).
 *
 * Owns emergence (clipping plane + root translation) and builds the single
 * TSL text-skin material. Module top-level performs no GPU work: the material
 * node graph is built lazily inside `createSkinMaterial`.
 */

import { Plane, Vector3 } from 'three';
import type * as THREE from 'three';
import {
  type BehaviorState,
  clamp01,
  DEFAULT_HEAD_CONFIG,
  type HeadConfig,
  type HeadConfigOverrides,
  type LensBinding,
  type SkinMaterials,
  type StageCollider,
  type TextSkinEngine,
  type VFXEngine,
} from '../contracts';
import {
  FLUID_PARTICIPANT_MODES,
  FLUID_REST,
  fluidAccel,
  fluidGravity,
  fluidIntegrate,
  fluidSqueezeTarget,
  fluidStateAmount,
  fluidTargetAccel,
  type FluidState,
  type FluidVec3,
} from './fluid';
import {
  buildEyeballMaterial,
  buildSkinMaterial,
  lensPlaceholderTexture,
  normaliseHeadConfig,
  type EyeUniforms,
  type HeadUniforms,
  type ScrollUniform,
} from './materials';
import { adaptToBackdrop } from './glass';
import {
  BUST_HEIGHT,
  RAMP_TAU,
  computeClipConstant,
  computeRootOffsetY,
  easeEmergence,
} from './emergence';
import { REDUCED_DRIVE } from './pool';

interface SkinBinding {
  skin: TextSkinEngine;
  scroll: ScrollUniform;
  uniforms: HeadUniforms;
}

interface EyeBinding {
  skin: TextSkinEngine;
  scroll: ScrollUniform;
  uniforms: EyeUniforms;
}

export { BUST_HEIGHT, RAMP_TAU } from './emergence';
export {
  blendedProjectionUV,
  buildEyeballMaterial,
  buildSkinMaterial,
  normaliseHeadConfig,
} from './materials';
export type {
  BuiltEyeballMaterial,
  BuiltSkinMaterial,
  EyeUniforms,
  HeadUniforms,
  ScrollUniform,
} from './materials';
export {
  adaptToBackdrop,
  backdropLuminance,
  parseHexColor,
  srgbToLinear,
} from './glass';
export type { BackdropAdaptation } from './glass';
export {
  easeEmergence,
  computeRootOffsetY,
  computeClipConstant,
  visibleFraction,
} from './emergence';
export {
  MAX_SIM_STEPS,
  POOL_EXTENT,
  POOL_RESOLUTION,
  POOL_SEGMENTS,
  PROFILE_SLICES,
  REDUCED_DRIVE,
  RIPPLE_TAU,
  SIM_HZ,
  WAVE_DAMPING,
  WAVE_SPEED,
  poolContactRing,
  poolImpulseDecay,
  poolMeniscusLift,
  poolProfileRadiusAt,
  poolRadialProfile,
  poolRippleDrive,
  poolSimulationSteps,
  poolWaterlineRadius,
  poolWaveStep,
} from './pool';
export {
  FLUID_CARRIER_CLAMP,
  FLUID_CARRIER_DRAG,
  FLUID_DAMPING_RATIO,
  FLUID_DRIVE_ACCEL,
  FLUID_EMERGENCE_SCALE,
  FLUID_MAX_STEP,
  FLUID_MAX_SUBSTEPS,
  FLUID_MODES,
  FLUID_OMEGA_SLACK,
  FLUID_OMEGA_STIFF,
  FLUID_PARTICIPANT_MODES,
  FLUID_REDUCED_DRIVE,
  FLUID_REST,
  FLUID_SCROLL_SCALE,
  FLUID_SOFT_EPS,
  FLUID_STATE_GAIN,
  fluidAccel,
  fluidBandWeight,
  fluidDisplacement,
  fluidDrive,
  fluidFaceWeight,
  fluidGravity,
  fluidHeightWeight,
  fluidIntegrate,
  fluidOmega,
  fluidReaction,
  fluidSoftRamp,
  fluidSqueezeTarget,
  fluidStateAmount,
  fluidSubsteps,
  fluidTargetAccel,
} from './fluid';
export type { FluidState, FluidVec3 } from './fluid';
export type { PoolProfile } from './pool';
// `createPoolSurface` is deliberately NOT re-exported here. It is the only
// part of the pool that touches `three/webgpu` render targets, and nothing
// but the engine's own pool reconciler has any use for it, so it is imported
// from its module directly rather than widened into the shader barrel.
export { POOL_OBSTACLE_SLOTS } from './pool-surface';
export type { PoolObstacle, PoolSurface, PoolSurfaceState, PoolUniforms } from './pool-surface';
export {
  INTERIOR_AXIS_SLICES,
  INTERIOR_DAMPING_RATIO,
  INTERIOR_DEPTH_MAX,
  INTERIOR_DEPTH_MIN,
  INTERIOR_GLYPH_MAX,
  INTERIOR_MAX_STEP,
  INTERIOR_REDUCED_DRIFT,
  INTERIOR_STIFFNESS_LOOSE,
  INTERIOR_STIFFNESS_RIGID,
  interiorAxisAt,
  interiorBodyAxis,
  interiorDepthDim,
  interiorDriftTargets,
  interiorIntegrate,
  interiorSpring,
  sampleInteriorSites,
} from './interior-glyphs';
export type { InteriorAxis, InteriorSites } from './interior-glyphs';
// `createInteriorGlyphField` is deliberately NOT re-exported here, for the
// same reason `createPoolSurface` is not: it is the only part of the field
// that builds a mesh and a node material, and only the engine's own
// reconciler has any use for it.
export type {
  InteriorGlyphField,
  InteriorGlyphFieldOptions,
  InteriorGlyphState,
} from './interior-glyph-field';

/**
 * Create the VFX engine.
 *
 * `setEmergence(p)` stores the eased target; `update(dt)` ramps the current
 * value toward it (so transitions are smooth) and pushes each registered skin's
 * `scrollOffset` into its material uniform.
 */
export function createVFXEngine(): VFXEngine {
  const height = BUST_HEIGHT;
  const plane = new Plane(new Vector3(0, 1, 0), 0);
  const skinBindings: SkinBinding[] = [];
  const eyeBindings: EyeBinding[] = [];

  let activeConfig: HeadConfig = DEFAULT_HEAD_CONFIG;
  let target = 0;
  let current = 0;
  let reduced = false;
  let disposed = false;
  /** Monotonic seconds driving the pool breathe, damped under reduced motion. */
  let poolTime = 0;
  /**
   * Tier 3 solver state and the drive the host wrote for this frame
   * (dec.liquid-glass-fluidity). Held here rather than per binding: there is
   * one body, so there is one global sloshing mode, and every material that
   * dresses it reads the same flow vector.
   */
  let fluidState: FluidState = FLUID_REST;
  let fluidBehaviour: BehaviorState = 'idle';
  let fluidDriveLevel = 0;
  let fluidCarrier: FluidVec3 = [0, 0, 0];
  /** Reused, never reallocated: written into every skin binding each frame. */
  const fluidFlow = new Vector3(0, 0, 0);

  /**
   * Participant modes (dec.liquid-glass-participants). One damped oscillator
   * per marked page element, each localised to the height its element presses
   * at. Separate states rather than one summed mode, because two obstacles
   * facing each other carry opposite flow vectors and their mean is nothing.
   */
  const stageStates: FluidState[] = [];
  const stageBandY: number[] = [];
  const stageFlows: Vector3[] = [];
  for (let i = 0; i < FLUID_PARTICIPANT_MODES; i++) {
    stageStates.push(FLUID_REST);
    stageBandY.push(0);
    stageFlows.push(new Vector3(0, 0, 0));
  }
  /** This frame's measured participants, capped at the slot count. */
  let stageColliders: readonly StageCollider[] = [];
  /** Published solved flow, XYZ per slot. Written in place, never reallocated. */
  const stageFlow = new Float32Array(FLUID_PARTICIPANT_MODES * 3);
  /**
   * Bound page snapshot, or null. The presence of a texture is the hard gate
   * on the lens: `skin.lens.amount` alone must never open it, because the
   * shipped materials would then sample a 1x1 placeholder and fill the head
   * with a flat colour.
   */
  let lens: LensBinding | null = null;
  /**
   * Bind-space extent of the loaded body, for the melt map
   * (`dec.liquid-glass-melt`). Held here rather than per binding because there
   * is one body: every material that dresses it melts on the same numbers, and
   * a material built after the measurement has to be able to pick them up.
   * Zero extent means unmeasured, and an unmeasured body does not melt.
   */
  let bodyMinY = 0;
  let bodyExtent = 0;

  const state = {
    emergence: 0,
    rootOffsetY: computeRootOffsetY(0, height),
  };

  function applyFromCurrent(): void {
    state.emergence = current;
    state.rootOffsetY = computeRootOffsetY(current, height);
    plane.constant = computeClipConstant(current, height);
  }

  function applyConfigToBindings(config: HeadConfig): void {
    for (const binding of skinBindings) {
      const u = binding.uniforms;
      u.baseOpacity.value = config.skin.opacity.base;
      u.lipsOp.value = config.skin.opacity.lips;
      u.noseOp.value = config.skin.opacity.nose;
      u.jawOp.value = config.skin.opacity.jaw;
      u.orbitOp.value = config.skin.opacity.orbit;
      u.browOp.value = config.skin.opacity.brow;
      u.socketMask.value = config.skin.opacity.socketMask;

      u.socketShadow.value = config.skin.shading.socketShadow;
      u.socketSize.value = config.skin.shading.socketSize;
      u.cavity.value = config.skin.shading.cavity;
      u.lipDark.value = config.skin.shading.lipDark;
      u.lipHue.value = config.skin.shading.lipHue;
      u.lipGate.value = config.skin.shading.lipGate;
      u.eyelid.value = config.skin.shading.eyelid;
      u.brow.value = config.skin.shading.brow;
      u.browGate.value = config.skin.shading.browGate;

      u.glyphScale.value = config.skin.glyph.scale;
      u.hDensity.value = config.skin.glyph.horizontalDensity;
      u.vDensity.value = config.skin.glyph.verticalDensity;
      u.sharp.value = config.skin.glyph.sharpness;

      u.tone.value = config.skin.tone.balance;
      u.toneAmt.value = config.skin.tone.amount;
      u.skinWarm.value = config.skin.tone.skinWarmth;
      u.rim.value = config.skin.tone.rim;
      u.glowGain.value = config.skin.tone.glowGain;

      u.glassAmount.value = config.skin.glass.amount;
      u.fresnel.value = config.skin.glass.fresnel;
      u.fresnelPow.value = config.skin.glass.fresnelPower;
      u.specular.value = config.skin.glass.specular;
      u.sheen.value = config.skin.glass.sheen;
      u.refraction.value = config.skin.glass.refraction;
      u.glassTint.value.set(config.skin.glass.tint);

      const adaptation = adaptToBackdrop(config.skin.backdrop.color, config.skin.backdrop.adapt);
      u.inkMix.value = adaptation.inkMix;
      u.inkColor.value.setRGB(...adaptation.inkColor);
      u.glowScale.value = adaptation.glowScale;
      u.opacityFloor.value = adaptation.opacityFloor;
      u.rimColor.value.setRGB(...adaptation.rimColor);

      u.poolAmount.value = config.pool.amount;
      u.poolBreathe.value = config.pool.breathe;
      u.poolFade.value = config.pool.fade;
      // Derived, not configured. The deformed shading normal is only an exact
      // identity with the shipped chain at gate 0, so a zero breathe must
      // close the gate rather than merely zero the displacement.
      u.poolNormalGate.value = config.pool.breathe > 0 ? clamp01(config.pool.amount) : 0;

      u.fluidCrisp.value = config.fluid.crisp;
      u.fluidReach.value = config.fluid.reach;
      // `fluidAmount` and `fluidNormalGate` are NOT written here. Both carry
      // the behaviour gain, which changes without a config write, so `update`
      // owns them and this function must not race it back to the raw config.

      u.meltAmount.value = config.melt.amount;
      u.meltSpread.value = config.melt.spread;
      u.meltFloor.value = config.melt.floor;
      u.meltLag.value = config.melt.lag;
      // Derived, not configured, exactly as `poolNormalGate` is: at 0 the
      // shading normal must be `normalView` itself rather than a value that
      // happens to equal it.
      u.meltNormalGate.value = clamp01(config.melt.amount);
      // `meltMinY` and `meltExtent` are NOT written here. They are measured
      // from the rig, not configured, and a config write must not race
      // `setBodyExtent` back to zero.
      u.stageBand.value = config.stage.band;
      // `stageFlow` and `stageBandY` are NOT written here either: they are
      // per-frame solver output, and a config write mid-frame must not race
      // them back to zero.

      applyLensToUniforms(u, config);
    }

    for (const binding of eyeBindings) {
      const u = binding.uniforms;
      u.eyeDensity.value = config.eyes.density;
      u.scleraGlow.value = config.eyes.scleraGlow;
      u.irisGlow.value = config.eyes.irisGlow;
      u.eyePresence.value = config.eyes.presence;
      u.pupil.value = config.eyes.pupil;
      u.flowDir.value = config.eyes.flowDirection;
      u.irisSize.value = config.eyes.irisSize;
      u.irisColor.value.set(config.eyes.irisColor);
      u.scleraColor.value.set(config.eyes.scleraColor);
    }
  }

  /**
   * Push the bound snapshot into one skin material's uniforms.
   *
   * The gate is derived from the binding, never from the config: with nothing
   * bound it is 0, and at 0 the material's `outputNode` is `output` bit for
   * bit, so a head that refracts nothing is the shipped head exactly.
   *
   * Clearing rebinds the placeholder rather than leaving the old texture in
   * the sampler. `PageLens` disposes its snapshot on teardown, and a disposed
   * texture still referenced by a live material keeps the whole rasterised
   * canvas alive and gets re-uploaded from `image` on the next frame.
   */
  function applyLensToUniforms(u: HeadUniforms, config: HeadConfig): void {
    if (!lens) {
      u.lensGate.value = 0;
      u.lensAmount.value = 0;
      u.lensTexture.value = lensPlaceholderTexture();
      return;
    }
    u.lensGate.value = 1;
    u.lensAmount.value = config.lens.amount;
    u.lensTexture.value = lens.texture;
    u.lensWindow.value.set(
      lens.window.offsetU,
      lens.window.offsetV,
      lens.window.scaleU,
      lens.window.scaleV,
    );
    u.lensDisplacement.value.set(lens.displacement[0], lens.displacement[1]);
  }

  const engine: VFXEngine = {
    createSkinMaterial(skin: TextSkinEngine): SkinMaterials {
      if (disposed) throw new Error('VFXEngine: createSkinMaterial after dispose');
      const built = buildSkinMaterial(skin, activeConfig);
      const binding = { skin, scroll: built.scroll, uniforms: built.uniforms };
      skinBindings.push(binding);
      // An avatar replaced while a lens is bound must not lose it: the new
      // material starts with the gate shut and picks the binding up here.
      applyLensToUniforms(built.uniforms, activeConfig);
      // The pair shares one uniform set, so the binding must outlive whichever
      // half is disposed first: the engine drops the interior overlay on
      // avatar replace while the front material lives on. Counting materials
      // rather than events keeps a repeated `dispose()` from retiring the
      // binding while its other half is still rendering.
      const live = new Set<THREE.Material>([built.material, built.interior, built.mask]);
      const retire = (material: THREE.Material) => (): void => {
        live.delete(material);
        if (live.size > 0) return;
        const index = skinBindings.indexOf(binding);
        if (index >= 0) skinBindings.splice(index, 1);
      };
      built.material.addEventListener('dispose', retire(built.material));
      built.interior.addEventListener('dispose', retire(built.interior));
      built.mask.addEventListener('dispose', retire(built.mask));
      // A replaced avatar gets a fresh material with `meltExtent` at 0, which
      // is inert. Push the measured extent straight back in, the same way the
      // lens binding is: the core measures the body AFTER this call, but a
      // second avatar swapped in later would otherwise lose the melt until
      // something else wrote it.
      built.uniforms.meltMinY.value = bodyMinY;
      built.uniforms.meltExtent.value = bodyExtent;
      return { front: built.material, interior: built.interior, mask: built.mask };
    },

    createEyeballMaterial(eyeSkin: TextSkinEngine, frame: { cx: number; cy: number; cz: number }): THREE.Material {
      if (disposed) throw new Error('VFXEngine: createEyeballMaterial after dispose');
      const built = buildEyeballMaterial(eyeSkin, frame, activeConfig);
      const binding = { skin: eyeSkin, scroll: built.uniforms.scroll, uniforms: built.uniforms };
      eyeBindings.push(binding);
      built.material.addEventListener('dispose', () => {
        const index = eyeBindings.indexOf(binding);
        if (index >= 0) eyeBindings.splice(index, 1);
      });
      return built.material;
    },

    setHeadConfig(overrides: HeadConfigOverrides): void {
      activeConfig = normaliseHeadConfig(overrides, activeConfig);
      applyConfigToBindings(activeConfig);
    },

    get headConfig(): HeadConfig {
      return activeConfig;
    },

    setEmergence(progress: number): void {
      target = easeEmergence(clamp01(progress));
      applyFromCurrent();
    },

    get emergence(): number {
      return state.emergence;
    },

    get rootOffsetY(): number {
      return state.rootOffsetY;
    },

    get clippingPlane(): THREE.Plane {
      return plane;
    },

    setLens(next: LensBinding | null): void {
      if (disposed) return;
      // Called every frame while a lens is live, so identity is the change
      // test: `createPageLens` mints a new binding only when the window, the
      // displacement or the texture actually moved.
      if (next === lens) return;
      lens = next;
      for (const binding of skinBindings) applyLensToUniforms(binding.uniforms, activeConfig);
    },

    setFluidDrive(
      behaviour: BehaviorState,
      drive: number,
      carrierVelocity: readonly [number, number, number],
    ): void {
      if (disposed) return;
      fluidBehaviour = behaviour;
      fluidDriveLevel = Number.isFinite(drive) ? drive : 0;
      fluidCarrier = [
        Number.isFinite(carrierVelocity[0]) ? carrierVelocity[0] : 0,
        Number.isFinite(carrierVelocity[1]) ? carrierVelocity[1] : 0,
        Number.isFinite(carrierVelocity[2]) ? carrierVelocity[2] : 0,
      ];
    },

    setStageColliders(colliders: readonly StageCollider[]): void {
      if (disposed) return;
      stageColliders = colliders;
    },

    setBodyExtent(minY: number, maxY: number): void {
      if (disposed) return;
      // A degenerate or non-finite extent leaves the melt inert rather than
      // dividing by it: the shader gates the whole map on a positive extent.
      const span = maxY - minY;
      const usable = Number.isFinite(minY) && Number.isFinite(maxY) && span > 0;
      bodyMinY = usable ? minY : 0;
      bodyExtent = usable ? span : 0;
      for (const binding of skinBindings) {
        binding.uniforms.meltMinY.value = bodyMinY;
        binding.uniforms.meltExtent.value = bodyExtent;
      }
    },

    get stageFlow(): Float32Array {
      return stageFlow;
    },

    setReducedMotion(reducedMotion: boolean): void {
      reduced = reducedMotion;
    },

    update(dt: number): void {
      if (disposed) return;
      if (reduced) {
        current = target;
      } else {
        const k = 1 - Math.exp(-dt / RAMP_TAU);
        current = current + (target - current) * k;
        if (Math.abs(target - current) < 1e-4) current = target;
      }

      applyFromCurrent();
      // Advance the pool clock only from real frames. Reduced motion damps the
      // breathe rather than freezing it, consistent with the rest of the
      // library; a stopped clock would leave the shell stuck mid-swell.
      if (Number.isFinite(dt) && dt > 0) poolTime += reduced ? dt * REDUCED_DRIVE : dt;
      // Bind-space height of the waterline: the root is translated down by
      // `rootOffsetY`, so world Y 0 sits at local Y `-rootOffsetY`.
      const waterY = -state.rootOffsetY;

      // Tier 3 (dec.liquid-glass-fluidity). The gate is hard: at amount 0 the
      // solver is not integrated at all, the state is held at rest so a later
      // switch-on does not resume mid-slosh, and every uniform the field
      // touches is exactly 0, which is what makes the material graph an
      // identity rather than an approximation of the shipped look.
      const fluidAmount = fluidStateAmount(activeConfig.fluid.amount, fluidBehaviour);
      if (fluidAmount <= 0) {
        fluidState = FLUID_REST;
        fluidFlow.set(0, 0, 0);
      } else {
        // Reduced motion is damped exactly once, by `fluidDrive` in the caller,
        // the same way the pool damps its ripple drive. Damping again here
        // would square the factor and leave the reduced response at five per
        // cent rather than the twenty-two the constant names. The sag is not
        // damped at all: a resting droop is a shape, not a motion.
        fluidState = fluidIntegrate(
          fluidState,
          fluidAccel(
            fluidGravity(activeConfig.fluid.sag, activeConfig.fluid.tension),
            fluidDriveLevel,
            activeConfig.fluid.wobble,
            fluidCarrier,
          ),
          dt,
          activeConfig.fluid.tension,
        );
        fluidFlow.set(fluidState.offset[0], fluidState.offset[1], fluidState.offset[2]);
      }

      // Participant modes (dec.liquid-glass-participants). Gated on the SAME
      // effective amount as the global mode, and deliberately so: the CSS
      // reaction is Newton's third law on this interaction, so a page whose
      // head is rigid must not watch its own furniture slide about. Both
      // sides of the coupling appear together or neither does.
      const stageAmount = fluidAmount > 0 ? clamp01(activeConfig.stage.amount) : 0;
      for (let i = 0; i < FLUID_PARTICIPANT_MODES; i++) {
        const collider = stageAmount > 0 ? stageColliders[i] : undefined;
        if (!collider) {
          // Released, not decayed: a participant that scrolled away should not
          // leave the body holding a dent nobody can see the cause of, and a
          // slot at exact rest contributes exactly zero to the vertex graph.
          stageStates[i] = FLUID_REST;
          stageFlows[i]?.set(0, 0, 0);
          stageBandY[i] = 0;
          stageFlow[i * 3] = 0;
          stageFlow[i * 3 + 1] = 0;
          stageFlow[i * 3 + 2] = 0;
          continue;
        }
        const previous = stageStates[i] ?? FLUID_REST;
        const next = fluidIntegrate(
          previous,
          fluidTargetAccel(
            fluidSqueezeTarget(
              collider.overlap * stageAmount,
              activeConfig.stage.squeeze,
              collider.direction,
            ),
            activeConfig.fluid.tension,
          ),
          dt,
          activeConfig.fluid.tension,
        );
        stageStates[i] = next;
        stageBandY[i] = collider.bandY;
        stageFlows[i]?.set(next.offset[0], next.offset[1], next.offset[2]);
        stageFlow[i * 3] = next.offset[0];
        stageFlow[i * 3 + 1] = next.offset[1];
        stageFlow[i * 3 + 2] = next.offset[2];
      }

      for (const binding of skinBindings) {
        binding.scroll.value = binding.skin.scrollOffset;
        binding.uniforms.poolTime.value = poolTime;
        binding.uniforms.poolWaterY.value = waterY;
        binding.uniforms.fluidAmount.value = fluidAmount;
        binding.uniforms.fluidNormalGate.value = fluidAmount;
        binding.uniforms.fluidFlow.value.copy(fluidFlow);
        for (let i = 0; i < FLUID_PARTICIPANT_MODES; i++) {
          const flow = stageFlows[i];
          const slot = binding.uniforms.stageFlow[i];
          const centre = binding.uniforms.stageBandY[i];
          if (flow && slot) slot.value.copy(flow);
          if (centre) centre.value = stageBandY[i] ?? 0;
        }
      }
      for (const binding of eyeBindings) {
        binding.scroll.value = binding.skin.scrollOffset;
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      skinBindings.length = 0;
      eyeBindings.length = 0;
      lens = null;
      fluidState = FLUID_REST;
      fluidCarrier = [0, 0, 0];
      fluidDriveLevel = 0;
      stageColliders = [];
      stageFlow.fill(0);
      for (let i = 0; i < FLUID_PARTICIPANT_MODES; i++) {
        stageStates[i] = FLUID_REST;
        stageBandY[i] = 0;
        stageFlows[i]?.set(0, 0, 0);
      }
      plane.constant = 0;
    },
  };

  return engine;
}
