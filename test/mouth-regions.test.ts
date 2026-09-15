import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { WebIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { mouthRegionWeights } from '../tools/asset-pipeline/build-bust';

describe('source-labelled mouth regions', () => {
  it('separates teeth and tongue from gums using source identity, not spatial bands', () => {
    const tongue = new Set([42]);
    expect(mouthRegionWeights(4, 13, tongue)).toEqual([1, 0]);
    expect(mouthRegionWeights(3, 42, tongue)).toEqual([0, 1]);
    expect(mouthRegionWeights(3, 13, tongue)).toEqual([0, 0]);
    expect(mouthRegionWeights(0, 42, tongue)).toEqual([0, 0]);
    expect(mouthRegionWeights(4, 42, tongue)).toEqual([1, 0]);
  });

  it('ships both region masks through optimisation with the canonical morphs', async () => {
    await MeshoptDecoder.ready;
    const io = new WebIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const doc = await io.readBinary(new Uint8Array(readFileSync('assets/hologlyph-bust.glb')));
    const mouth = doc.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives())
      .find(primitive => primitive.getMaterial()?.getName() === 'mouth_interior');
    expect(mouth).toBeDefined();
    const roles = mouth?.getAttribute('_ORAL_REGION');
    expect(roles, 'author-labelled teeth/tongue attribute').toBeTruthy();
    if (!mouth || !roles) return;
    expect(roles.getType()).toBe('VEC2');
    expect(roles.getCount()).toBe(mouth.getAttribute('POSITION')?.getCount());
    const counts: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < roles.getCount(); i++) {
      const [teeth, tongue] = roles.getElement(i, [0, 0]);
      expect(teeth).toBeGreaterThanOrEqual(0);
      expect(tongue).toBeGreaterThanOrEqual(0);
      expect((teeth ?? 0) + (tongue ?? 0)).toBeLessThanOrEqual(1);
      if (teeth === 1) counts[0]++;
      else if (tongue === 1) counts[1]++;
      else counts[2]++;
    }
    expect(counts.every(count => count > 100)).toBe(true);
    const tongueOut = mouth.listTargets().find(target => target.getName() === 'tongue_out')?.getAttribute('POSITION');
    expect(tongueOut).toBeDefined();
    let movingTongue = 0;
    if (!tongueOut) return;
    for (let i = 0; i < roles.getCount(); i++) {
      if (tongueOut.getElement(i, []).some(component => Math.abs(component) > 0.001)) {
        expect(roles.getElement(i, [0, 0])[1], 'tongue motion retains its tongue shading').toBe(1);
        movingTongue++;
      }
    }
    expect(movingTongue).toBeGreaterThan(50);
  });
});
