/**
 * VFX engine (dec.renderer-posture).
 *
 * Owns emergence (clipping plane + root translation) and builds the single
 * TSL text-skin material. Module top-level performs no GPU work: the material
 * node graph is built lazily inside `createSkinMaterial`.
 */

import { Plane, Vector3 } from 'three';
import type * as THREE from 'three';
import { clamp01, type TextSkinEngine, type VFXEngine } from '../contracts';
import { buildSkinMaterial, type ScrollUniform } from './materials';
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
}

export { BUST_HEIGHT, RAMP_TAU } from './emergence';
export type { ScrollUniform, BuiltSkinMaterial } from './materials';
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
  const bindings: SkinBinding[] = [];

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

  const engine: VFXEngine = {
    createSkinMaterial(skin: TextSkinEngine): THREE.Material {
      if (disposed) throw new Error('VFXEngine: createSkinMaterial after dispose');
      const built = buildSkinMaterial(skin);
      bindings.push({ skin, scroll: built.scroll });
      return built.material;
    },

    setEmergence(progress: number): void {
      target = easeEmergence(clamp01(progress));
      // Structural values reflect `current`; update() ramps them.
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
        // Reduced motion: emergence must not animate. Snap current straight to
        // the eased target so the bust appears/disappears immediately. The GPU
        // UV scroll push below still runs for any registered skins.
        current = target;
      } else {
        // Exponential smoothing toward the eased target.
        const k = 1 - Math.exp(-dt / RAMP_TAU);
        current = current + (target - current) * k;
        if (Math.abs(target - current) < 1e-4) current = target;
      }

      // Drive each skin's GPU UV scroll from its engine scrollOffset.
      for (const binding of bindings) {
        binding.scroll.value = binding.skin.scrollOffset;
      }

      applyFromCurrent();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      bindings.length = 0;
      plane.constant = 0;
    },
  };

  return engine;
}
