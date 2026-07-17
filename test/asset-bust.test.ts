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
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {
  RIG_VISEME_MORPHS,
  RIG_EXPRESSION_MORPHS,
  RIG_BONES,
} from '../src/contracts';
import { validateRig, buildLoadedAvatar } from '../src/asset/rig';

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
        let maxAbs = 0;
        const arr = attr.array;
        for (let i = 0; i < arr.length; i++) {
          const a = Math.abs(arr[i] as number);
          if (a > maxAbs) maxAbs = a;
        }
        if (zeroByDesign[name]) {
          expect(maxAbs, `${name} must stay zero-delta`).toBe(0);
        } else {
          expect(maxAbs, `${name} must move vertices`).toBeGreaterThan(1e-4);
        }
      }
    });
    expect(checkedMeshes).toBeGreaterThan(0);
  });

  it('carries the canonical skeleton bones as THREE.Bone nodes', async () => {
    const scene = await loadBust();
    for (const boneName of Object.values(RIG_BONES)) {
      const found = scene.getObjectByName(boneName);
      expect(found, `bone ${boneName}`).toBeDefined();
      expect((found as THREE.Bone).isBone).toBe(true);
    }
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
});

/**
 * Regenerate-from-source guard (res.morph-authoring / design retention): proves
 * the shipped GLB's canonical rig is reproducible from the pinned ICT sources.
 * Skipped in CI where the (gitignored) source cache is absent; run locally after
 * `bun tools/asset-pipeline/build-bust.ts` has populated tools/asset-pipeline/.cache.
 */
const CACHE_NEUTRAL = resolve(CWD, 'tools/asset-pipeline/.cache/generic_neutral_mesh.obj');
describe.skipIf(!existsSync(CACHE_NEUTRAL))('bust regenerates from pinned source', () => {
  it('rebuilds the identical 27-target conformant rig', async () => {
    const tmp = join(mkdtempSync(join(tmpdir(), 'holo-regen-')), 'bust.glb');
    const run = spawnSync('bun', ['tools/asset-pipeline/build-bust.ts', tmp], {
      cwd: CWD,
      encoding: 'utf8',
    });
    expect(run.status, run.stderr).toBe(0);

    const bytes = readFileSync(tmp);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    await MeshoptDecoder.ready;
    const scene = await new Promise<THREE.Group>((res, rej) => {
      loader.parse(ab as ArrayBuffer, '', (g) => res(g.scene), rej);
    });
    const report = validateRig(scene);
    expect(report.conformant).toBe(true);
    expect(report.missingMorphs).toEqual([]);
  });
});
