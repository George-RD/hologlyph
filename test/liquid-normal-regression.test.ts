import { describe, expect, it } from 'vitest';
import { CanvasTexture } from 'three';
import type { NodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import type { TextSkinEngine } from '../src/contracts';
import { buildSkinMaterial } from '../src/shaders/materials';
import { LiquidMaterialOwner } from '../src/shaders/liquid-material';
import { bindMouthGlyphSource, buildMouthMaterial } from '../src/shaders/mouth-material';

function source(): TextSkinEngine {
  return {
    texture: new CanvasTexture(document.createElement('canvas')),
    scrollOffset: 0, scrollSpeed: 0,
    setSource() {}, setScrollSpeed() {}, setReducedMotion() {}, update() {}, dispose() {},
  };
}

function nodes(root: NodeMaterial['colorNode']): unknown[] {
  const found: unknown[] = [];
  root?.traverse(node => found.push(node));
  return found;
}

describe('liquid normal sub-build regression', () => {
  it('preserves the front and back normal chains independently', () => {
    const skin = source();
    const built = buildSkinMaterial(skin);
    const front = built.material as MeshStandardNodeMaterial;
    const back = built.interior as NodeMaterial;
    const originalFront = front.normalNode;
    const originalBack = back.normalNode;
    const owner = new LiquidMaterialOwner();
    try {
      owner.attachSurface({ front, interior: back, mask: built.mask }, skin);
      expect(nodes(front.normalNode)).toContain(originalFront);
      expect(nodes(back.normalNode)).toContain(originalBack);
      expect(back.normalNode).not.toBe(front.normalNode);
    } finally {
      owner.dispose(); front.dispose(); back.dispose(); built.mask.dispose(); skin.texture.dispose();
    }
  });

  it('reads normalView in colour instead of evaluating the custom normal graph twice', () => {
    const skin = source();
    const built = buildSkinMaterial(skin);
    const front = built.material as MeshStandardNodeMaterial;
    const owner = new LiquidMaterialOwner();
    owner.attachSurface({ front, interior: built.interior, mask: built.mask }, skin);
    bindMouthGlyphSource(front, skin);
    const mouth = buildMouthMaterial(front) as NodeMaterial;
    try {
      // normalView invokes setupNormal in Three's NORMAL sub-build. Embedding
      // normalNode in colour evaluates it in the wrong context and creates a
      // self-reference through normalView. The browser result was a black head.
      expect(nodes(front.colorNode)).not.toContain(front.normalNode);
      expect(nodes(front.emissiveNode)).not.toContain(front.normalNode);
      expect(nodes(mouth.colorNode)).not.toContain(mouth.normalNode);
      expect(mouth.normalNode).toBe(front.normalNode);
    } finally {
      mouth.dispose(); owner.dispose(); front.dispose(); built.interior.dispose();
      built.mask.dispose(); skin.texture.dispose();
    }
  });
});
