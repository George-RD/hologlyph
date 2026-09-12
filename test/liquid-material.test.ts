import { describe, expect, it, vi } from 'vitest';
import { CanvasTexture, DataTexture, NoBlending } from 'three';
import type { NodeMaterial } from 'three/webgpu';
import type { TextSkinEngine, VFXEngine } from '../src/contracts';
import { createVFXEngine, liquidBody } from '../src/shaders';
import { buildMouthMaterial, MOUTH_TEETH_DENSITY, MOUTH_TONGUE_DENSITY } from '../src/shaders/mouth-material';

function source(): TextSkinEngine {
  return {
    texture: new CanvasTexture(document.createElement('canvas')),
    scrollOffset: 0, scrollSpeed: 0,
    setSource() {}, setScrollSpeed() {}, setReducedMotion() {}, update() {}, dispose() {},
  };
}

function advance(vfx: VFXEngine, seconds: number): void {
  for (let i = 0; i < seconds * 60; i++) vfx.update(1 / 60);
}

describe('liquid renderer binding', () => {
  it('shares one displacement across the visible body, interior, depth mask and mouth', () => {
    const vfx = createVFXEngine();
    const skin = source();
    const materials = vfx.createSkinMaterial(skin);
    const front = materials.front as NodeMaterial;
    const interior = materials.interior as NodeMaterial;
    const mask = materials.mask as NodeMaterial;
    const mouth = buildMouthMaterial(front) as NodeMaterial;
    expect(front.positionNode).not.toBeNull();
    expect(interior.positionNode).toBe(front.positionNode);
    expect(mask.positionNode).toBe(front.positionNode);
    expect(mouth.positionNode).toBe(front.positionNode);
    expect(mouth.normalNode).toBe(front.normalNode);
    expect(mouth.transparent).toBe(false);
    expect(mouth.blending).toBe(NoBlending);
    expect(mouth.depthWrite).toBe(true);
    expect(mouth.alphaTestNode).not.toBeNull();
    expect(MOUTH_TEETH_DENSITY).toBeGreaterThan(MOUTH_TONGUE_DENSITY);
    const textures: unknown[] = [];
    mouth.colorNode?.traverse(node => {
      if ('value' in node) textures.push(node.value);
    });
    expect(textures).toContain(skin.texture);
    mouth.dispose();
    materials.front.dispose(); materials.interior.dispose(); materials.mask.dispose();
    vfx.dispose(); skin.texture.dispose();
  });

  it('the VFX clock advances the liquid controller and the placement survives re-forming', () => {
    const vfx = createVFXEngine();
    const body = liquidBody(vfx);
    expect(body).toBe(liquidBody(vfx));
    expect(body.amount).toBe(0);
    body.setAmount(1);
    advance(vfx, 3);
    expect(body.canSteer).toBe(true);
    expect(body.steerTo(0.3, 0.2)).toBe(true);
    advance(vfx, 3);
    body.release();
    const before = [...body.position];
    body.setAmount(0);
    advance(vfx, 3);
    expect(body.amount).toBe(0);
    expect(body.position[0]).toBeCloseTo(before[0] ?? 0, 3);
    expect(body.position[1]).toBeCloseTo(before[1] ?? 0, 3);
    vfx.dispose();
  });

  it('uses reduced motion and refuses subsequent work after engine disposal', () => {
    const vfx = createVFXEngine();
    const body = liquidBody(vfx);
    vfx.setReducedMotion(true);
    body.setAmount(1);
    expect(body.amount).toBe(1);
    body.steerTo(0.2, 0.1);
    vfx.update(0);
    expect(body.position).toEqual([0.2, 0.1]);
    vfx.dispose(); vfx.dispose();
    expect(body.steerTo(1, 1)).toBe(false);
    body.setAmount(0);
    expect(body.amount).toBe(1);
    expect(() => liquidBody({} as VFXEngine)).toThrow('no liquid-body binding');
  });

  it('releases its wave texture once but never disposes the borrowed glyph atlas', () => {
    const vfx = createVFXEngine();
    const skin = source();
    const materials = vfx.createSkinMaterial(skin);
    const waveDisposals = vi.spyOn(DataTexture.prototype, 'dispose');
    const atlasDisposals = vi.fn();
    skin.texture.addEventListener('dispose', atlasDisposals);
    try {
      vfx.dispose(); vfx.dispose();
      expect(waveDisposals).toHaveBeenCalledTimes(1);
      expect(atlasDisposals).not.toHaveBeenCalled();
    } finally {
      waveDisposals.mockRestore();
      materials.front.dispose(); materials.interior.dispose(); materials.mask.dispose();
      skin.texture.dispose();
    }
  });
});
