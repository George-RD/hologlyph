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
  clamp01,
  DEFAULT_HEAD_CONFIG,
  type HeadConfig,
  type HeadConfigOverrides,
  type LensBinding,
  type SkinMaterials,
  type TextSkinEngine,
  type VFXEngine,
} from '../contracts';
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
export type { PoolProfile } from './pool';
// `createPoolSurface` is deliberately NOT re-exported here. It is the only
// part of the pool that touches `three/webgpu` render targets, and nothing
// but the engine's own pool reconciler has any use for it, so it is imported
// from its module directly rather than widened into the shader barrel.
export type { PoolSurface, PoolSurfaceState, PoolUniforms } from './pool-surface';

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
   * Bound page snapshot, or null. The presence of a texture is the hard gate
   * on the lens: `skin.lens.amount` alone must never open it, because the
   * shipped materials would then sample a 1x1 placeholder and fill the head
   * with a flat colour.
   */
  let lens: LensBinding | null = null;

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
      const live = new Set<THREE.Material>([built.material, built.interior]);
      const retire = (material: THREE.Material) => (): void => {
        live.delete(material);
        if (live.size > 0) return;
        const index = skinBindings.indexOf(binding);
        if (index >= 0) skinBindings.splice(index, 1);
      };
      built.material.addEventListener('dispose', retire(built.material));
      built.interior.addEventListener('dispose', retire(built.interior));
      return { front: built.material, interior: built.interior };
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

      for (const binding of skinBindings) {
        binding.scroll.value = binding.skin.scrollOffset;
        binding.uniforms.poolTime.value = poolTime;
        binding.uniforms.poolWaterY.value = waterY;
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
      plane.constant = 0;
    },
  };

  return engine;
}
