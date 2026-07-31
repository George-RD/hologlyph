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
import { PerspectiveCamera, Raycaster, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {
  RIG_VISEME_MORPHS,
  RIG_TONGUE_MORPHS,
  RIG_EXPRESSION_MORPHS,
  RIG_BONES,
} from '../src/contracts';
import { validateRig, buildLoadedAvatar, computeThickness } from '../src/asset/rig';
import { SilhouetteProjector } from '../src/asset/hull';
 import { VISEME_RECIPE } from '../tools/asset-pipeline/build-bust';
 import { MAX_HULL_POINTS } from '../tools/asset-pipeline/silhouette-hull';
 import { WebIO } from '@gltf-transform/core';
 import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';

// vite/client's ambient `process` omits Node's cwd(); its real type is unexpressible here.
const nodeProcess = process as unknown as { cwd(): string };
const CWD = nodeProcess.cwd();
const BUST_PATH = resolve(CWD, 'assets/hologlyph-bust.glb');
/** dec.performance-budget: shipped GLB delivery target. */
const DELIVERY_BUDGET_BYTES = 1.5 * 1024 * 1024;
const TONGUE_DATA_PATH = resolve(CWD, 'tools/asset-pipeline/tongue-morphs.json');
const TONGUE_POSES_PATH = resolve(CWD, 'tools/asset-pipeline/tongue-poses.json');
const CANONICAL: readonly string[] = [...RIG_VISEME_MORPHS, ...RIG_TONGUE_MORPHS, ...RIG_EXPRESSION_MORPHS];

// Read the 1.1 MB GLB and warm the meshopt decoder once. Every test below
// parses the same bytes, and doing the read plus `ready` await per test pushed
// this file past the 5 s default whenever the suite ran in parallel.
const BUST_BYTES = existsSync(BUST_PATH) ? readFileSync(BUST_PATH) : null;
const DECODER_READY = MeshoptDecoder.ready;

async function loadBust(): Promise<THREE.Group> {
  if (!BUST_BYTES) throw new Error(`bust asset missing at ${BUST_PATH}`);
  // Fresh ArrayBuffer and a fresh parse per call on purpose: callers mutate the
  // returned graph (morph influences, skeleton updates), so the scene must
  // never be shared between tests.
  const ab = BUST_BYTES.buffer.slice(
    BUST_BYTES.byteOffset,
    BUST_BYTES.byteOffset + BUST_BYTES.byteLength,
  );
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  await DECODER_READY;
  return await new Promise<THREE.Group>((resolve, reject) => {
    loader.parse(ab as ArrayBuffer, '', (gltf) => resolve(gltf.scene), reject);
  });
}

// Parsing a 30k-triangle, 30-morph meshopt GLB is inherently around a second,
// and this suite does it repeatedly alongside 19 other test files. The 5 s
// default is genuinely too tight, not a symptom worth hiding.
describe('shipped head bust', { timeout: 20_000 }, () => {
  it('exists and is within the delivery budget', () => {
    expect(existsSync(BUST_PATH)).toBe(true);
    const size = statSync(BUST_PATH).size;
    expect(size).toBeLessThanOrEqual(DELIVERY_BUDGET_BYTES);
  });

  it('validateRig reports a fully conformant rig (30 morphs + 5 bones)', async () => {
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
     // The bust mesh must still carry all 30 canonical morph targets.
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

  // Beer-Lambert absorption is only convincing if the baked thickness tracks
  // real anatomy, so assert the ordering the shader depends on rather than
  // exact distances, which move whenever the morph recipe changes.
  it('bakes body thickness that separates the cranium from the nose and chin', async () => {
    const scene = await loadBust();
    let skinMesh: THREE.Mesh | null = null;
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const name = Array.isArray(mesh.material) ? '' : mesh.material?.name;
      if (mesh.isMesh && name === 'bust') skinMesh = mesh;
    });
    expect(skinMesh, 'skin mesh with the "bust" material').not.toBeNull();
    const mesh = skinMesh as unknown as THREE.Mesh;

    const thickness = computeThickness(mesh.geometry);
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    expect(thickness).toHaveLength(pos.count);
    for (const value of thickness) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }

    const nearest = (x: number, y: number, z: number): number => {
      let best = 0;
      let bestDistance = Infinity;
      for (let i = 0; i < pos.count; i++) {
        const d =
          (pos.getX(i) - x) ** 2 + (pos.getY(i) - y) ** 2 + (pos.getZ(i) - z) ** 2;
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      }
      return thickness[best] ?? 0;
    };

    const noseTip = nearest(0, 0.18, 0.35);
    const chin = nearest(0, -0.1, 0.22);
    const forehead = nearest(0, 0.62, 0.22);
    const backSkull = nearest(0, 0.55, -0.3);

    // Every probe must have found a real opposing surface first, otherwise a
    // raycast that returned zero everywhere would satisfy the ratios below.
    for (const [label, value] of [
      ['nose tip', noseTip],
      ['chin', chin],
      ['forehead', forehead],
      ['back skull', backSkull],
    ] as const) {
      expect(value, `${label} thickness`).toBeGreaterThan(0);
    }

    // The cranium is the thickest part of the body by a wide margin; the two
    // protruding features are the thinnest. Anything less than a doubling
    // would not read as absorption on screen.
    expect(forehead).toBeGreaterThan(noseTip * 2);
    expect(forehead).toBeGreaterThan(chin * 2);
    expect(backSkull).toBeGreaterThan(noseTip * 2);
  });
  it('validates sparse tongue provenance and primitive locality', async () => {
    const data = JSON.parse(readFileSync(TONGUE_DATA_PATH, 'utf8')) as {
      source_sha256: string;
      blender_version: string;
      fixed_root_rule: string;
      vertex_count: number;
      tongue_vertex_mask: number[];
      targets: Record<string, {
        pose_sources: Array<{ file: string; weight: number }>;
        vertices: Array<{ index: number; delta: [number, number, number] }>;
      }>;
    };
    const poses = JSON.parse(readFileSync(TONGUE_POSES_PATH, 'utf8')) as Record<
      string,
      { sources: Array<{ file: string; weight: number }> }
    >;
    expect(data.source_sha256).toBe('eedbc2576d8e5ea57f55255b8f98263213a1efb5431d8bfceed1d7aef10271f9');
    expect(data.blender_version).toBe('4.2.10');
    expect(data.fixed_root_rule).toContain('y <= -5.0');
    expect(data.vertex_count).toBe(26719);
    expect(data.tongue_vertex_mask.length).toBeGreaterThan(100);
    const mask = new Set(data.tongue_vertex_mask);
    const vectors = RIG_TONGUE_MORPHS.map((name) => {
      const rows = data.targets[name]?.vertices ?? [];
      expect(data.targets[name]?.pose_sources).toEqual(poses[name]?.sources);
      expect(rows.length).toBeGreaterThan(20);
      for (let i = 1; i < rows.length; i++) {
        const current = rows[i];
        const previous = rows[i - 1];
        if (!current || !previous) throw new Error('Expected sorted tongue vertex rows');
        expect(current.index).toBeGreaterThan(previous.index);
      }
      for (const row of rows) expect(mask.has(row.index)).toBe(true);
      return rows.flatMap((row) => row.delta);
    });
    expect(vectors[0]).not.toEqual(vectors[1]);
    expect(vectors[1]).not.toEqual(vectors[2]);

    await MeshoptDecoder.ready;
    const io = new WebIO()
      .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const doc = await io.readBinary(new Uint8Array(readFileSync(BUST_PATH)));
    const bust = doc.getRoot().listMeshes().find((mesh) => mesh.getName() === 'bust');
    expect(bust).toBeDefined();
    if (!bust) return;
    for (const primitive of bust.listPrimitives()) {
      const material = primitive.getMaterial()?.getName();
      for (const name of RIG_TONGUE_MORPHS) {
        const target = primitive.listTargets().find((entry) => entry.getName() === name);
        expect(target).toBeDefined();
        const values = target?.getAttribute('POSITION')?.getArray() as Float32Array | undefined;
        let max = 0;
        if (values) for (const value of values) max = Math.max(max, Math.abs(value));
        if (material === 'mouth_interior') expect(max).toBeGreaterThan(1e-5);
        else expect(max).toBe(0);
      }
    }
  });
 });

/**
 * Acceptance for todo.liquid-glass-silhouette-hull: the baked hull must bound
 * the rendered silhouette at every pose the engine can drive, project in well
 * under 0.1 ms, and allocate nothing per frame.
 *
 * The oracle is the geometry itself. Every vertex is skinned and morphed on the
 * CPU exactly as three would, projected with the shipped camera, and required
 * to land inside the polygon the projector emits for that same pose.
 */
describe('shipped bust silhouette hull', { timeout: 60_000 }, () => {
  /**
   * Pose limits from `src/motion/index.ts`: head drag 0.5/0.35, plus follow
   * (0.18/0.12), plus an affirmative nod (0.22 pitch), plus idle drift, with
   * headroom on top. The neck takes 35% of drag and 20% of follow and is a
   * parent of the head, so it is posed too; the eye bones are posed to exercise
   * the joints the bake retired as contained.
   */
  interface Pose {
    yaw: number;
    pitch: number;
    roll: number;
    neckYaw: number;
    neckPitch: number;
    eyeYaw: number;
    eyePitch: number;
    rootY: number;
  }
  const pose = (p: Partial<Pose>): Pose => ({
    yaw: 0, pitch: 0, roll: 0, neckYaw: 0, neckPitch: 0, eyeYaw: 0, eyePitch: 0, rootY: 0, ...p,
  });
  const POSES: readonly Pose[] = [
    pose({}),
    pose({ yaw: 0.7 }),
    pose({ yaw: -0.7 }),
    pose({ pitch: 0.55 }),
    pose({ pitch: -0.7 }),
    // Drag, follow and a nod all at once, with the neck taking its share.
    pose({ yaw: 0.7, pitch: 0.55, roll: 0.12, neckYaw: 0.25, neckPitch: 0.2 }),
    pose({ yaw: -0.7, pitch: -0.7, roll: -0.12, neckYaw: -0.25, neckPitch: -0.2 }),
    // Eyes at their follow extremes inside a turned head.
    pose({ yaw: 0.4, pitch: -0.3, eyeYaw: 0.5, eyePitch: 0.4 }),
    pose({ yaw: -0.4, eyeYaw: -0.5, eyePitch: -0.4 }),
    // Mid-emergence: the root group slides down through the waterline.
    pose({ yaw: 0.3, pitch: 0.2, rootY: -0.9 }),
  ];

  /**
   * Morph states at the edge of what MotionEngine composes: the loudest single
   * shape, a two-viseme cross-fade with both tongue channels, and every
   * non-mouth group saturated (all three blink morphs, as `setBlinkHold` does).
   */
  const MORPH_STATES: readonly Record<string, number>[] = [
    {},
    { jaw_open: 1 },
    { viseme_ou: 1, viseme_oh: 1, tongue_out: 1, tongue_back: 1 },
    {
      exp_surprised: 1, exp_happy: 1, exp_brow_up: 1, mouth_round: 1, jaw_open: 1,
      exp_blink: 1, exp_blink_l: 1, exp_blink_r: 1,
    },
  ];

  function shippedCamera(): THREE.PerspectiveCamera {
    // Mirrors RendererHost: fov 35, square viewport, pulled back to 2.4.
    const camera = new PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0.05, 2.4);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    return camera;
  }

  /** Signed distance outside a convex polygon; negative means inside. */
  function outsideDistance(xy: Float32Array, count: number, px: number, py: number): number {
    let twiceArea = 0;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      twiceArea += (xy[i * 2] as number) * (xy[j * 2 + 1] as number) - (xy[j * 2] as number) * (xy[i * 2 + 1] as number);
    }
    const orientation = twiceArea >= 0 ? 1 : -1;
    let worst = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const ax = xy[i * 2] as number;
      const ay = xy[i * 2 + 1] as number;
      const ex = (xy[j * 2] as number) - ax;
      const ey = (xy[j * 2 + 1] as number) - ay;
      const length = Math.hypot(ex, ey);
      if (length === 0) continue;
      const inward = orientation * (ex * (py - ay) - ey * (px - ax));
      const distance = -inward / length;
      if (distance > worst) worst = distance;
    }
    return worst;
  }

  it('is baked into the shipped GLB within the point budget', async () => {
    const avatar = buildLoadedAvatar(await loadBust());
    const hull = avatar.silhouetteHull;
    expect(hull, 'shipped bust must carry a baked silhouette hull').toBeTruthy();
    if (!hull) return;
    expect(hull.version).toBe(1);
    const points = hull.groups.reduce((n, g) => n + g.points.length / 3, 0);
    expect(points).toBe(60);
    expect(points).toBeGreaterThanOrEqual(20);
    expect(points).toBeLessThanOrEqual(MAX_HULL_POINTS);
    // Every skinned vertex of the bust rides the head bone; the eyeballs rotate
    // inside it and the bake proves it rather than assuming it.
    expect(hull.groups.map((g) => g.joint)).toEqual(['head']);
    expect([...hull.containedJoints]).toEqual(['eye_l', 'eye_r']);
  });

  it('bounds every skinned, morphed vertex at every reachable pose', async () => {
    const scene = await loadBust();
    const avatar = buildLoadedAvatar(scene);
    const hull = avatar.silhouetteHull;
    expect(hull).toBeTruthy();
    if (!hull) return;
    const projector = new SilhouetteProjector(hull, avatar);
    expect(projector.usable).toBe(true);
    const camera = shippedCamera();
    const size = 512;

    const head = scene.getObjectByName('head');
    const neck = scene.getObjectByName('neck');
    const eyeL = scene.getObjectByName('eye_l');
    const eyeR = scene.getObjectByName('eye_r');
    expect(head && neck && eyeL && eyeR).toBeTruthy();
    if (!head || !neck || !eyeL || !eyeR) return;

    const skinned: THREE.SkinnedMesh[] = [];
    scene.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) skinned.push(mesh);
    });
    expect(skinned.length).toBeGreaterThan(0);

    const local = new Vector3();
    const world = new Vector3();
    let worstOutside = Number.NEGATIVE_INFINITY;

    for (const current of POSES) {
      head.rotation.set(current.pitch, current.yaw, current.roll);
      neck.rotation.set(current.neckPitch, current.neckYaw, 0);
      eyeL.rotation.set(current.eyePitch, current.eyeYaw, 0);
      eyeR.rotation.set(current.eyePitch, current.eyeYaw, 0);
      scene.position.y = current.rootY;
      for (const state of MORPH_STATES) {
        for (const [name, weight] of Object.entries(state)) avatar.setMorph(name, weight);
        scene.updateMatrixWorld(true);
        for (const mesh of skinned) mesh.skeleton.update();

        expect(projector.update(camera, size, size)).toBe(true);
        expect(projector.count).toBeGreaterThanOrEqual(3);

        for (const mesh of skinned) {
          const position = mesh.geometry.getAttribute('position');
          const morphs = mesh.geometry.morphAttributes.position ?? [];
          const influences = mesh.morphTargetInfluences ?? [];
          const active: { attribute: THREE.BufferAttribute; weight: number }[] = [];
          for (let m = 0; m < morphs.length; m++) {
            const weight = influences[m] ?? 0;
            if (weight === 0) continue;
            active.push({ attribute: morphs[m] as THREE.BufferAttribute, weight });
          }
          for (let i = 0; i < position.count; i++) {
            local.fromBufferAttribute(position, i);
            for (const { attribute, weight } of active) {
              local.x += attribute.getX(i) * weight;
              local.y += attribute.getY(i) * weight;
              local.z += attribute.getZ(i) * weight;
            }
            mesh.applyBoneTransform(i, local);
            world.copy(local).applyMatrix4(mesh.matrixWorld).project(camera);
            const px = (world.x * 0.5 + 0.5) * size;
            const py = (0.5 - world.y * 0.5) * size;
            const outside = outsideDistance(projector.xy, projector.count, px, py);
            if (outside > worstOutside) worstOutside = outside;
          }
        }
        for (const name of Object.keys(state)) avatar.setMorph(name, 0);
      }
    }
    // No tolerance: the bake pads every support plane past what six-decimal
    // rounding and float32 narrowing can cost, so a strictly outer bound is
    // exactly what this must measure.
    expect(worstOutside).toBeLessThanOrEqual(0);
  });

  // Negative control: the containment check above is only meaningful if a hull
  // that does NOT bound the mesh fails it. Shrinking the baked points 5% toward
  // the head pivot must leak.
  it('the containment check fails for a deliberately undersized hull', async () => {
    const scene = await loadBust();
    const avatar = buildLoadedAvatar(scene);
    const hull = avatar.silhouetteHull;
    if (!hull) throw new Error('no hull');
    const pivot = new Vector3(0, -0.35, 0);
    const shrunk = {
      ...hull,
      groups: hull.groups.map((group) => ({
        ...group,
        points: group.points.map((value, index) => {
          const centre = [pivot.x, pivot.y, pivot.z][index % 3] as number;
          return centre + (value - centre) * 0.95;
        }),
      })),
    };
    const projector = new SilhouetteProjector(shrunk, avatar);
    const camera = shippedCamera();
    scene.updateMatrixWorld(true);
    for (const obj of scene.children) obj.updateMatrixWorld(true);
    expect(projector.update(camera, 512, 512)).toBe(true);

    const local = new Vector3();
    const world = new Vector3();
    let worst = Number.NEGATIVE_INFINITY;
    scene.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      mesh.skeleton.update();
      const position = mesh.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) {
        local.fromBufferAttribute(position, i);
        mesh.applyBoneTransform(i, local);
        world.copy(local).applyMatrix4(mesh.matrixWorld).project(camera);
        const outside = outsideDistance(
          projector.xy,
          projector.count,
          (world.x * 0.5 + 0.5) * 512,
          (0.5 - world.y * 0.5) * 512,
        );
        if (outside > worst) worst = outside;
      }
    });
    expect(worst).toBeGreaterThan(1);
  });

  it('projects in well under 0.1 ms and allocates no buffers', async () => {
    const scene = await loadBust();
    const avatar = buildLoadedAvatar(scene);
    const hull = avatar.silhouetteHull;
    if (!hull) throw new Error('no hull');
    const projector = new SilhouetteProjector(hull, avatar);
    const camera = shippedCamera();
    const head = scene.getObjectByName('head');
    if (!head) throw new Error('no head bone');

    const buffer = projector.xy;
    for (let i = 0; i < 200; i++) {
      head.rotation.y = Math.sin(i * 0.05) * 0.5;
      scene.updateMatrixWorld(true);
      projector.update(camera, 512, 512);
    }
    expect(projector.xy).toBe(buffer);

    const iterations = 2000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) projector.update(camera, 512, 512);
    const perFrameMs = (performance.now() - start) / iterations;
    expect(perFrameMs).toBeLessThan(0.1);
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
