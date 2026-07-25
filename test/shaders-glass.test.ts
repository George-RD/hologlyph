import { describe, expect, it } from 'vitest';
import {
  adaptToBackdrop,
  backdropLuminance,
  parseHexColor,
  srgbToLinear,
} from '../src/shaders/glass';

describe('backdrop colour parsing', () => {
  it('parses long and short hex, and rejects anything else', () => {
    expect(parseHexColor('#ffffff')).toEqual([1, 1, 1]);
    expect(parseHexColor('#000000')).toEqual([0, 0, 0]);
    expect(parseHexColor('#F00')).toEqual([1, 0, 0]);
    expect(parseHexColor('rgb(1,2,3)')).toBeNull();
    expect(parseHexColor('#12345')).toBeNull();
    expect(parseHexColor('')).toBeNull();
  });

  it('linearises sRGB channels across the transfer break', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBe(1);
    // Below the 0.04045 break the curve is the plain 1/12.92 ramp.
    expect(srgbToLinear(0.04)).toBeCloseTo(0.04 / 12.92, 12);
    // Mid grey is much darker in linear light than in sRGB.
    expect(srgbToLinear(0.5)).toBeCloseTo(0.2140, 3);
  });

  it('reports relative luminance and treats malformed colours as black', () => {
    expect(backdropLuminance('#000000')).toBe(0);
    expect(backdropLuminance('#ffffff')).toBeCloseTo(1, 6);
    expect(backdropLuminance('not-a-colour')).toBe(0);
    // Green dominates the luminance weighting.
    expect(backdropLuminance('#00ff00')).toBeGreaterThan(backdropLuminance('#ff0000'));
    expect(backdropLuminance('#0000ff')).toBeLessThan(backdropLuminance('#ff0000'));
  });
});

describe('adaptToBackdrop', () => {
  it('is the identity on the approved dark page background', () => {
    const dark = adaptToBackdrop('#05070d', 1);
    expect(dark.inkMix).toBe(0);
    expect(dark.glowScale).toBeGreaterThan(0.99);
    expect(dark.opacityFloor).toBeLessThan(0.01);
    expect(dark.rimColor).toEqual([0.5, 0.7, 1.0]);
  });

  it('turns glyphs into dark ink and cuts the glow on a white page', () => {
    const light = adaptToBackdrop('#ffffff', 1);
    expect(light.inkMix).toBe(1);
    expect(light.glowScale).toBeCloseTo(0.15, 6);
    // Ink is a strongly darkened version of the page it is drawn on.
    expect(light.inkColor[0]).toBeLessThan(0.25);
    expect(light.inkColor[0]).toBeGreaterThan(0);
    expect(light.rimColor[2]).toBeLessThan(0.5);
  });

  it('peaks the opacity floor on a mid tone, where contrast is worst', () => {
    const mid = adaptToBackdrop('#7f7f7f', 1);
    const dark = adaptToBackdrop('#05070d', 1);
    const light = adaptToBackdrop('#ffffff', 1);
    expect(mid.opacityFloor).toBeGreaterThan(dark.opacityFloor);
    expect(mid.opacityFloor).toBeGreaterThan(light.opacityFloor);
    expect(mid.opacityFloor).toBeLessThanOrEqual(0.2);
  });

  it('scales every response by adapt, and adapt 0 pins the dark-page look', () => {
    const off = adaptToBackdrop('#ffffff', 0);
    expect(off.inkMix).toBe(0);
    expect(off.glowScale).toBe(1);
    expect(off.opacityFloor).toBe(0);
    expect(off.rimColor).toEqual([0.5, 0.7, 1.0]);

    const half = adaptToBackdrop('#ffffff', 0.5);
    const full = adaptToBackdrop('#ffffff', 1);
    expect(half.inkMix).toBeCloseTo(full.inkMix * 0.5, 6);
    expect(1 - half.glowScale).toBeCloseTo((1 - full.glowScale) * 0.5, 6);
  });

  it('clamps adapt outside 0 to 1 rather than amplifying', () => {
    expect(adaptToBackdrop('#ffffff', 4).inkMix).toBe(1);
    expect(adaptToBackdrop('#ffffff', -3).inkMix).toBe(0);
  });

  it('rises monotonically with backdrop brightness', () => {
    const ramp = ['#000000', '#333333', '#7f7f7f', '#bbbbbb', '#ffffff'].map((hex) =>
      adaptToBackdrop(hex, 1),
    );
    for (let i = 1; i < ramp.length; i += 1) {
      const prev = ramp[i - 1];
      const next = ramp[i];
      if (!prev || !next) throw new Error('ramp entry missing');
      expect(next.luminance).toBeGreaterThan(prev.luminance);
      expect(next.inkMix).toBeGreaterThanOrEqual(prev.inkMix);
      expect(next.glowScale).toBeLessThan(prev.glowScale);
    }
  });
});
