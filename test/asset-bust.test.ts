/**
 * Acceptance oracle for the shipped head bust (v2-embodiment).
 *
 * These tests load the ACTUAL shipped GLB with three's GLTFLoader and run the
 * real validateRig from src/asset/rig.ts, so they prove runtime reachability of
 * the canonical rig rather than re-implementing a structural check. The bust is
 * built by tools/asset-pipeline/build-bust.ts from pinned ICT-FaceKit sources.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import type * as THREE from 'three';
import { Raycaster, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {
  RIG_VISEME_MORPHS,
  RIG_EXPRESSION_MORPHS,
  RIG_BONES,
} from '../src/contracts';
import { validateRig, buildLoadedAvatar } from '../src/asset/rig';
 import { VISEME_RECIPE } from '../tools/asset-pipeline/build-bust';
 import { WebIO } from '@gltf-transform/core';
 import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';

// vite/client's ambient `process` omits Node's cwd(); its real type is unexpressible here.
const nodeProcess = process as unknown as { cwd(): string };
const CWD = nodeProcess.cwd();
const BUST_PATH = resolve(CWD, 'assets/hologlyph-bust.glb');
/** dec.performance-budget: shipped GLB delivery target. */
const DELIVERY_BUDGET_BYTES = 1.5 * 1024 * 1024;
const CANONICAL: readonly string[] = [...RIG_VISEME_MORPHS, ...RIG_EXPRESSION_MORPHS];

async function loadBust(): Promise<THREE.Group> {
  const bytes = readFileSync(BUST_PATH);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  await MeshoptDecoder.ready;
  return await new Promise<THREE.Group>((resolve, reject) => {
    loader.parse(ab as ArrayBuffer, '', (gltf) => resolve(gltf.scene), reject);
  });
}

describe('shipped head bust', () => {
  it('exists and is within the delivery budget', () => {
    expect(existsSync(BUST_PATH)).toBe(true);
    const size = statSync(BUST_PATH).size;
    expect(size).toBeLessThanOrEqual(DELIVERY_BUDGET_BYTES);
  });

  it('validateRig reports a fully conformant rig (27 morphs + 5 bones)', async () => {
    const scene = await loadBust();
    const report = validateRig(scene);
    expect(report.missingMorphs).toEqual([]);
    expect(report.missingBones).toEqual([]);
    expect(report.conformant).toBe(true);
  });

  it('exposes every canonical morph as a drivable influence', async () => {
    const scene = await loadBust();
    const avatar = buildLoadedAvatar(scene);
    expect(avatar.morphMeshes.length).toBeGreaterThan(0);
    for (const name of CANONICAL) {
      avatar.setMorph(name, 1);
      expect(avatar.getMorph(name)).toBeCloseTo(1, 5);
      avatar.setMorph(name, 0);
    }
  });

  // Guards against a recipe entry silently producing zero motion: every canonical
  // target must carry real vertex deltas, except the two that are zero BY DESIGN
  // (viseme_sil is the basis pose, exp_relaxed is the absence of expression).
   it('every composited morph target has non-zero position deltas', async () => {
     const scene = await loadBust();
     const zeroByDesign: Record<string, true> = { viseme_sil: true, exp_relaxed: true };
     // Aggregate the largest vertex displacement per morph across every
     // morph-bearing primitive (bust, mouth interior, teeth). A morph is
     // drivable as long as it moves vertices somewhere; the mouth/teeth
     // primitives legitimately carry near-zero deltas for many visemes, so we
     // do not require every primitive to move for every morph.
     const maxAbsByMorph: Record<string, number> = {};
     let checkedMeshes = 0;
     scene.traverse((obj) => {
       const mesh = obj as THREE.Mesh;
       if (!mesh.isMesh || !mesh.morphTargetDictionary) return;
       checkedMeshes++;
       const attrs = mesh.geometry.morphAttributes.position ?? [];
       for (const [name, idx] of Object.entries(mesh.morphTargetDictionary)) {
         if (!CANONICAL.includes(name)) continue;
         const attr = attrs[idx];
         expect(attr, `morph attribute ${name}`).toBeDefined();
         if (!attr) continue;
         let maxAbs = maxAbsByMorph[name] ?? 0;
         const arr = attr.array;
         for (let i = 0; i < arr.length; i++) {
           const a = Math.abs(arr[i] as number);
           if (a > maxAbs) maxAbs = a;
         }
         maxAbsByMorph[name] = maxAbs;
       }
     });
     expect(checkedMeshes).toBeGreaterThan(0);
     for (const name of CANONICAL) {
       const maxAbs = maxAbsByMorph[name] ?? 0;
       if (zeroByDesign[name]) {
         expect(maxAbs, `${name} must stay zero-delta`).toBe(0);
       } else {
         expect(maxAbs, `${name} must move vertices`).toBeGreaterThan(1e-4);
       }
     }
   });

  it('carries the canonical skeleton bones as THREE.Bone nodes', async () => {
    const scene = await loadBust();
    for (const boneName of Object.values(RIG_BONES)) {
      const found = scene.getObjectByName(boneName);
      expect(found, `bone ${boneName}`).toBeDefined();
      expect((found as THREE.Bone).isBone).toBe(true);
    }
  });
 
   it('restrains the authored jaw opening for natural visemes', () => {
     expect(VISEME_RECIPE.viseme_aa?.jawOpen).toBe(0.55);
     expect(VISEME_RECIPE.viseme_ee?.jawOpen).toBe(0.35);
     expect(VISEME_RECIPE.viseme_oh?.jawOpen).toBe(0.4);
     expect(VISEME_RECIPE.viseme_th?.jawOpen).toBe(0.4);
     expect(VISEME_RECIPE.viseme_dd?.jawOpen).toBe(0.35);
     expect(VISEME_RECIPE.viseme_kk?.jawOpen).toBe(0.35);
   });

  // Regression (optimise pipeline defect): prune() once stripped NORMAL and
  // TEXCOORD_0 because the shipped material bound no map. The text-skin material
  // samples uv() and MeshStandardNodeMaterial needs normals, so both must survive.
  it('retains normal and uv vertex attributes after optimisation', async () => {
    const scene = await loadBust();
 
    let checked = 0;
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      checked++;
      expect(mesh.geometry.getAttribute('normal'), 'normal attribute').toBeDefined();
      expect(mesh.geometry.getAttribute('uv'), 'uv attribute').toBeDefined();
    });
    expect(checked).toBeGreaterThan(0);
  });
 
  it('splits skinned eyeballs into two non-morph eye primitives', async () => {
    const scene = await loadBust();
    const bustMeshes: THREE.Mesh[] = [];
    const eyeMeshes: THREE.Mesh[] = [];
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.morphTargetDictionary) bustMeshes.push(mesh);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.some((material) => material.name === 'eye_sclera' || material.name === 'eye_iris')) {
        eyeMeshes.push(mesh);
      }
    });

     // A dedicated 'eyes' node must exist. A multi-primitive glTF mesh loads as
     // a THREE.Group (one child mesh per primitive), so the structural mesh
     // shape is asserted separately via WebIO below.
     const eyesNode = scene.getObjectByName('eyes');
     expect(eyesNode, 'eyes node').toBeDefined();
 
     // The bust mesh now carries two morph-bearing primitives (bust, mouth
     // interior), each loaded as its own child mesh, so assert every such
     // mesh exposes the full canonical morph set rather than a fixed count.
     expect(bustMeshes.length).toBeGreaterThan(0);
     for (const m of bustMeshes) {
       expect(Object.keys(m.morphTargetDictionary ?? {})).toEqual(CANONICAL);
     }
    expect(eyeMeshes).toHaveLength(2);
    expect(eyeMeshes.every((mesh) => !mesh.morphTargetDictionary)).toBe(true);
    expect(new Set(eyeMeshes.map((mesh) => (mesh.material as THREE.Material).name))).toEqual(
      new Set(['eye_sclera', 'eye_iris']),
    );

     for (const mesh of eyeMeshes) {
       const joints = mesh.geometry.getAttribute('skinIndex');
       const weights = mesh.geometry.getAttribute('skinWeight');
       expect(joints, `${mesh.name} skin indices`).toBeDefined();
       expect(weights, `${mesh.name} skin weights`).toBeDefined();
       if (!joints || !weights) continue;
 
       // Each eye primitive groups both eyes by material (sclera or iris), so
       // its vertices bind to BOTH eye joints. Resolve the eye joint indices
       // from the loaded skeleton and require every vertex to weight fully to
       // either one.
       const bones = (mesh as THREE.SkinnedMesh).skeleton.bones;
       const eyeLIdx = bones.findIndex((b) => b.name === 'eye_l');
       const eyeRIdx = bones.findIndex((b) => b.name === 'eye_r');
       expect(eyeLIdx, `${mesh.name} eye_l joint`).toBeGreaterThanOrEqual(0);
       expect(eyeRIdx, `${mesh.name} eye_r joint`).toBeGreaterThanOrEqual(0);
       let sawL = false;
       let sawR = false;
       for (let i = 0; i < joints.count; i++) {
         let eyeJoint = false;
         for (let j = 0; j < 4; j++) {
           const ji = joints.getComponent(i, j);
           const w = weights.getComponent(i, j);
           if ((ji === eyeLIdx || ji === eyeRIdx) && w > 0.99) {
             eyeJoint = true;
             if (ji === eyeLIdx) sawL = true;
             if (ji === eyeRIdx) sawR = true;
           }
         }
         expect(eyeJoint, `${mesh.name} vertex ${i} eye skin`).toBe(true);
       }
       expect(sawL, `${mesh.name} uses eye_l`).toBe(true);
       expect(sawR, `${mesh.name} uses eye_r`).toBe(true);
     }
   });
 
   // Structural glTF check (WebIO) for the eyes mesh: glTF requires a separate
   // mesh because the bust carries morph targets and the eyes carry none. The
   // eyes mesh must be named 'eyes', expose exactly two primitives (sclera + iris)
   // with the eye_sclera / eye_iris materials, and carry zero morph targets.
   it('eyes mesh is a two-primitive, zero-target glTF mesh', async () => {
     await MeshoptDecoder.ready;
     const io = new WebIO()
       .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
       .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
     const bytes = readFileSync(BUST_PATH);
     const doc = await io.readBinary(new Uint8Array(bytes));
     const eyes = doc.getRoot().listMeshes().find((m) => m.getName() === 'eyes');
     expect(eyes, 'eyes mesh').toBeDefined();
     if (!eyes) return;
     const prims = eyes.listPrimitives();
     expect(prims, 'eye primitive count').toHaveLength(2);
     const matNames = new Set(prims.map((p) => p.getMaterial()?.getName()));
     expect(matNames).toEqual(new Set(['eye_sclera', 'eye_iris']));
     for (const p of prims) {
       expect(p.listTargets(), `${p.getMaterial()?.getName()} targets`).toHaveLength(0);
     }
     // The bust mesh must still carry all 27 canonical morph targets.
     const bust = doc.getRoot().listMeshes().find((m) => m.getName() === 'bust');
     expect(bust, 'bust mesh').toBeDefined();
     if (!bust) return;
     const bustTargets = bust.listPrimitives()[0]?.listTargets().map((t) => t.getName()) ?? [];
     expect(bustTargets.sort()).toEqual([...CANONICAL].sort());
    const bustPrims = bust.listPrimitives();
    expect(bustPrims, 'bust primitive count').toHaveLength(3);
    const bustMaterialNames = new Set(bustPrims.map((p) => p.getMaterial()?.getName()));
    expect(bustMaterialNames).toEqual(new Set(['bust', 'mouth_interior', 'eye_trim']));
     for (const primitive of bustPrims) {
       expect(primitive.listTargets(), `${primitive.getMaterial()?.getName()} morph targets`).toHaveLength(
         CANONICAL.length,
       );
       const targetNames = primitive.listTargets().map((target) => target.getName()).sort();
       expect(targetNames, `${primitive.getMaterial()?.getName()} morph target names`).toEqual(
         [...CANONICAL].sort(),
       );
     }
     const teethMaterial = doc.getRoot().listMaterials().find((material) => material.getName() === 'teeth');
     expect(teethMaterial, 'teeth material must be removed').toBeUndefined();
   });
  // Regression (eye occlusion membrane): ICT topology closes each eye opening
  // with an auxiliary shadow card (M_EyeOcclusion) hugging the eyeball across
  // the palpebral aperture. Folded into the bust it carries the text-skin
  // material and paints skin over the eyes. Oracle: a ray fired through the
  // aperture toward each eye centre must hit an eye primitive BEFORE any bust
  // geometry. Pure math (Raycaster), no WebGL; bind pose equals rest pose so
  // plain geometry raycasting is representative.
  it('no bust geometry occludes the eyeballs through the open aperture', async () => {
    const scene = await loadBust();
    scene.updateMatrixWorld(true);
    // Raycasting a SkinnedMesh reads skeleton.boneMatrices, which are only
    // populated by skeleton.update() (normally called during render).
    scene.traverse((obj) => {
      const skinned = obj as THREE.SkinnedMesh;
      if (skinned.isSkinnedMesh) skinned.skeleton.update();
    });
    const eyeNames = ['eye_l', 'eye_r'] as const;
    const raycaster = new Raycaster();
    for (const name of eyeNames) {
      const bone = scene.getObjectByName(name);
      expect(bone, `bone ${name}`).toBeDefined();
      if (!bone) continue;
      const centre = new Vector3();
      bone.getWorldPosition(centre);
      // Central ray plus four slight offsets covering the aperture cap.
      for (const [ox, oy] of [[0, 0], [0.01, 0], [-0.01, 0], [0, 0.008], [0, -0.008]]) {
        const origin = centre.clone().add(new Vector3(ox, oy, 0.5));
        raycaster.set(origin, new Vector3(0, 0, -1));
        const hits = raycaster.intersectObjects(scene.children, true);
        const first = hits.find((h) => (h.object as THREE.Mesh).isMesh);
        expect(first, `${name} ray (${ox},${oy}) hits something`).toBeDefined();
        if (!first) continue;
        const mesh = first.object as THREE.Mesh;
        const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        expect(
          mat?.name,
          `${name} ray (${ox},${oy}) first hit must be the eyeball, got ${mat?.name}`,
        ).toMatch(/^eye_(sclera|iris)$/);
      }
    }
  });
 });

/**
 * Regenerate-from-source guard (res.morph-authoring / design retention): the
 * full two-step pipeline (build-bust + optimize --simplify 0.5) is
 * byte-deterministic, so the strongest oracle holds: regenerating from the
 * pinned ICT sources must reproduce the committed GLB EXACTLY. Skipped in CI
 * where the (gitignored) source cache is absent.
 */
const CACHE_NEUTRAL = resolve(CWD, 'tools/asset-pipeline/.cache/generic_neutral_mesh.obj');
describe.skipIf(!existsSync(CACHE_NEUTRAL))('bust regenerates from pinned source', () => {
  // The two-step pipeline spawns two bun subprocesses; well over the 5 s
  // default under load, so give it an explicit budget.
  it('rebuilds the committed GLB byte-for-byte', { timeout: 120_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holo-regen-'));
    const raw = join(dir, 'bust.raw.glb');
    const opt = join(dir, 'bust.glb');
    const build = spawnSync('bun', ['tools/asset-pipeline/build-bust.ts', raw], {
      cwd: CWD,
      encoding: 'utf8',
    });
    expect(build.status, build.stderr).toBe(0);
    const optimize = spawnSync(
      'bun',
      ['tools/asset-pipeline/optimize.ts', raw, opt, '--simplify', '0.5'],
      { cwd: CWD, encoding: 'utf8' },
    );
    expect(optimize.status, optimize.stderr).toBe(0);

    const regenerated = readFileSync(opt);
    const shipped = readFileSync(BUST_PATH);
    expect(regenerated.length).toBe(shipped.length);
    expect(regenerated.equals(shipped)).toBe(true);
  });
});
