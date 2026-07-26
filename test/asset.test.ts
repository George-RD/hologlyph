import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  RIG_VISEME_MORPHS,
  RIG_TONGUE_MORPHS,
  RIG_EXPRESSION_MORPHS,
  RIG_BONES,
  type LoadedAvatar,
  type SilhouetteHull,
  type SilhouetteHullGroup,
} from '../src/contracts';
import {
  bakeFeatureMasks,
  bakeThickness,
  buildLoadedAvatar,
  computeThickness,
  createThicknessBudget,
  THICKNESS_WORK_BUDGET,
  THICKNESS_VERTEX_BUDGET,
  validateRig,
  type RigReport,
} from '../src/asset/rig';
import {
  readSilhouetteHull,
  SilhouetteProjector,
  SILHOUETTE_HULL_KEY,
  SILHOUETTE_HULL_VERSION,
} from '../src/asset/hull';
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

const ALL_CANONICAL = [...RIG_VISEME_MORPHS, ...RIG_TONGUE_MORPHS, ...RIG_EXPRESSION_MORPHS];

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
describe('AssetLoader.dispose', () => {
  it('disposes KTX2Loader once', () => {
    const spy = vi.spyOn(KTX2Loader.prototype, 'dispose');
    const loader = createAssetLoader();
    loader.dispose();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
describe('feature mask baking (buildLoadedAvatar)', () => {
  it('bakes feature attributes on morph meshes and degrades missing morphs to zero without throwing', () => {
    const group = new THREE.Group();
    const mesh = makeMorphMesh(['viseme_pp', 'viseme_ou']);
    const positions = new Float32Array([
      0, 0, 0,
      0.1, +-0.05, 0.1,
      +-0.1, +-0.05, 0.1,
    ]);
    const deltas = new Float32Array([
      0, 0, 0,
      0, 0.05, 0,
      0, 0.05, 0,
    ]);
    mesh.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    mesh.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    mesh.geometry.morphAttributes.position = [new THREE.BufferAttribute(deltas, 3), new THREE.BufferAttribute(deltas, 3)];
    group.add(mesh);

    const avatar = buildLoadedAvatar(group, []);
    expect(avatar.morphMeshes[0]).toBe(mesh);

    const geo = mesh.geometry;
    const aLips = geo.getAttribute('aLips') as THREE.InterleavedBufferAttribute;
    const aJaw = geo.getAttribute('aJaw') as THREE.InterleavedBufferAttribute;
    const aBrow = geo.getAttribute('aBrow') as THREE.InterleavedBufferAttribute;
    const aCavity = geo.getAttribute('aCavity') as THREE.InterleavedBufferAttribute;
    const aSocket = geo.getAttribute('aSocket') as THREE.InterleavedBufferAttribute;
    expect(aLips).toBeDefined();
    expect(aBrow).toBeDefined();
    expect(aLips.getX(1)).toBeGreaterThan(0);
    expect(aBrow.getX(1)).toBe(0);
    expect(aLips.data).toBe(aJaw.data);
    expect(aLips.data).toBe(aBrow.data);
    expect(aCavity.data).toBe(aSocket.data);
    expect(aLips.data).not.toBe(aCavity.data);
  });
});

/**
 * A ray from `probeNear` travels +x and must stop at the near wall (t = 0.3),
 * not at the slanted far wall (t = 0.715).
 *
 * The far wall's bounding box overlaps the probe's own grid cell while its
 * actual intersection lies four cells downrange, so a grid traversal that
 * accepts the first bucket hit picks the wrong surface. The near wall lives in
 * the next cell along and is only found by continuing the walk.
 *
 * `probeFar` marches the length of the box to the back wall (t = 0.95), which
 * pins the normalisation divisor so the assertion reads in absolute distance.
 */
function makeNearestHitProbe(): THREE.BufferGeometry {
  const positions = [
    // 0-2 near prober: a sliver in the plane x = 0.1, looking along +x.
    0.1, 0.5, 0.45, 0.1, 0.502, 0.45, 0.1, 0.5, 0.452,
    // 3-5 far prober: a sliver in the plane x = 0, looking along +x.
    0, 0.05, 0.05, 0, 0.052, 0.05, 0, 0.05, 0.052,
    0.4, 0.3, 0.3, 0.4, 0.7, 0.3, 0.4, 0.5, 0.8, // 6-8 near wall, plane x = 0.4
    0.9, 0.4, 0.4, 0.9, 0.6, 0.4, 0.05, 0.5, 0.9, // 9-11 far wall, slanted
    0.95, 0, 0, 0.95, 1, 0, 0.95, 0, 1, // 12-14 back wall, plane x = 0.95
  ];
  // Probers look along -x so their inward ray runs +x. Every wall vertex looks
  // along +y, so its own ray leaves through the floor without hitting anything
  // and cannot disturb the normalisation. The probers are slivers rather than
  // loose points because a vertex no face references casts no ray at all.
  const normals: number[] = [];
  for (let i = 0; i < 6; i++) normals.push(-1, 0, 0);
  for (let i = 0; i < 9; i++) normals.push(0, 1, 0);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  return geo;
}

/** Index of the near prober and the far prober in that fixture. */
const PROBE_NEAR = 0;
const PROBE_FAR = 3;

describe('computeThickness', () => {
  it('takes the nearest surface even when a farther one shares the origin cell', () => {
    const thickness = computeThickness(makeNearestHitProbe());

    // Normalised by the longest hit in the mesh, which is the far prober's 0.95.
    expect(thickness[PROBE_FAR]).toBeCloseTo(1, 5);
    expect(thickness[PROBE_NEAR]).toBeCloseTo(0.3 / 0.95, 4);
    // The slanted far wall at 0.715 is the wrong answer, not merely imprecise.
    expect(thickness[PROBE_NEAR]).toBeLessThan(0.5);
  });

  it('leaves thickness at zero when a ray finds no opposing surface', () => {
    // A single triangle: every ray escapes, so there is no body to measure.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    geo.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
    );
    geo.setIndex([0, 1, 2]);
    expect(Array.from(computeThickness(geo))).toEqual([0, 0, 0]);
  });

  it('skips the raycast entirely for meshes over the vertex budget', () => {
    const count = THICKNESS_VERTEX_BUDGET + 1;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = i % 7;
      positions[i * 3 + 1] = (i % 5) - 2;
      positions[i * 3 + 2] = (i % 3) - 1;
      normals[i * 3 + 2] = 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setIndex(Array.from({ length: count }, (_, i) => i));

    // Over budget the bake bails out rather than stalling the page, so every
    // vertex reads zero thickness and Beer-Lambert absorption switches off.
    const thickness = computeThickness(geo);
    expect(thickness).toHaveLength(count);
    expect(thickness.every((v) => v === 0)).toBe(true);
  });

  it('skips the raycast when triangle bounding boxes flood the grid', () => {
    // Well under the triangle budget, but every triangle spans the whole
    // bounding box, so each one files itself under every cell. Without the
    // reference cap the bucket table alone would be hundreds of megabytes.
    const tris = 6_000;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, -1, -1, 1, 1, -1, 1, -1, 1], 3),
    );
    geo.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
    );
    const index: number[] = [];
    for (let t = 0; t < tris; t++) index.push(0, 1, 2);
    geo.setIndex(index);

    // Zero output alone would not prove the cap fired, because these rays find
    // nothing anyway. Spending no work budget does: the bail happens while the
    // grid is still being counted, before a single ray is cast.
    const budget = createThicknessBudget();
    expect(Array.from(computeThickness(geo, budget))).toEqual([0, 0, 0]);
    expect(budget.remaining).toBe(THICKNESS_WORK_BUDGET);
  });

  it('abandons the bake when the shared work budget runs out', () => {
    const geo = makeNearestHitProbe();
    // The probe needs a handful of intersection tests; one is not enough.
    const spent = { remaining: 1 };
    expect(Array.from(computeThickness(geo, spent))).toEqual(new Array(15).fill(0));

    // One allowance covers the whole avatar, so a second mesh sharing an
    // exhausted budget gets nothing even though it is individually legal.
    const budget = createThicknessBudget();
    expect(computeThickness(makeNearestHitProbe(), budget)[PROBE_FAR]).toBeCloseTo(1, 5);
    expect(budget.remaining).toBeLessThan(THICKNESS_WORK_BUDGET);
    budget.remaining = 0;
    expect(Array.from(computeThickness(makeNearestHitProbe(), budget))).toEqual(
      new Array(15).fill(0),
    );
  });

  it('bakes non-indexed triangle soup by treating position triples as faces', () => {
    // A custom GLB may well arrive without an index buffer, and refusing it
    // would silently disable absorption on that avatar. Three source vertices
    // look along +z at a wall four cells downrange that strictly contains all
    // three projections, so every hit is interior: no grazing, no vertex-exact
    // intersection, and the same layout indexed or not.
    const positions = [
      0, 0, 0, 0.2, 0, 0, 0, 0.2, 0, // 0-2 source, looking along +z
      -1, -1, 1, 3, -1, 1, -1, 3, 1, // 3-5 wall at z = 1, looking along -z
    ];
    const normals = [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    indexed.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    indexed.setIndex([0, 1, 2, 3, 4, 5]);
    const soup = indexed.toNonIndexed();
    expect(soup.index).toBeNull();

    const withIndex = computeThickness(indexed);
    const withoutIndex = computeThickness(soup);

    // Every source ray travels exactly one unit, the longest hit in the mesh,
    // so the normalised thickness is 1. The wall's own rays escape.
    for (const result of [withIndex, withoutIndex]) {
      expect(Array.from(result.slice(0, 3)).map((v) => Math.round(v * 1000) / 1000)).toEqual([
        1, 1, 1,
      ]);
      expect(Array.from(result.slice(3))).toEqual([0, 0, 0]);
    }
  });
});

describe('bakeFeatureMasks and bakeThickness', () => {
  it('declares thickness empty and fills it only when explicitly baked', () => {
    const mesh = new THREE.Mesh(makeNearestHitProbe(), new THREE.MeshStandardMaterial());
    bakeFeatureMasks(mesh);

    const thickness = mesh.geometry.attributes.aThickness;
    expect(thickness).toBeDefined();
    expect(thickness?.itemSize).toBe(1);
    expect(thickness?.count).toBe(15);
    // Mask baking must not pay for the raycast: the attribute exists so the
    // shader compiles, but absorption is off until a glass mesh asks for it.
    expect(thickness?.getX(PROBE_FAR)).toBe(0);
    // The zone masks still resolve off the same interleaved buffer.
    expect(mesh.geometry.attributes.aSocket?.count).toBe(15);

    bakeThickness(mesh);
    expect(mesh.geometry.attributes.aThickness?.getX(PROBE_FAR)).toBeCloseTo(1, 5);
  });

  it('ignores a mesh that never had the mask attributes declared', () => {
    const mesh = new THREE.Mesh(makeNearestHitProbe(), new THREE.MeshStandardMaterial());
    expect(() => bakeThickness(mesh)).not.toThrow();
    expect(mesh.geometry.attributes.aThickness).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Silhouette hull (todo.liquid-glass-silhouette-hull)
// ---------------------------------------------------------------------------

/** A unit cube hull rigidly bound to one bone at the origin. */
function cubeHull(joint = 'head'): SilhouetteHull {
  const points: number[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) points.push(x, y, z);
  return {
    version: SILHOUETTE_HULL_VERSION,
    groups: [{ joint, inverseBind: new THREE.Matrix4().toArray(), points }],
    containedJoints: [],
  };
}

/** Minimal avatar exposing only what SilhouetteProjector reads. */
function hullAvatar(boneName: string): { avatar: LoadedAvatar; bone: THREE.Bone } {
  const root = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = boneName;
  root.add(bone);
  root.updateMatrixWorld(true);
  const avatar = {
    root,
    morphMeshes: [],
    bones: {},
    animations: [],
    setMorph: () => {},
    getMorph: () => 0,
    dispose: () => {},
  } satisfies LoadedAvatar;
  return { avatar, bone };
}

function orthoCamera(): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

function polygonArea(xy: Float32Array, count: number): number {
  let area = 0;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    area += (xy[i * 2] as number) * (xy[j * 2 + 1] as number) - (xy[j * 2] as number) * (xy[i * 2 + 1] as number);
  }
  return Math.abs(area) / 2;
}

describe('readSilhouetteHull', () => {
  it('reads a well-formed hull from scene userData', () => {
    const root = new THREE.Group();
    root.userData[SILHOUETTE_HULL_KEY] = cubeHull();
    const hull = readSilhouetteHull(root);
    expect(hull?.groups).toHaveLength(1);
    expect(hull?.groups[0]?.points).toHaveLength(24);
  });

  it('returns null for an absent, mis-versioned or malformed hull', () => {
    expect(readSilhouetteHull(new THREE.Group())).toBeNull();

    const wrongVersion = new THREE.Group();
    wrongVersion.userData[SILHOUETTE_HULL_KEY] = { ...cubeHull(), version: 99 };
    expect(readSilhouetteHull(wrongVersion)).toBeNull();

    const shortMatrix = new THREE.Group();
    const bad = cubeHull();
    shortMatrix.userData[SILHOUETTE_HULL_KEY] = {
      ...bad,
      groups: [{ ...bad.groups[0], inverseBind: [1, 0, 0] }],
    };
    expect(readSilhouetteHull(shortMatrix)).toBeNull();

    const raggedPoints = new THREE.Group();
    raggedPoints.userData[SILHOUETTE_HULL_KEY] = {
      ...bad,
      groups: [{ ...bad.groups[0], points: [0, 1] }],
    };
    expect(readSilhouetteHull(raggedPoints)).toBeNull();
  });

  it('is wired into buildLoadedAvatar', () => {
    const root = new THREE.Group();
    root.add(makeMorphMesh(ALL_CANONICAL));
    for (const key of Object.keys(RIG_BONES) as (keyof typeof RIG_BONES)[]) root.add(makeBone(key));
    expect(buildLoadedAvatar(root).silhouetteHull).toBeNull();

    root.userData[SILHOUETTE_HULL_KEY] = cubeHull();
    expect(buildLoadedAvatar(root).silhouetteHull?.groups).toHaveLength(1);
  });
});

describe('SilhouetteProjector', () => {
  it('projects an axis-aligned cube to its screen-space square', () => {
    const { avatar } = hullAvatar('head');
    const projector = new SilhouetteProjector(cubeHull(), avatar);
    expect(projector.usable).toBe(true);
    expect(projector.update(orthoCamera(), 400, 400)).toBe(true);
    // Ortho half-extent 2 over 400px: the cube's +/-1 corners land 100px from
    // the centre, so the outline is the 200px square centred in the viewport.
    expect(projector.count).toBe(4);
    const xs = [...projector.xy.slice(0, 8)].filter((_, i) => i % 2 === 0).sort((a, b) => a - b);
    const ys = [...projector.xy.slice(0, 8)].filter((_, i) => i % 2 === 1).sort((a, b) => a - b);
    expect(xs).toEqual([100, 100, 300, 300]);
    expect(ys).toEqual([100, 100, 300, 300]);
    expect(polygonArea(projector.xy, 4)).toBeCloseTo(40_000, 6);
  });

  it('follows the bone pose', () => {
    const { avatar, bone } = hullAvatar('head');
    const projector = new SilhouetteProjector(cubeHull(), avatar);
    const camera = orthoCamera();
    projector.update(camera, 400, 400);
    const square = polygonArea(projector.xy, projector.count);

    // A 45 degree yaw widens the cube's shadow by root two.
    bone.rotation.y = Math.PI / 4;
    avatar.root.updateMatrixWorld(true);
    expect(projector.update(camera, 400, 400)).toBe(true);
    expect(polygonArea(projector.xy, projector.count) / square).toBeCloseTo(Math.SQRT2, 3);

    // Translating the bone slides the outline without resizing it.
    bone.rotation.y = 0;
    bone.position.x = 0.5;
    avatar.root.updateMatrixWorld(true);
    projector.update(camera, 400, 400);
    expect(polygonArea(projector.xy, projector.count)).toBeCloseTo(square, 6);
    const minX = Math.min(...[...projector.xy.slice(0, projector.count * 2)].filter((_, i) => i % 2 === 0));
    expect(minX).toBeCloseTo(150, 6);
  });

  it('emits a CSS polygon, and none when there is no outline', () => {
    const { avatar } = hullAvatar('head');
    const projector = new SilhouetteProjector(cubeHull(), avatar);
    projector.update(orthoCamera(), 400, 400);
    expect(projector.polygon()).toBe('polygon(100px 100px, 300px 100px, 300px 300px, 100px 300px)');

    // Zero-sized viewport: nothing to clip, and the previous polygon must not
    // leak through as a stale outline.
    expect(projector.update(orthoCamera(), 0, 0)).toBe(false);
    expect(projector.count).toBe(0);
    expect(projector.polygon()).toBe('none');
  });

  it('degrades when the camera sits inside the hull', () => {
    const { avatar } = hullAvatar('head');
    const projector = new SilhouetteProjector(cubeHull(), avatar);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 0);
    camera.updateMatrixWorld(true);
    expect(projector.update(camera, 400, 400)).toBe(false);
    expect(projector.count).toBe(0);
  });

  it('is unusable when any group fails to resolve, never partially resolved', () => {
    const { avatar } = hullAvatar('head');
    expect(new SilhouetteProjector(cubeHull('absent_bone'), avatar).usable).toBe(false);

    // A half-resolved hull would emit an outline missing whatever the absent
    // group bounded, which is worse than no outline at all.
    const partial = cubeHull();
    const both: SilhouetteHull = {
      ...partial,
      groups: [...partial.groups, { ...partial.groups[0], joint: 'absent_bone' } as SilhouetteHullGroup],
    };
    const projector = new SilhouetteProjector(both, avatar);
    expect(projector.usable).toBe(false);
    expect(projector.update(orthoCamera(), 400, 400)).toBe(false);
  });

  it('will not accept a non-bone standing in for the joint', () => {
    const { avatar } = hullAvatar('head');
    const impostor = new THREE.Group();
    impostor.name = 'jaw';
    avatar.root.add(impostor);
    avatar.root.updateMatrixWorld(true);
    expect(new SilhouetteProjector(cubeHull('jaw'), avatar).usable).toBe(false);
  });

  it('resolves a joint through the loader-sanitised name', () => {
    const root = new THREE.Group();
    const bone = new THREE.Bone();
    // What GLTFLoader does to a glTF node named "head bone".
    bone.name = 'head_bone';
    bone.userData.name = 'head bone';
    root.add(bone);
    root.updateMatrixWorld(true);
    const avatar = {
      root,
      morphMeshes: [],
      bones: {},
      animations: [],
      setMorph: () => {},
      getMorph: () => 0,
      dispose: () => {},
    } satisfies LoadedAvatar;
    expect(new SilhouetteProjector(cubeHull('head bone'), avatar).usable).toBe(true);
  });

  it('allocates no buffers per update', () => {
    const { avatar, bone } = hullAvatar('head');
    const projector = new SilhouetteProjector(cubeHull(), avatar);
    const camera = orthoCamera();
    projector.update(camera, 400, 400);
    const buffer = projector.xy;
    for (let i = 0; i < 8; i++) {
      bone.rotation.y = i * 0.1;
      avatar.root.updateMatrixWorld(true);
      projector.update(camera, 400, 400);
      expect(projector.xy).toBe(buffer);
    }
  });
});
