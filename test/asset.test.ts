import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  RIG_VISEME_MORPHS,
  RIG_EXPRESSION_MORPHS,
  RIG_BONES,
  type LoadedAvatar,
} from '../src/contracts';
import { buildLoadedAvatar, validateRig, type RigReport } from '../src/asset/rig';
import { createAssetLoader } from '../src/asset/loader';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

/** Build an in-memory mesh with a morph dictionary/influences, no file IO. */
function makeMorphMesh(names: string[]): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
  const dict: Record<string, number> = {};
  names.forEach((name, index) => {
    dict[name] = index;
  });
  mesh.morphTargetDictionary = dict;
  mesh.morphTargetInfluences = names.map(() => 0);
  return mesh;
}

function makeBone(key: keyof typeof RIG_BONES): THREE.Bone {
  const bone = new THREE.Bone();
  bone.name = RIG_BONES[key];
  return bone;
}

const ALL_CANONICAL = [...RIG_VISEME_MORPHS, ...RIG_EXPRESSION_MORPHS];

describe('validateRig', () => {
  it('reports a fully conformant rig', () => {
    const group = new THREE.Group();
    group.add(makeMorphMesh(ALL_CANONICAL));
    for (const key of Object.keys(RIG_BONES) as (keyof typeof RIG_BONES)[]) {
      group.add(makeBone(key));
    }
    const report: RigReport = validateRig(group);
    expect(report.conformant).toBe(true);
    expect(report.missingMorphs).toEqual([]);
    expect(report.missingBones).toEqual([]);
  });

  it('lists missing morphs and bones', () => {
    const group = new THREE.Group();
    group.add(makeMorphMesh(['viseme_aa', 'exp_happy']));
    group.add(makeBone('head')); // only one of five bones present
    const report = validateRig(group);
    expect(report.conformant).toBe(false);
    expect(report.missingMorphs).toEqual(expect.arrayContaining(['viseme_ee', 'exp_sad']));
    expect(report.missingBones).toEqual(
      expect.arrayContaining(['root', 'neck', 'eye_l', 'eye_r']),
    );
    expect(report.missingBones).not.toContain('head');
  });

  it('ignores meshes without canonical morphs', () => {
    const group = new THREE.Group();
    group.add(makeMorphMesh(['some_custom_morph']));
    const report = validateRig(group);
    expect(report.missingMorphs).toEqual(ALL_CANONICAL);
  });

  it('only counts meshes carrying at least one canonical morph as morph meshes', () => {
    const group = new THREE.Group();
    const rigged = makeMorphMesh(['viseme_aa']);
    const plain = makeMorphMesh(['some_custom_morph']);
    group.add(rigged, plain);
    const avatar = buildLoadedAvatar(group, []);
    expect(avatar.morphMeshes).toHaveLength(1);
    expect(avatar.morphMeshes[0]).toBe(rigged);
  });
});

describe('morph control', () => {
  it('sets and gets a canonical morph across meshes', () => {
    const group = new THREE.Group();
    const a = makeMorphMesh(['viseme_aa', 'viseme_ee']);
    const b = makeMorphMesh(['viseme_aa', 'viseme_ou']);
    group.add(a, b);
    const avatar = buildLoadedAvatar(group, []);
    avatar.setMorph('viseme_aa', 0.4);
    expect(avatar.getMorph('viseme_aa')).toBeCloseTo(0.4);
    // both meshes updated
    expect(a.morphTargetInfluences?.[0]).toBeCloseTo(0.4);
    expect(b.morphTargetInfluences?.[0]).toBeCloseTo(0.4);
  });

  it('clamps weights into [0,1]', () => {
    const group = new THREE.Group();
    group.add(makeMorphMesh(['viseme_aa']));
    const avatar = buildLoadedAvatar(group, []);
    avatar.setMorph('viseme_aa', 5);
    expect(avatar.getMorph('viseme_aa')).toBe(1);
    avatar.setMorph('viseme_aa', -3);
    expect(avatar.getMorph('viseme_aa')).toBe(0);
  });

  it('returns 0 and does not throw for an unknown morph', () => {
    const group = new THREE.Group();
    group.add(makeMorphMesh(['viseme_aa']));
    const avatar = buildLoadedAvatar(group, []);
    expect(() => avatar.setMorph('does_not_exist', 0.5)).not.toThrow();
    expect(avatar.getMorph('does_not_exist')).toBe(0);
  });
});

describe('LoadedAvatar.dispose', () => {
  it('disposes geometries and materials exactly once (idempotent)', () => {
    const group = new THREE.Group();
    const mesh = makeMorphMesh(['viseme_aa']);
    const geometrySpy = vi.fn();
    const materialSpy = vi.fn();
    mesh.geometry.dispose = geometrySpy;
    (mesh.material as THREE.Material).dispose = materialSpy;
    group.add(mesh);

    const avatar: LoadedAvatar = buildLoadedAvatar(group, []);
    avatar.dispose();
    avatar.dispose();
    expect(geometrySpy).toHaveBeenCalledTimes(1);
    expect(materialSpy).toHaveBeenCalledTimes(1);
  });

  it('does not throw when a mesh has no textures', () => {
    const group = new THREE.Group();
    group.add(makeMorphMesh(['viseme_aa']));
    const avatar = buildLoadedAvatar(group, []);
    expect(() => avatar.dispose()).not.toThrow();
  });
});
describe('AssetLoader.attachRenderer', () => {
  it('detects KTX2 support with the renderer when attached', () => {
    const spy = vi
      .spyOn(KTX2Loader.prototype, 'detectSupport')
      .mockImplementation(function (this: KTX2Loader) {
        return this;
      });

    const loader = createAssetLoader();
    const renderer = { isWebGLRenderer: true };
    loader.attachRenderer?.(renderer);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(renderer);
    spy.mockRestore();
  });

  it('does not detect support at construction (only on attachRenderer)', () => {
    const spy = vi
      .spyOn(KTX2Loader.prototype, 'detectSupport')
      .mockImplementation(function (this: KTX2Loader) {
        return this;
      });

    createAssetLoader();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('detects support when a renderer is attached after construction but before any load', () => {
    const spy = vi
      .spyOn(KTX2Loader.prototype, 'detectSupport')
      .mockImplementation(function (this: KTX2Loader) {
        return this;
      });

    const loader = createAssetLoader();
    const renderer = { backend: 'webgl2' };
    // attachRenderer is the trigger; detection must still happen here even
    // though no load() has run yet.
    loader.attachRenderer?.(renderer);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(renderer);
    spy.mockRestore();
  });
});
