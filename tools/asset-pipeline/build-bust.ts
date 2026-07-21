#!/usr/bin/env bun
/**
 * hologlyph asset pipeline: build the shipped head bust from ICT-FaceKit source.
 *
 * Build-time only. NEVER bundled into the runtime (dec.hologlyph-blueprint). This
 * is the MAIN morph-authoring pipeline (dec.head-asset-source makes glTF-Transform
 * primary and Blender fallback-only), implemented entirely in bun/Node so it runs
 * without Blender.
 *
 * What it does, from the pinned ICT-FaceKit sources (MIT, commit in
 * ict-source-manifest.json):
 *   1. Fetches + sha256-verifies the neutral head and the ARKit expression OBJs
 *      it needs (subset for the shipped rig, or all listed shapes in --full).
 *   2. Parses the OBJs, computes per-vertex deltas (expression minus neutral).
 *   3. Composites the 27 canonical rig morphs (15 visemes + 12 expressions) as
 *      weighted sums of ARKit deltas (RECIPE below; res.morph-authoring).
 *   4. Splits the mesh by material group so the eyeballs skin to eye_l/eye_r and
 *      the rest skins to head, giving a functional root/neck/head/eye skeleton.
 *   5. Projects a frontal planar UV island as TEXCOORD_0 for the text skin
 *      (surface realism is irrelevant per dec.head-asset-source).
 *   6. Normalises the bust to ~1 unit tall, centred, facing +Z (camera framing).
 *   7. Writes the shipped GLB (27 canonical targets) and, in --full, a
 *      full-fidelity intermediate retaining every fetched source delta.
 *
 * Usage:
 *   bun tools/asset-pipeline/build-bust.ts [out.glb]        # shipped 27-target bust
 *   bun tools/asset-pipeline/build-bust.ts --full [out.glb] # + retained intermediate
 *
 * The output still needs tools/asset-pipeline/optimize.ts (Meshopt + KTX2) to
 * reach the < 1.5 MB delivery budget; run that next.
 */

declare const Bun: {
  argv: string[];
  file(path: string | URL): {
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
    exists(): Promise<boolean>;
  };
  write(path: string | URL, data: Uint8Array | ArrayBuffer | string): Promise<number>;
};
declare const process: {
  argv: string[];
  exit(code?: number): never;
  cwd(): string;
};

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
 import { Document, type Primitive, WebIO } from '@gltf-transform/core';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, '.cache');
const MANIFEST_PATH = join(HERE, 'ict-source-manifest.json');
const REPO_ROOT = resolve(HERE, '..', '..');
const DEFAULT_OUT = join(REPO_ROOT, 'assets', 'hologlyph-bust.glb');
const INTERMEDIATE_OUT = join(HERE, '.build', 'hologlyph-bust.intermediate.glb');

// ---------------------------------------------------------------------------
// Canonical morph recipe (res.morph-authoring, specs/morph-authoring-detail.md).
// Each canonical target is a weighted sum of ICT ARKit-shape deltas. ICT uses
// `_L`/`_R` suffixes and single-file jaw/mouth shapes. viseme_sil and exp_relaxed
// are zero-delta (no clean donor: the neutral basis / absence of expression).
// ---------------------------------------------------------------------------
type Recipe = Record<string, Record<string, number>>;

export const VISEME_RECIPE: Recipe = {
  viseme_sil: {},
  viseme_aa: { jawOpen: 0.55, mouthStretch_L: 0.3, mouthStretch_R: 0.3 },
  viseme_ee: { jawOpen: 0.35, mouthStretch_L: 0.8, mouthStretch_R: 0.8 },
  viseme_ih: { mouthStretch_L: 1.0, mouthStretch_R: 1.0, jawOpen: 0.2 },
  viseme_oh: { mouthFunnel: 1.0, jawOpen: 0.4 },
  viseme_ou: { mouthPucker: 1.0, jawOpen: 0.4 },
  // mouthClose kept light: ICT's delta assumes jaw-open compensation, so a full
  // weight with a closed jaw folds the lips into a lump (seen in keyframe render).
  viseme_pp: { mouthPress_L: 1.0, mouthPress_R: 1.0, mouthClose: 0.25 },
  viseme_ff: {
    mouthFrown_L: 1.0,
    mouthFrown_R: 1.0,
    mouthLowerDown_L: 0.4,
    mouthLowerDown_R: 0.4,
  },
  viseme_th: { jawOpen: 0.4, mouthShrugLower: 0.6 },
  viseme_dd: { jawOpen: 0.35, mouthDimple_L: 0.5, mouthDimple_R: 0.5 },
  viseme_kk: { jawOpen: 0.35, mouthStretch_L: 0.4, mouthStretch_R: 0.4 },
  viseme_ch: { mouthFunnel: 0.7, mouthPucker: 0.7 },
  viseme_ss: { mouthSmile_L: 0.8, mouthSmile_R: 0.8, jawOpen: 0.15 },
  // Spec table 5.2 lists only mouthDimpleRight for nn; the left dimple is added
  // for a symmetric articulation (recorded deviation in implementation-notes).
  viseme_nn: { jawOpen: 0.3, mouthDimple_L: 0.5, mouthDimple_R: 0.5 },
  viseme_rr: { mouthPucker: 0.8, jawOpen: 0.3 },
};

const EXPRESSION_RECIPE: Recipe = {
  exp_happy: { mouthSmile_L: 1.0, mouthSmile_R: 1.0, cheekSquint_L: 0.6, cheekSquint_R: 0.6 },
  exp_sad: { mouthFrown_L: 1.0, mouthFrown_R: 1.0, browInnerUp_L: 0.7, browInnerUp_R: 0.7 },
  exp_surprised: {
    browInnerUp_L: 0.8,
    browInnerUp_R: 0.8,
    eyeWide_L: 1.0,
    eyeWide_R: 1.0,
    jawOpen: 0.5,
  },
  exp_angry: { browDown_L: 1.0, browDown_R: 1.0, mouthFrown_L: 0.7, mouthFrown_R: 0.7 },
  exp_relaxed: {},
  exp_blink: { eyeBlink_L: 1.0, eyeBlink_R: 1.0 },
  exp_blink_l: { eyeBlink_L: 1.0 },
  exp_blink_r: { eyeBlink_R: 1.0 },
  exp_brow_up: { browInnerUp_L: 1.0, browInnerUp_R: 1.0, browOuterUp_L: 1.0, browOuterUp_R: 1.0 },
  exp_brow_down: { browDown_L: 1.0, browDown_R: 1.0 },
  jaw_open: { jawOpen: 1.0 },
  mouth_round: { mouthFunnel: 0.6, mouthPucker: 0.6 },
};

const CANONICAL_ORDER = [...Object.keys(VISEME_RECIPE), ...Object.keys(EXPRESSION_RECIPE)];
const RECIPE: Recipe = { ...VISEME_RECIPE, ...EXPRESSION_RECIPE };

// Material groups whose faces skin to the left/right eye joints (functional gaze).
const LEFT_EYE_MATERIALS: Record<string, true> = { M_ScleraLeft: true, M_IrisLeft: true };
const RIGHT_EYE_MATERIALS: Record<string, true> = { M_ScleraRight: true, M_IrisRight: true };

// Auxiliary face groups DROPPED from the shipped bust.
// - M_EyeOcclusion: the shadow card ICT closes each eye opening with. It hugs
//   the eyeball across the palpebral aperture, so folded into the bust it
//   carries the text-skin material and paints glyphs over the eyes (raycast
//   through the aperture hits it before the sclera, dead centre included).
// - M_EyeLashes: four stacked lash cards overhanging the aperture; source
//   raycast shows they occlude the eyeball above/below centre. Under a text
//   skin they cannot read as lashes (no alpha texture) and render as
//   text-covered wisps.
// M_EyeBlend (lid-eyeball seam) and M_LacrimalFluid (inner-corner detail)
// stay: neither occludes the aperture and blend seals the seam visually.
const DROPPED_MATERIALS: Record<string, true> = { M_EyeOcclusion: true, M_EyeLashes: true };

// ---------------------------------------------------------------------------
// Manifest + fetching
// ---------------------------------------------------------------------------
interface Manifest {
  raw_base: string;
  commit: string;
  licence: string;
  files: Record<string, string>; // "name.obj" -> sha256
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Return cached bytes for `name.obj`, fetching + verifying against the manifest. */
async function getSource(name: string, manifest: Manifest): Promise<Uint8Array> {
  const file = `${name}.obj`;
  const expected = manifest.files[file];
  if (!expected) throw new Error(`${file} is not pinned in ict-source-manifest.json`);
  const path = join(CACHE, file);
  if (existsSync(path)) {
    const bytes = new Uint8Array(readFileSync(path));
    if (sha256(bytes) === expected) return bytes;
    console.warn(`[build-bust] cache sha mismatch for ${file}, refetching`);
  }
  const url = `${manifest.raw_base}/${file}`;
  console.log(`[build-bust] fetching ${file}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const got = sha256(bytes);
  if (got !== expected) {
    throw new Error(`${file} sha256 mismatch: expected ${expected}, got ${got}`);
  }
  await Bun.write(path, bytes);
  return bytes;
}

// ---------------------------------------------------------------------------
// OBJ parsing
// ---------------------------------------------------------------------------
interface ObjMesh {
  positions: Float32Array; // v: 3 per vertex
  uvs: Float32Array; // vt: 2 per uv
  /** Triangulated corners: [posIdx, uvIdx, material] repeated 3x per triangle. */
  triPos: Uint32Array;
  triUv: Uint32Array;
  triMat: Uint16Array;
  materials: string[];
}

function parseObj(text: string): ObjMesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const triPos: number[] = [];
  const triUv: number[] = [];
  const triMat: number[] = [];
  const materials: string[] = [];
  const matIndex = new Map<string, number>();
  let curMat = 0;

  const ensureMat = (name: string): number => {
    let idx = matIndex.get(name);
    if (idx === undefined) {
      idx = materials.length;
      materials.push(name);
      matIndex.set(name, idx);
    }
    return idx;
  };

  const lines = text.split('\n');
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.length === 0 || line.charCodeAt(0) === 35 /* # */) continue;
    const sp = line.indexOf(' ');
    const tag = sp === -1 ? line : line.slice(0, sp);
    const rest = sp === -1 ? '' : line.slice(sp + 1);
    if (tag === 'v') {
      const p = rest.split(/\s+/);
      positions.push(+p[0]!, +p[1]!, +p[2]!);
    } else if (tag === 'vt') {
      const p = rest.split(/\s+/);
      uvs.push(+p[0]!, +p[1]!);
    } else if (tag === 'usemtl') {
      curMat = ensureMat(rest.trim());
    } else if (tag === 'f') {
      const verts = rest.split(/\s+/).filter((s) => s.length > 0);
      // Parse each corner "v/vt/vn" (1-based; vt/vn optional).
      const cp: number[] = [];
      const cu: number[] = [];
      for (const v of verts) {
        const parts = v.split('/');
        cp.push(parseInt(parts[0]!, 10) - 1);
        cu.push(parts.length > 1 && parts[1] ? parseInt(parts[1]!, 10) - 1 : -1);
      }
      // Fan triangulation for polygons (ICT ships quads).
      for (let i = 1; i + 1 < cp.length; i++) {
        triPos.push(cp[0]!, cp[i]!, cp[i + 1]!);
        triUv.push(cu[0]!, cu[i]!, cu[i + 1]!);
        triMat.push(curMat, curMat, curMat);
      }
    }
  }
  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    triPos: new Uint32Array(triPos),
    triUv: new Uint32Array(triUv),
    triMat: new Uint16Array(triMat),
    materials,
  };
}

// ---------------------------------------------------------------------------
// Geometry assembly
// ---------------------------------------------------------------------------
interface BuiltGeometry {
  position: Float32Array; // 3 per glTF vertex
  normal: Float32Array; // 3 per glTF vertex (smooth, area-weighted)
  uv: Float32Array; // 2 per glTF vertex (frontal planar projection)
  joints: Uint8Array; // 4 per vertex
  weights: Float32Array; // 4 per vertex
  indices: Uint32Array;
  /** Original ICT position index per glTF vertex, for morph delta lookup. */
  srcPos: Uint32Array;
  targets: Record<string, Float32Array>; // canonical name -> 3 per vertex deltas
  targetNormals: Record<string, Float32Array>; // canonical name -> normal deltas
  headPivot: [number, number, number];
  leftEyePivot: [number, number, number];
  rightEyePivot: [number, number, number];
  /** Per-vertex partition: 0 = bust, 1 = sclera, 2 = iris, 3 = mouth, 4 = teeth. */
  eyeCat: Uint8Array;
}

const _JOINT_ROOT = 0;
const _JOINT_NECK = 1;
const JOINT_HEAD = 2;
const JOINT_EYE_L = 3;
const JOINT_EYE_R = 4;

 /**
  * Smooth, area-weighted vertex normals: face normals are cross products of
  * triangle edges, accumulated per vertex, then normalised. The caller passes
  * the triangle index list and vertex count so the same routine can run over a
  * partitioned sub-mesh (the eyes are split from the bust after assembly).
  */
 function computeSmoothNormals(
   position: Float32Array,
   indices: ArrayLike<number>,
   count: number,
 ): Float32Array {
   const out = new Float32Array(count * 3);
   for (let t = 0; t < indices.length; t += 3) {
     const a = indices[t]!,
       b = indices[t + 1]!,
       c = indices[t + 2]!;
     const ax = position[a * 3]!,
       ay = position[a * 3 + 1]!,
       az = position[a * 3 + 2]!;
     const e1x = position[b * 3]! - ax,
       e1y = position[b * 3 + 1]! - ay,
       e1z = position[b * 3 + 2]! - az;
     const e2x = position[c * 3]! - ax,
       e2y = position[c * 3 + 1]! - ay,
       e2z = position[c * 3 + 2]! - az;
     const nx = e1y * e2z - e1z * e2y;
     const ny = e1z * e2x - e1x * e2z;
     const nz = e1x * e2y - e1y * e2x;
     for (const v of [a, b, c]) {
       out[v * 3] = out[v * 3]! + nx;
       out[v * 3 + 1] = out[v * 3 + 1]! + ny;
       out[v * 3 + 2] = out[v * 3 + 2]! + nz;
     }
   }
   for (let v = 0; v < count; v++) {
     const nx = out[v * 3]!,
       ny = out[v * 3 + 1]!,
       nz = out[v * 3 + 2]!;
     const len = Math.hypot(nx, ny, nz) || 1;
     out[v * 3] = nx / len;
     out[v * 3 + 1] = ny / len;
     out[v * 3 + 2] = nz / len;
   }
   return out;
 }
function build(
  neutral: ObjMesh,
  deltas: Map<string, Float32Array>,
  fullTargets: string[] | null,
): BuiltGeometry {
  // De-index by unique (posIdx, uvIdx) so glTF has per-vertex UV while morph
  // deltas index by the original ICT position.
  const key = new Map<number, number>();
  const srcPos: number[] = [];
  const uvOut: number[] = [];
  const indices: number[] = [];
  const vertMat: number[] = [];

  const droppedMats = new Set<number>();
  neutral.materials.forEach((m, i) => {
    if (DROPPED_MATERIALS[m]) droppedMats.add(i);
  });

  const cornerCount = neutral.triPos.length;
  for (let c = 0; c < cornerCount; c += 3) {
    if (droppedMats.has(neutral.triMat[c]!)) continue;
    for (let cc = c; cc < c + 3; cc++) {
      const pi = neutral.triPos[cc]!;
      const ui = neutral.triUv[cc]!;
      const mat = neutral.triMat[cc]!;
      // Pack (pi, ui, mat) into one number key: 15+15+5 bits < 2^53. Material
      // is part of vertex identity because UV island and skin joint depend on
      // it, so boundary vertices shared across materials must be duplicated.
      const k = (pi * 32768 + (ui + 1)) * 32 + mat;
      let vid = key.get(k);
      if (vid === undefined) {
        vid = srcPos.length;
        key.set(k, vid);
        srcPos.push(pi);
        if (ui >= 0) {
          uvOut.push(neutral.uvs[ui * 2]!, neutral.uvs[ui * 2 + 1]!);
        } else {
          uvOut.push(0, 0);
        }
        vertMat.push(mat);
      }
      indices.push(vid);
    }
  }

  const vcount = srcPos.length;
  const position = new Float32Array(vcount * 3);
  for (let v = 0; v < vcount; v++) {
    const pi = srcPos[v]!;
    position[v * 3] = neutral.positions[pi * 3]!;
    position[v * 3 + 1] = neutral.positions[pi * 3 + 1]!;
    position[v * 3 + 2] = neutral.positions[pi * 3 + 2]!;
  }

  // --- Normalise: centre bbox, scale to ~1 unit tall, orient face toward +Z. ---
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let v = 0; v < vcount; v++) {
    const x = position[v * 3]!,
      y = position[v * 3 + 1]!,
      z = position[v * 3 + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const height = maxY - minY || 1;
  const scale = 1.0 / height;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;

  // Determine facing: compare mean Z of face-ish verts to the mesh centre. ICT
  // faces +Z already; flip about Y if the "face" material centroid is behind.
  const faceMat = neutral.materials.indexOf('M_Face');
  let faceZSum = 0,
    faceZN = 0;
  for (let v = 0; v < vcount; v++) {
    if (vertMat[v] === faceMat) {
      faceZSum += position[v * 3 + 2]!;
      faceZN++;
    }
  }
  const faceMeanZ = faceZN ? faceZSum / faceZN : cz + 1;
  const flip = faceMeanZ < cz ? -1 : 1;

  const applyXform = (x: number, y: number, z: number): [number, number, number] => [
    (x - cx) * scale * flip,
    (y - cy) * scale,
    (z - cz) * scale * flip,
  ];

  for (let v = 0; v < vcount; v++) {
    const [x, y, z] = applyXform(position[v * 3]!, position[v * 3 + 1]!, position[v * 3 + 2]!);
    position[v * 3] = x;
    position[v * 3 + 1] = y;
    position[v * 3 + 2] = z;
  }

  // --- UV atlas with a DEDICATED face island (design hard requirement). ---
  // The face material is planar-projected from the front into u [0, FACE_U_MAX];
  // the back of the head gets its own island in u [BACK_U_MIN, BACK_U_MAX]
  // (mirrored so text is not written backwards); interior/thin groups (teeth,
  // gums, lacrimal, eye occlusion/blend, lashes, eyeballs) are squeezed into a
  // narrow strip at the right edge where the scrolling text is irrelevant.
  // V is the scroll axis and spans the full range on the two visible islands.
  const FACE_U_MAX = 0.68;
  const BACK_U_MIN = 0.7;
  const BACK_U_MAX = 0.98;
  const MISC_U_MIN = 0.985;
  const faceMatIdx = neutral.materials.indexOf('M_Face');
  const backMatIdx = neutral.materials.indexOf('M_BackHead');

  interface UvBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  }
  const boundsFor = (pred: (mat: number) => boolean): UvBounds => {
    const b: UvBounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (let v = 0; v < vcount; v++) {
      if (!pred(vertMat[v]!)) continue;
      const x = position[v * 3]!,
        y = position[v * 3 + 1]!;
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
    }
    if (!Number.isFinite(b.minX)) {
      b.minX = 0;
      b.maxX = 1;
      b.minY = 0;
      b.maxY = 1;
    }
    return b;
  };
  const faceB = boundsFor((m) => m === faceMatIdx);
  const backB = boundsFor((m) => m === backMatIdx);
  const miscB = boundsFor((m) => m !== faceMatIdx && m !== backMatIdx);

  const uv = new Float32Array(vcount * 2);
  for (let v = 0; v < vcount; v++) {
    const mat = vertMat[v]!;
    const x = position[v * 3]!,
      y = position[v * 3 + 1]!;
    if (mat === faceMatIdx) {
      const u01 = (x - faceB.minX) / (faceB.maxX - faceB.minX || 1);
      uv[v * 2] = u01 * FACE_U_MAX;
      // CanvasTexture flipY places the canvas top at v=1, so v maps straight to
      // normalised height (face top -> v=1) for upright text.
      uv[v * 2 + 1] = (y - faceB.minY) / (faceB.maxY - faceB.minY || 1);
    } else if (mat === backMatIdx) {
      // Mirror x so text on the back island is not written backwards.
      const u01 = 1 - (x - backB.minX) / (backB.maxX - backB.minX || 1);
      uv[v * 2] = BACK_U_MIN + u01 * (BACK_U_MAX - BACK_U_MIN);
      uv[v * 2 + 1] = (y - backB.minY) / (backB.maxY - backB.minY || 1);
    } else {
      const u01 = (x - miscB.minX) / (miscB.maxX - miscB.minX || 1);
      uv[v * 2] = MISC_U_MIN + u01 * (1 - MISC_U_MIN);
      uv[v * 2 + 1] = (y - miscB.minY) / (miscB.maxY - miscB.minY || 1);
    }
  }

  // --- Skinning: eyeballs to eye joints, everything else to head. ---
  const leftMats = new Set<number>();
  const rightMats = new Set<number>();
  neutral.materials.forEach((m, i) => {
    if (LEFT_EYE_MATERIALS[m]) leftMats.add(i);
    if (RIGHT_EYE_MATERIALS[m]) rightMats.add(i);
  });
  const joints = new Uint8Array(vcount * 4);
  const weights = new Float32Array(vcount * 4);
  let lSumX = 0,
    lSumY = 0,
    lSumZ = 0,
    lN = 0;
  let rSumX = 0,
    rSumY = 0,
    rSumZ = 0,
    rN = 0;
  for (let v = 0; v < vcount; v++) {
    const mat = vertMat[v]!;
    let joint = JOINT_HEAD;
    if (leftMats.has(mat)) {
      joint = JOINT_EYE_L;
      lSumX += position[v * 3]!;
      lSumY += position[v * 3 + 1]!;
      lSumZ += position[v * 3 + 2]!;
      lN++;
    } else if (rightMats.has(mat)) {
      joint = JOINT_EYE_R;
      rSumX += position[v * 3]!;
      rSumY += position[v * 3 + 1]!;
      rSumZ += position[v * 3 + 2]!;
      rN++;
    }
    joints[v * 4] = joint;
    weights[v * 4] = 1;
  }
 
   // Per-vertex partition category drives the later glTF split. glTF keeps
   // morph-target counts per mesh, so the bust (which carries all 27 targets)
   // must hold every morph-bearing primitive: 0 = bust (face/head/neck),
   // 3 = mouth interior (gums + tongue), 4 = teeth. The eyes (1 = sclera,
   // 2 = iris) ship with no morph targets, so they form a separate mesh.
   // Each primitive groups both sides by material, keeping left + right verts.
   const eyeCat = new Uint8Array(vcount);
   const scleraMats = new Set<number>();
   const irisMats = new Set<number>();
   const mouthMats = new Set<number>();
   const teethMats = new Set<number>();
   neutral.materials.forEach((m, i) => {
     if (m === 'M_ScleraLeft' || m === 'M_ScleraRight') scleraMats.add(i);
     if (m === 'M_IrisLeft' || m === 'M_IrisRight') irisMats.add(i);
     if (m === 'M_GumsTongue') mouthMats.add(i);
     if (m === 'M_Teeth') teethMats.add(i);
   });
   for (let v = 0; v < vcount; v++) {
     const mat = vertMat[v]!;
     if (scleraMats.has(mat)) eyeCat[v] = 1;
     else if (irisMats.has(mat)) eyeCat[v] = 2;
     else if (mouthMats.has(mat)) eyeCat[v] = 3;
     else if (teethMats.has(mat)) eyeCat[v] = 4;
     else eyeCat[v] = 0;
   }

  // After normalisation y spans exactly [-0.5, 0.5]; the neck pivot sits 15%
  // above the base so head rotation reads as a nod, not a base wobble.
  const headPivot: [number, number, number] = [0, -0.35, 0];
  const leftEyePivot: [number, number, number] = lN
    ? [lSumX / lN, lSumY / lN, lSumZ / lN]
    : [0.12, 0.05, 0.3];
  const rightEyePivot: [number, number, number] = rN
    ? [rSumX / rN, rSumY / rN, rSumZ / rN]
    : [-0.12, 0.05, 0.3];

  // --- Morph target deltas (scaled + oriented like positions, no translation). ---
  const wanted = fullTargets ?? CANONICAL_ORDER;
  const targets: Record<string, Float32Array> = {};
  for (const name of wanted) {
    const out = new Float32Array(vcount * 3);
    const recipe = RECIPE[name] ?? (fullTargets ? { [name]: 1 } : {});
   for (const [shape, w] of Object.entries(recipe)) {
     const d = deltas.get(shape);
     if (!d) {
       if (Object.keys(recipe).length > 0) {
         throw new Error(`morph ${name} needs delta ${shape} which was not loaded`);
       }
       continue;
     }
     for (let v = 0; v < vcount; v++) {
       const pi = srcPos[v]!;
       out[v * 3] = out[v * 3]! + d[pi * 3]! * w * scale * flip;
       out[v * 3 + 1] = out[v * 3 + 1]! + d[pi * 3 + 1]! * w * scale;
       out[v * 3 + 2] = out[v * 3 + 2]! + d[pi * 3 + 2]! * w * scale * flip;
     }
   }
   targets[name] = out;
 }
 
 // Smooth, area-weighted vertex normals: face normals are cross products of
 // triangle edges, accumulated per vertex, then normalised. The displaced
 // meshes reuse the same routine over the full index list.
 const normal = computeSmoothNormals(position, indices, vcount);
 
 // Design check: confirm whether any shipped morph displaces eyeball verts.
 // Eyes ship with no morph targets (rigid, gaze via bone), so any eyeball
 // delta is intentionally dropped; this is logged, not an error. Categories 1
 // (sclera) and 2 (iris) are the eyeball verts; bust (0), mouth (3) and teeth
 // (4) are excluded so the check proves something about the eyes specifically.
 for (const name of wanted) {
   const d = targets[name]!;
   let maxEye = 0;
   for (let v = 0; v < vcount; v++) {
     if (eyeCat[v] !== 1 && eyeCat[v] !== 2) continue;
     for (let c = 0; c < 3; c++) {
       const a = Math.abs(d[v * 3 + c]!);
       if (a > maxEye) maxEye = a;
     }
   }
   if (maxEye > 1e-5) {
     console.log(`[build-bust] note: morph ${name} displaces eyeball verts (max ${maxEye.toFixed(4)})`);
   }
 }
 
 // Per-target normal deltas: recompute smooth normals on the displaced mesh and
 // store the difference from the base normals (glTF morph NORMAL semantics).
 const targetNormals: Record<string, Float32Array> = {};
 const displaced = new Float32Array(vcount * 3);
 for (const [name, delta] of Object.entries(targets)) {
   let moved = false;
   for (let i = 0; i < delta.length; i++) {
     displaced[i] = position[i]! + delta[i]!;
     if (delta[i] !== 0) moved = true;
   }
   if (!moved) {
     targetNormals[name] = new Float32Array(vcount * 3);
     continue;
   }
   const dn = computeSmoothNormals(displaced, indices, vcount);
   for (let i = 0; i < dn.length; i++) dn[i] = dn[i]! - normal[i]!;
   targetNormals[name] = dn;
 }


  return {
    position,
    normal,
    uv,
    joints,
    weights,
    indices: new Uint32Array(indices),
    srcPos: new Uint32Array(srcPos),
    targets,
    targetNormals,
    eyeCat,
    headPivot,
    leftEyePivot,
    rightEyePivot,
  };
}

// ---------------------------------------------------------------------------
// glTF assembly
// ---------------------------------------------------------------------------
 function toGltf(geo: BuiltGeometry, targetNames: string[]): Document {
   const doc = new Document();
   const buffer = doc.createBuffer();
 
   // Partition vertices by category. glTF keeps morph-target counts per mesh,
   // so every morph-bearing primitive (bust, mouth interior) lives in the
   // same 'bust' mesh. Mouth and teeth share one dark cavity material.
   // Vertices keep ascending source order, so the build stays deterministic.
   //   0 = bust (face/head/neck), 1 = sclera, 2 = iris,
   //   3/4 = mouth interior (gums, tongue, and teeth).
   const vcount = geo.eyeCat.length;
   const remapBust = new Int32Array(vcount).fill(-1);
   const remapSclera = new Int32Array(vcount).fill(-1);
   const remapIris = new Int32Array(vcount).fill(-1);
   const remapMouth = new Int32Array(vcount).fill(-1);
   const bustSrc: number[] = [];
   const scleraSrc: number[] = [];
   const irisSrc: number[] = [];
   const mouthSrc: number[] = [];
   for (let v = 0; v < vcount; v++) {
     const cat = geo.eyeCat[v]!;
     if (cat === 0) {
       remapBust[v] = bustSrc.length;
       bustSrc.push(v);
     } else if (cat === 1) {
       remapSclera[v] = scleraSrc.length;
       scleraSrc.push(v);
     } else if (cat === 2) {
       remapIris[v] = irisSrc.length;
       irisSrc.push(v);
     } else {
       remapMouth[v] = mouthSrc.length;
       mouthSrc.push(v);
     }
   }
 
   const extract = (
     src: number[],
     remap: Int32Array,
   ): {
     position: Float32Array;
     normal: Float32Array;
     uv: Float32Array;
     joints: Uint8Array;
     weights: Float32Array;
     indices: Uint32Array;
   } => {
     const n = src.length;
     const position = new Float32Array(n * 3);
     const uv = new Float32Array(n * 2);
     const joints = new Uint8Array(n * 4);
     const weights = new Float32Array(n * 4);
     for (let i = 0; i < n; i++) {
       const v = src[i]!;
       position[i * 3] = geo.position[v * 3]!;
       position[i * 3 + 1] = geo.position[v * 3 + 1]!;
       position[i * 3 + 2] = geo.position[v * 3 + 2]!;
       uv[i * 2] = geo.uv[v * 2]!;
       uv[i * 2 + 1] = geo.uv[v * 2 + 1]!;
       joints[i * 4] = geo.joints[v * 4]!;
       joints[i * 4 + 1] = geo.joints[v * 4 + 1]!;
       joints[i * 4 + 2] = geo.joints[v * 4 + 2]!;
       joints[i * 4 + 3] = geo.joints[v * 4 + 3]!;
       weights[i * 4] = geo.weights[v * 4]!;
       weights[i * 4 + 1] = geo.weights[v * 4 + 1]!;
       weights[i * 4 + 2] = geo.weights[v * 4 + 2]!;
       weights[i * 4 + 3] = geo.weights[v * 4 + 3]!;
     }
     const idx: number[] = [];
     for (let t = 0; t < geo.indices.length; t++) {
       const nv = remap[geo.indices[t]!]!;
       if (nv < 0) continue;
       idx.push(nv);
     }
     const indices = new Uint32Array(idx);
     const normal = computeSmoothNormals(position, indices, n);
     return { position, normal, uv, joints, weights, indices };
   };
 
   const bust = extract(bustSrc, remapBust);
   const mouth = extract(mouthSrc, remapMouth);
   const sclera = extract(scleraSrc, remapSclera);
   const iris = extract(irisSrc, remapIris);
 
   const makePrim = (
     part: { position: Float32Array; normal: Float32Array; uv: Float32Array; joints: Uint8Array; weights: Float32Array; indices: Uint32Array },
   ) => {
     const positionAcc = doc.createAccessor().setType('VEC3').setArray(part.position).setBuffer(buffer);
     const normalAcc = doc.createAccessor().setType('VEC3').setArray(part.normal).setBuffer(buffer);
     const uvAcc = doc.createAccessor().setType('VEC2').setArray(part.uv).setBuffer(buffer);
     const jointsAcc = doc.createAccessor().setType('VEC4').setArray(part.joints).setBuffer(buffer);
     const weightsAcc = doc.createAccessor().setType('VEC4').setArray(part.weights).setBuffer(buffer);
     const indexAcc = doc.createAccessor().setType('SCALAR').setArray(part.indices).setBuffer(buffer);
     return doc
       .createPrimitive()
       .setAttribute('POSITION', positionAcc)
       .setAttribute('NORMAL', normalAcc)
       .setAttribute('TEXCOORD_0', uvAcc)
       .setAttribute('JOINTS_0', jointsAcc)
       .setAttribute('WEIGHTS_0', weightsAcc)
       .setIndices(indexAcc);
   };
 
   // Add all 27 canonical morph targets to a primitive, remapped to its verts.
   const addMorphs = (prim: Primitive, src: number[]): void => {
     for (const name of targetNames) {
       const arr = geo.targets[name]!;
       const out = new Float32Array(src.length * 3);
       for (let i = 0; i < src.length; i++) {
         const v = src[i]!;
         out[i * 3] = arr[v * 3]!;
         out[i * 3 + 1] = arr[v * 3 + 1]!;
         out[i * 3 + 2] = arr[v * 3 + 2]!;
       }
       const target = doc.createPrimitiveTarget(name);
       const acc = doc.createAccessor().setType('VEC3').setArray(out).setBuffer(buffer);
       target.setAttribute('POSITION', acc);
       const nd = geo.targetNormals[name]!;
       const nOut = new Float32Array(src.length * 3);
       for (let i = 0; i < src.length; i++) {
         const v = src[i]!;
         nOut[i * 3] = nd[v * 3]!;
         nOut[i * 3 + 1] = nd[v * 3 + 1]!;
         nOut[i * 3 + 2] = nd[v * 3 + 2]!;
       }
       const nAcc = doc.createAccessor().setType('VEC3').setArray(nOut).setBuffer(buffer);
       target.setAttribute('NORMAL', nAcc);
       prim.addTarget(target);
     }
   };
 
   const bustPrim = makePrim(bust);
   addMorphs(bustPrim, bustSrc);
   const mouthPrim = makePrim(mouth);
   addMorphs(mouthPrim, mouthSrc);
   const material = doc
     .createMaterial('bust')
     .setBaseColorFactor([0.5, 0.55, 0.6, 1])
     .setRoughnessFactor(0.7);
   const mouthMaterial = doc
     .createMaterial('mouth_interior')
     .setBaseColorFactor([0.04, 0.03, 0.035, 1])
     .setRoughnessFactor(0.9);
   bustPrim.setMaterial(material);
   mouthPrim.setMaterial(mouthMaterial);
 
   const bustMesh = doc.createMesh('bust');
   bustMesh.addPrimitive(bustPrim);
   bustMesh.addPrimitive(mouthPrim);
   bustMesh.setExtras({ targetNames });
   bustMesh.setWeights(new Array(targetNames.length).fill(0));
 
   // Eyes mesh: two primitives (sclera, iris), no morph targets. It shares the
   // bust's skin, so gaze-bone rotation still moves the eyeballs; the eyeball
   // verts skin to eye_l / eye_r. glTF keeps morph counts per mesh, hence the
   // separate mesh (the bust's 27 targets would be incompatible with 0 targets).
   const scleraPrim = makePrim(sclera);
   const irisPrim = makePrim(iris);
   const scleraMat = doc
     .createMaterial('eye_sclera')
     .setBaseColorFactor([0.85, 0.87, 0.9, 1])
     .setRoughnessFactor(0.35)
     .setEmissiveFactor([0.06, 0.07, 0.08]);
   const irisMat = doc
     .createMaterial('eye_iris')
     .setBaseColorFactor([0.07, 0.08, 0.1, 1])
     .setRoughnessFactor(0.25);
   scleraPrim.setMaterial(scleraMat);
   irisPrim.setMaterial(irisMat);
   const eyesMesh = doc.createMesh('eyes');
   eyesMesh.addPrimitive(scleraPrim);
   eyesMesh.addPrimitive(irisPrim);
 
   // Skeleton: root -> neck -> head -> (eye_l, eye_r).
   const root = doc.createNode('root');
   const neck = doc.createNode('neck');
   const head = doc.createNode('head').setTranslation(geo.headPivot);
   const eyeL = doc
     .createNode('eye_l')
     .setTranslation([
       geo.leftEyePivot[0] - geo.headPivot[0],
       geo.leftEyePivot[1] - geo.headPivot[1],
       geo.leftEyePivot[2] - geo.headPivot[2],
     ]);
   const eyeR = doc
     .createNode('eye_r')
     .setTranslation([
       geo.rightEyePivot[0] - geo.headPivot[0],
       geo.rightEyePivot[1] - geo.headPivot[1],
       geo.rightEyePivot[2] - geo.headPivot[2],
     ]);
   root.addChild(neck);
   neck.addChild(head);
   head.addChild(eyeL);
   head.addChild(eyeR);
 
   // Inverse bind matrices (column-major mat4): inverse of each joint's world
   // translation, so the mesh is undeformed at bind and rotations pivot correctly.
   const ibm = (t: [number, number, number]): number[] => [
     1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -t[0], -t[1], -t[2], 1,
   ];
   const jointWorld: Array<[number, number, number]> = [
     [0, 0, 0], // root
     [0, 0, 0], // neck
     geo.headPivot, // head
     geo.leftEyePivot, // eye_l
     geo.rightEyePivot, // eye_r
   ];
   const ibmData = new Float32Array(jointWorld.flatMap((t) => ibm(t)));
   const ibmAcc = doc.createAccessor('ibm').setType('MAT4').setArray(ibmData).setBuffer(buffer);
 
   const skin = doc.createSkin('rig');
   for (const j of [root, neck, head, eyeL, eyeR]) skin.addJoint(j);
   skin.setSkeleton(root);
   skin.setInverseBindMatrices(ibmAcc);
 
   const bustNode = doc.createNode('bust-mesh').setMesh(bustMesh).setSkin(skin);
   const eyesNode = doc.createNode('eyes').setMesh(eyesMesh).setSkin(skin);
 
   const scene = doc.createScene('bust');
   scene.addChild(root);
   scene.addChild(bustNode);
   scene.addChild(eyesNode);
   doc.getRoot().setDefaultScene(scene);
 
   return doc;
 }

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const argv = (typeof Bun !== 'undefined' ? Bun.argv : process.argv).slice(2);
  const full = argv.includes('--full');
  const outArg = argv.find((a) => !a.startsWith('--'));
  const out = outArg ? resolve(process.cwd(), outArg) : DEFAULT_OUT;

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  console.log(`[build-bust] ICT-FaceKit commit ${manifest.commit} (${manifest.licence})`);

  const neutralBytes = await getSource('generic_neutral_mesh', manifest);
  const neutral = parseObj(new TextDecoder().decode(neutralBytes));
  console.log(
    `[build-bust] neutral: ${neutral.positions.length / 3} verts, ${neutral.triPos.length / 3} tris, materials [${neutral.materials.join(', ')}]`,
  );

  // Which ICT shapes do we need? Recipe union for shipped; all manifest shapes for --full.
  const shipShapes = new Set<string>();
  for (const recipe of Object.values(RECIPE)) {
    for (const shape of Object.keys(recipe)) shipShapes.add(shape);
  }
  const allShapes = Object.keys(manifest.files)
    .filter((f) => f !== 'generic_neutral_mesh.obj')
    .map((f) => f.replace(/\.obj$/, ''));
  const shapesToLoad = full ? allShapes : [...shipShapes];

  const deltas = new Map<string, Float32Array>();
  for (const shape of shapesToLoad) {
    const bytes = await getSource(shape, manifest);
    const mesh = parseObj(new TextDecoder().decode(bytes));
    if (mesh.positions.length !== neutral.positions.length) {
      throw new Error(`${shape} vertex count differs from neutral`);
    }
    const d = new Float32Array(neutral.positions.length);
    for (let i = 0; i < d.length; i++) d[i] = mesh.positions[i]! - neutral.positions[i]!;
    deltas.set(shape, d);
  }
  console.log(`[build-bust] loaded ${deltas.size} ARKit deltas`);

  const io = new WebIO();

  // Shipped: 27 canonical targets.
  const shippedGeo = build(neutral, deltas, null);
  const shippedDoc = toGltf(shippedGeo, CANONICAL_ORDER);
  const shippedBytes = await io.writeBinary(shippedDoc);
  await Bun.write(out, shippedBytes);
  console.log(
    `[build-bust] wrote shipped bust ${out}: ${(shippedBytes.byteLength / 1024 / 1024).toFixed(2)} MB, ${CANONICAL_ORDER.length} targets`,
  );

  // Full-fidelity intermediate: retain every fetched source delta (design retention).
  if (full) {
    const interNames = allShapes;
    const interGeo = build(neutral, deltas, interNames);
    const interDoc = toGltf(interGeo, interNames);
    const interBytes = await io.writeBinary(interDoc);
    await Bun.write(INTERMEDIATE_OUT, interBytes);
    console.log(
      `[build-bust] wrote intermediate ${INTERMEDIATE_OUT}: ${(interBytes.byteLength / 1024 / 1024).toFixed(2)} MB, ${interNames.length} retained deltas`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[build-bust] failed: ${(err as Error).message}`);
    process.exit(1);
  });
}
