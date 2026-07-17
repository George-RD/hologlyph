import { describe, expect, it } from 'vitest';
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
  BASE_OPACITY,
  buildSkinMaterial,
  GLOW_GAIN,
  planarUV,
  PLANAR_DENSITY,
  RIM_GAIN,
  SHADE_AMBIENT,
  SHADE_FILL_WEIGHT,
  SHADE_FLOOR,
  SHADE_KEY_WEIGHT,
  U_SCALE,
  V_SCALE,
} from '../src/shaders/materials';
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

  it('uses a low planar density so glyphs read large on the bust', () => {
    // ~35% larger letters than the old 124: 92 cells per world unit.
    expect(PLANAR_DENSITY).toBe(92);
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
  it('is translucent with a base opacity floor below full glyph luma', () => {
    expect(BASE_OPACITY).toBeGreaterThan(0);
    expect(BASE_OPACITY).toBeLessThan(1);

    const skin = { texture: new THREE.CanvasTexture() } as unknown as TextSkinEngine;
    const { material } = buildSkinMaterial(skin);

    expect(material.transparent).toBe(true);
  });

  it('sets RepeatWrapping on both texture axes so the grid tiles under scroll', () => {
    const skin = { texture: new THREE.CanvasTexture() } as unknown as TextSkinEngine;
    buildSkinMaterial(skin);

    expect(skin.texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(skin.texture.wrapT).toBe(THREE.RepeatWrapping);
  });

  it('exports positive glow and rim gains for the holographic emissive term', () => {
    expect(GLOW_GAIN).toBeGreaterThan(0);
    expect(RIM_GAIN).toBeGreaterThan(0);
  });
});
