import { describe, expect, it } from 'vitest';
import { NoBlending, FrontSide, CanvasTexture } from 'three';
import type { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import type { TextSkinEngine } from '../src/contracts';
import { buildSkinMaterial } from '../src/shaders/materials';
import { buildMouthMaterial } from '../src/shaders/mouth-material';

function makeSkin(): TextSkinEngine {
  return {
    texture: new CanvasTexture(document.createElement('canvas')), scrollOffset: 0, scrollSpeed: 0,
    setSource() {}, setScrollSpeed() {}, setReducedMotion() {}, update() {}, dispose() {},
  };
}

describe('holographic mouth material', () => {
  it('borrows the live colour and deformation graphs, not outer-skin transparency', () => {
    const skin = buildSkinMaterial(makeSkin());
    const front = skin.material as MeshStandardNodeMaterial;
    const mouth = buildMouthMaterial(skin.material) as MeshBasicNodeMaterial;
    expect(mouth.name).toBe('mouth_interior');
    expect(mouth.transparent).toBe(false);
    expect(mouth.blending).toBe(NoBlending);
    expect(mouth.depthWrite).toBe(true);
    expect(mouth.depthTest).toBe(true);
    expect(mouth.side).toBe(FrontSide);
    expect(mouth.opacityNode).toBeNull();
    expect(mouth.positionNode).toBe(front.positionNode);
    expect(mouth.normalNode).toBe(front.normalNode);
    const nodes: unknown[] = [];
    mouth.colorNode?.traverse((node) => { nodes.push(node); });
    expect(nodes).toContain(front.colorNode);
    expect(nodes).toContain(skin.uniforms.scroll);
    expect(nodes).toContain(skin.uniforms.glyphScale);
    mouth.dispose(); skin.material.dispose(); skin.interior.dispose(); skin.mask.dispose();
  });

  it('does not dispose its borrowed surface or atlas', () => {
    const atlas = makeSkin();
    const skin = buildSkinMaterial(atlas);
    let surfaceDisposals = 0;
    let textureDisposals = 0;
    skin.material.addEventListener('dispose', () => { surfaceDisposals++; });
    atlas.texture.addEventListener('dispose', () => { textureDisposals++; });
    const mouth = buildMouthMaterial(skin.material);
    let mouthDisposals = 0;
    mouth.addEventListener('dispose', () => { mouthDisposals++; });
    mouth.dispose(); mouth.dispose();
    expect(mouthDisposals).toBe(1);
    expect(surfaceDisposals).toBe(0);
    expect(textureDisposals).toBe(0);
    skin.material.dispose(); skin.interior.dispose(); skin.mask.dispose();
  });
});
