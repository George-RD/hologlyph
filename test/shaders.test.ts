import { describe, expect, it } from 'vitest';
import { createVFXEngine } from '../src/shaders';
import {
  BUST_HEIGHT,
  computeClipConstant,
  computeRootOffsetY,
  easeEmergence,
  visibleFraction,
} from '../src/shaders/emergence';

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
