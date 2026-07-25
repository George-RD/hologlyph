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
  type TextSkinEngine,
  type VFXEngine,
} from '../contracts';
import {
  buildEyeballMaterial,
  buildSkinMaterial,
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

  const engine: VFXEngine = {
    createSkinMaterial(skin: TextSkinEngine): THREE.Material {
      if (disposed) throw new Error('VFXEngine: createSkinMaterial after dispose');
      const built = buildSkinMaterial(skin, activeConfig);
      const binding = { skin, scroll: built.scroll, uniforms: built.uniforms };
      skinBindings.push(binding);
      built.material.addEventListener('dispose', () => {
        const index = skinBindings.indexOf(binding);
        if (index >= 0) skinBindings.splice(index, 1);
      });
      return built.material;
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

      for (const binding of skinBindings) {
        binding.scroll.value = binding.skin.scrollOffset;
      }
      for (const binding of eyeBindings) {
        binding.scroll.value = binding.skin.scrollOffset;
      }

      applyFromCurrent();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      skinBindings.length = 0;
      eyeBindings.length = 0;
      plane.constant = 0;
    },
  };

  return engine;
}
