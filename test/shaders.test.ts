import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createVFXEngine } from '../src/shaders';
import {
  BUST_HEIGHT,
  computeClipConstant,
  computeRootOffsetY,
  easeEmergence,
  visibleFraction,
} from '../src/shaders/emergence';
import {
  blendedProjectionUV,
  buildSkinMaterial,
  normaliseHeadConfig,
  PLANAR_DENSITY,
  planarUV,
  rowFlowUV,
  SHADE_AMBIENT,
  SHADE_FILL_WEIGHT,
  SHADE_FLOOR,
  SHADE_KEY_WEIGHT,
  triplanarWeights,
  U_SCALE,
  V_SCALE,
} from '../src/shaders/materials';
import { adaptToBackdrop } from '../src/shaders/glass';
import { DEFAULT_HEAD_CONFIG } from '../src/contracts';
import type { TextSkinEngine } from '../src/contracts';

describe('emergence mapping maths (pure)', () => {
  it('easeEmergence is monotonic, bounded, and pinned at the ends', () => {
    expect(easeEmergence(0)).toBe(0);
    expect(easeEmergence(1)).toBe(1);
    expect(easeEmergence(0.5)).toBeCloseTo(0.5, 6);

    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const v = easeEmergence(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('p=0 is fully submerged, p=1 is settled', () => {
    const sub = visibleFraction(computeRootOffsetY(0), computeClipConstant(0), BUST_HEIGHT);
    const settled = visibleFraction(computeRootOffsetY(1), computeClipConstant(1), BUST_HEIGHT);
    expect(sub).toBeCloseTo(0, 6);
    expect(settled).toBeCloseTo(1, 6);
  });

  it('rootOffsetY rises monotonically from -H to 0 with emergence', () => {
    expect(computeRootOffsetY(0)).toBeCloseTo(-BUST_HEIGHT, 6);
    expect(computeRootOffsetY(1)).toBeCloseTo(0, 6);

    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const v = computeRootOffsetY(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('clip constant is consistent with rootOffsetY: visible fraction equals emergence', () => {
    for (let i = 0; i <= 20; i++) {
      const p = i / 20;
      const e = easeEmergence(p);
      const root = computeRootOffsetY(e);
      const clip = computeClipConstant(e);
      expect(visibleFraction(root, clip, BUST_HEIGHT)).toBeCloseTo(e, 6);
    }
  });

  it('visible fraction increases monotonically with progress', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const p = i / 20;
      const e = easeEmergence(p);
      const frac = visibleFraction(computeRootOffsetY(e), computeClipConstant(e), BUST_HEIGHT);
      expect(frac).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = frac;
    }
  });
});

describe('VFX engine (no GPU objects)', () => {
  it('ramps emergence toward target and resolves clip/root consistently', () => {
    const vfx = createVFXEngine();

    vfx.setEmergence(1);
    for (let i = 0; i < 200; i++) vfx.update(0.1);
    expect(vfx.emergence).toBeCloseTo(1, 3);
    expect(vfx.rootOffsetY).toBeCloseTo(0, 3);
    expect(vfx.clippingPlane.normal.y).toBe(1);
    expect(vfx.clippingPlane.constant).toBe(0);

    vfx.setEmergence(0);
    for (let i = 0; i < 200; i++) vfx.update(0.1);
    expect(vfx.emergence).toBeCloseTo(0, 3);
    expect(vfx.rootOffsetY).toBeCloseTo(-BUST_HEIGHT, 3);
    expect(visibleFraction(vfx.rootOffsetY, vfx.clippingPlane.constant, BUST_HEIGHT)).toBeCloseTo(0, 3);
  });

  it('dispose is idempotent and does not throw', () => {
    const vfx = createVFXEngine();
    vfx.dispose();
    expect(() => vfx.dispose()).not.toThrow();
  });
  it('updates eye uniforms in place on setHeadConfig and advances eye scroll on update', () => {
    const vfx = createVFXEngine();
    let scrollReads = 0;
    const eyeSkin = {
      texture: new THREE.CanvasTexture(),
      get scrollOffset() {
        scrollReads++;
        return 1.5;
      },
    } as unknown as TextSkinEngine;
    const material = vfx.createEyeballMaterial(eyeSkin, { cx: 0.688, cy: 0.003, cz: 0 });
    const colorSet = vi.spyOn(THREE.Color.prototype, 'set');

    vfx.setHeadConfig({ eyes: { pupil: 0.55, irisColor: '#123456' } });
    vfx.update(0.016);

    expect(vfx.headConfig.eyes.pupil).toBe(0.55);
    expect(colorSet).toHaveBeenCalledWith('#123456');
    expect(scrollReads).toBe(1);
    colorSet.mockRestore();
    material.dispose();
    vfx.dispose();
  });
  it('unregisters disposed skin and eye material bindings', () => {
    const vfx = createVFXEngine();
    let bindingsLive = true;
    const skin = {
      texture: new THREE.CanvasTexture(),
      get scrollOffset() {
        if (!bindingsLive) throw new Error('disposed skin binding was read');
        return 0;
      },
    } as unknown as TextSkinEngine;
    const skinMaterial = vfx.createSkinMaterial(skin);
    const eyeMaterial = vfx.createEyeballMaterial(skin, { cx: 0.688, cy: 0.003, cz: 0 });

    skinMaterial.dispose();
    eyeMaterial.dispose();
    bindingsLive = false;

    expect(() => vfx.update(0.016)).not.toThrow();
    vfx.dispose();
  });
});
describe('VFX reduced motion', () => {
  it('snaps emergence to target without animating when reduced motion is on', () => {
    const vfx = createVFXEngine();
    vfx.setReducedMotion(true);
    vfx.setEmergence(1);
    // A single small step must already be fully emerged (no ramp).
    vfx.update(0.016);
    expect(vfx.emergence).toBe(1);

    // The GPU UV scroll push must still run under reduced motion (no throw).
    vfx.update(0.016);
  });

  it('returns to a normal ramp when reduced motion is cleared', () => {
    const vfx = createVFXEngine();
    vfx.setReducedMotion(true);
    vfx.setEmergence(1);
    vfx.update(0.016);
    expect(vfx.emergence).toBe(1);

    // Clear reduced motion and drive emergence back to 0: it must ramp, not snap.
    vfx.setReducedMotion(false);
    vfx.setEmergence(0);
    vfx.update(0.016);
    // Single small step from 1 -> 0; ramp tau is 0.3 so still near 1.
    expect(vfx.emergence).toBeGreaterThan(0.9);
    expect(vfx.emergence).toBeLessThan(1);
  });
});

describe('planar skin projection (pure)', () => {
  it('centres the grid on x=0 at u=0.5', () => {
    expect(planarUV(0, 0).u).toBeCloseTo(0.5, 6);
    expect(planarUV(0, 0).v).toBeCloseTo(0, 6);
  });

  it('is symmetric in x sign around u=0.5', () => {
    const right = planarUV(0.2, 0);
    const left = planarUV(-0.2, 0);
    expect(right.u + left.u).toBeCloseTo(1, 6);
    expect(right.u).toBeGreaterThan(0.5);
  });

  it('advances u and v linearly by the exported scales', () => {
    expect(planarUV(1, 0).u).toBeCloseTo(0.5 + U_SCALE, 6);
    expect(planarUV(0, 1).v).toBeCloseTo(V_SCALE, 6);
    expect(planarUV(0, 0.5).v).toBeCloseTo(V_SCALE / 2, 6);
  });
  it('flows content horizontally per row while keeping bind-pose v fixed', () => {
    const first = rowFlowUV(0.1, 0.2, 0);
    const moved = rowFlowUV(0.1, 0.2, 1);
    const adjacent = rowFlowUV(0.1, 0.2 + 1 / PLANAR_DENSITY, 1);
    expect(moved.v).toBeCloseTo(first.v, 6);
    expect(moved.u).not.toBeCloseTo(first.u, 6);
    expect(adjacent.v).toBeGreaterThan(moved.v);
    expect(adjacent.u - rowFlowUV(0.1, 0.2 + 1 / PLANAR_DENSITY, 0).u).not.toBeCloseTo(
      moved.u - first.u,
      6,
    );
  });
  it('normalises squared triplanar weights and favours the dominant axis', () => {
    const weights = triplanarWeights(0.1, 0.2, 0.97);
    expect(weights.x + weights.y + weights.z).toBeCloseTo(1, 6);
    expect(weights.z).toBeGreaterThan(weights.x);
    expect(weights.z).toBeGreaterThan(weights.y);
    expect(triplanarWeights(0, 0, 0)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('uses a low planar density so glyphs read large on the bust', () => {
    // 40 cells per world unit keeps individual glyphs recognisable at demo
    // size (was 20 against quantised-position GLBs whose shader positions
    // were scaled 2x; base positions ship as float32 now).
    expect(PLANAR_DENSITY).toBe(40);
    // U_SCALE / V_SCALE must still derive from the density and stay square.
    expect(U_SCALE).toBeCloseTo(PLANAR_DENSITY / 96, 6);
    expect(V_SCALE).toBeCloseTo(PLANAR_DENSITY / 64, 6);
  });
  it('keeps glyph cells square: equal world-space cell density on both axes', () => {
    // 96 columns per u unit and 64 rows per v unit; equal cells per world
    // unit on x and y means U_SCALE * 96 === V_SCALE * 64.
    expect(U_SCALE * 96).toBeCloseTo(V_SCALE * 64, 6);
  });
});

describe('owner-approved head configuration', () => {
  it('pins every approved production value and is deeply immutable', () => {
    expect(DEFAULT_HEAD_CONFIG).toEqual({
      skin: {
        opacity: {
          base: 0.075, lips: 0.32, nose: 0.38, jaw: 0.21, orbit: 0.15, brow: 0,
          socketMask: 0,
        },
        shading: {
          socketShadow: 0, socketSize: 1, cavity: 0.45, lipDark: 0.5,
          lipHue: 0.6, lipGate: 1.4, eyelid: 0.5, brow: 0.3, browGate: 2.2,
        },
        glyph: {
          scale: 0.79, horizontalDensity: 2, verticalDensity: 2, sharpness: 5.5,
        },
        tone: {
          balance: 0.21, amount: 0.65, skinWarmth: 0, rim: 0.065, glowGain: 0.55,
        },
        glass: {
          amount: 1, fresnel: 0.65, fresnelPower: 2.6, specular: 0.55,
          sheen: 40, refraction: 0.03, tint: '#bfe6ff',
        },
        backdrop: { color: '#05070d', adapt: 1, auto: true },
      },
      eyes: {
        density: 300, scleraGlow: 0.51, irisGlow: 2.35, presence: 0.74,
        pupil: 0.24, flowDirection: 1, irisSize: 0.43,
        irisColor: '#d78bf8', scleraColor: '#e1edf9',
      },
    });
    expect(Object.isFrozen(DEFAULT_HEAD_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_HEAD_CONFIG.skin.opacity)).toBe(true);
    expect(Object.isFrozen(DEFAULT_HEAD_CONFIG.eyes)).toBe(true);
    expect(Object.isFrozen(DEFAULT_HEAD_CONFIG.skin.shading)).toBe(true);
    expect(Object.isFrozen(DEFAULT_HEAD_CONFIG.skin.glyph)).toBe(true);
    expect(Object.isFrozen(DEFAULT_HEAD_CONFIG.skin.tone)).toBe(true);
    expect(Object.isFrozen(DEFAULT_HEAD_CONFIG.skin.glass)).toBe(true);
    expect(Object.isFrozen(DEFAULT_HEAD_CONFIG.skin.backdrop)).toBe(true);
  });

  it('deep-merges partial overrides, clamps values, and rejects malformed colours', () => {
    const merged = normaliseHeadConfig({
      skin: { opacity: { lips: 4 }, glyph: { scale: -1 } },
      eyes: { pupil: -2, irisColor: '#ABCDEF', scleraColor: 'not-a-colour' },
    });
    expect(merged.skin.opacity.lips).toBe(1);
    expect(merged.skin.opacity.base).toBe(DEFAULT_HEAD_CONFIG.skin.opacity.base);
    expect(merged.skin.glyph.scale).toBeGreaterThan(0);
    expect(merged.eyes.pupil).toBe(0);
    expect(merged.eyes.irisColor).toBe('#abcdef');
    expect(merged.eyes.scleraColor).toBe(DEFAULT_HEAD_CONFIG.eyes.scleraColor);
    expect(Object.isFrozen(merged)).toBe(true);
    expect(Object.isFrozen(merged.skin.opacity)).toBe(true);
    expect(Object.isFrozen(merged.skin.shading)).toBe(true);
    expect(Object.isFrozen(merged.skin.glyph)).toBe(true);
    expect(Object.isFrozen(merged.skin.tone)).toBe(true);
    expect(Object.isFrozen(merged.eyes)).toBe(true);
  });
});

describe('projection blend mapping', () => {
  it('interpolates projection coordinates into one sample coordinate', () => {
    const front = blendedProjectionUV(0.2, 0.1, 0.3, 0, 0, 1, 0, 5.5);
    const side = blendedProjectionUV(0.2, 0.1, 0.3, 1, 0, 0, 0, 5.5);
    const diagonal = blendedProjectionUV(0.2, 0.1, 0.3, 1, 0, 1, 0, 5.5);
    expect(diagonal.u).toBeCloseTo((front.u + side.u) / 2, 6);
    expect(diagonal.v).toBeCloseTo((front.v + side.v) / 2, 6);
    expect(diagonal.samples).toBe(1);
  });

  it('preserves the dominant-axis mapping and continuous coverage at the blend', () => {
    const before = blendedProjectionUV(0.2, 0.1, 0.3, 0.69, 0, 0.71, 0.2, 5.5);
    const after = blendedProjectionUV(0.2, 0.1, 0.3, 0.71, 0, 0.69, 0.2, 5.5);
    expect(Math.abs(before.u - after.u)).toBeLessThan(0.02);
    expect(Math.abs(before.v - after.v)).toBeLessThan(0.02);
  });
});

describe('skin shading constants (pure)', () => {
  it('weights the two directional lights by their scene intensities', () => {
    // Key light intensity 2.2 white; fill light intensity 0.8 cool.
    expect(SHADE_KEY_WEIGHT).toBeCloseTo(2.2, 6);
    expect(SHADE_FILL_WEIGHT).toBeCloseTo(0.8, 6);
  });

  it('adds a small ambient floor and clamps shade above a readable minimum', () => {
    expect(SHADE_AMBIENT).toBeCloseTo(0.08, 6);
    expect(SHADE_FLOOR).toBeCloseTo(0.12, 6);
    expect(SHADE_AMBIENT).toBeGreaterThan(0);
    expect(SHADE_AMBIENT).toBeLessThan(SHADE_FLOOR);
    expect(SHADE_FLOOR).toBeGreaterThan(0);
    expect(SHADE_FLOOR).toBeLessThan(1);
  });
});
describe('buildSkinMaterial (no GPU objects)', () => {
  it('is translucent and uses owner defaults in its live uniform binding', () => {
    const skin = { texture: new THREE.CanvasTexture() } as unknown as TextSkinEngine;
    const { material, uniforms } = buildSkinMaterial(skin, DEFAULT_HEAD_CONFIG);
    expect(material.transparent).toBe(true);
    expect(uniforms.baseOpacity.value).toBe(DEFAULT_HEAD_CONFIG.skin.opacity.base);
    expect(uniforms.glowGain.value).toBe(DEFAULT_HEAD_CONFIG.skin.tone.glowGain);
  });

  it('sets RepeatWrapping on both texture axes so the grid tiles under scroll', () => {
    const skin = { texture: new THREE.CanvasTexture() } as unknown as TextSkinEngine;
    buildSkinMaterial(skin, DEFAULT_HEAD_CONFIG);
    expect(skin.texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(skin.texture.wrapT).toBe(THREE.RepeatWrapping);
  });

  it('seeds the glass uniforms and the backdrop adaptation from the config', () => {
    const skin = { texture: new THREE.CanvasTexture() } as unknown as TextSkinEngine;
    const { uniforms } = buildSkinMaterial(skin, DEFAULT_HEAD_CONFIG);
    expect(uniforms.fresnel.value).toBe(DEFAULT_HEAD_CONFIG.skin.glass.fresnel);
    expect(uniforms.refraction.value).toBe(DEFAULT_HEAD_CONFIG.skin.glass.refraction);
    expect(uniforms.sheen.value).toBe(DEFAULT_HEAD_CONFIG.skin.glass.sheen);
    // The default backdrop is the dark page the look was approved on, so the
    // adaptation is the identity: full glow, no ink, no opacity floor.
    expect(uniforms.inkMix.value).toBe(0);
    expect(uniforms.glowScale.value).toBeGreaterThan(0.99);
    expect(uniforms.opacityFloor.value).toBeLessThan(0.01);
  });

  it('writes the adaptation into the live material when the backdrop turns light', () => {
    const vfx = createVFXEngine();
    const skin = { texture: new THREE.CanvasTexture(), scrollOffset: 0 } as unknown as TextSkinEngine;
    const material = vfx.createSkinMaterial(skin);
    const setRGB = vi.spyOn(THREE.Color.prototype, 'setRGB');

    vfx.setHeadConfig({ skin: { backdrop: { color: '#ffffff' } } });

    const adaptation = adaptToBackdrop('#ffffff', 1);
    expect(vfx.headConfig.skin.backdrop.color).toBe('#ffffff');
    // The ink and rim colours are pushed into the existing uniforms rather
    // than rebuilding the material.
    expect(setRGB).toHaveBeenCalledWith(...adaptation.inkColor);
    expect(setRGB).toHaveBeenCalledWith(...adaptation.rimColor);
    setRGB.mockRestore();
    material.dispose();
    vfx.dispose();
  });

  it('keeps the dark-page look when adaptation is switched off', () => {
    const skin = { texture: new THREE.CanvasTexture() } as unknown as TextSkinEngine;
    const config = normaliseHeadConfig({ skin: { backdrop: { color: '#ffffff', adapt: 0 } } });
    const { uniforms } = buildSkinMaterial(skin, config);
    expect(uniforms.inkMix.value).toBe(0);
    expect(uniforms.glowScale.value).toBe(1);
    expect(uniforms.opacityFloor.value).toBe(0);
  });
});
