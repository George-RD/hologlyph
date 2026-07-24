/**
 * Shared rig schema validation and LoadedAvatar assembly for hologlyph.
 *
 * The schema (dec.asset-rig-schema) fixes one canonical naming vocabulary for
 * every shipped bust: a known set of viseme/expression morph targets and a small
 * set of skeleton bones. Consumers (motion, speech) drive blendshapes purely by
 * these canonical names, so a rig that is missing some of them still loads but
 * is flagged non-conformant.
 *
 * All logic here is pure and works on in-memory THREE objects, so it is fully
 * unit-testable without loading a GLB over the network.
 */

import { InterleavedBuffer, InterleavedBufferAttribute } from 'three';
import type * as THREE from 'three';
import {
  RIG_VISEME_MORPHS,
  RIG_TONGUE_MORPHS,
  RIG_EXPRESSION_MORPHS,
  RIG_BONES,
  clamp01,
  type LoadedAvatar,
} from '../contracts';

/** Canonical morph-target names every conformant rig must expose. */
const CANONICAL_MORPHS: readonly string[] = [
  ...RIG_VISEME_MORPHS,
  ...RIG_TONGUE_MORPHS,
  ...RIG_EXPRESSION_MORPHS,
];

/** Bone keys we resolve by their canonical object name. */
const BONE_KEYS = Object.keys(RIG_BONES) as (keyof typeof RIG_BONES)[];

/**
 * Result of validating a loaded scene against the shared rig schema.
 * `conformant` is true only when every canonical morph and bone is present.
 */
export interface RigReport {
  missingMorphs: string[];
  missingBones: string[];
  conformant: boolean;
}

/** Warn at most once per process about a non-conformant rig (dec.performance-budget). */
let warnedNonConformant = false;

function isMorphMesh(mesh: THREE.Mesh): boolean {
  const dict = mesh.morphTargetDictionary;
  if (!dict) return false;
  for (const name of CANONICAL_MORPHS) {
    if (name in dict) return true;
  }
  return false;
}

function collectBones(
  root: THREE.Object3D,
): Partial<Record<keyof typeof RIG_BONES, THREE.Bone>> {
  const bones: Partial<Record<keyof typeof RIG_BONES, THREE.Bone>> = {};
  for (const key of BONE_KEYS) {
    const boneName = RIG_BONES[key];
    const found = root.getObjectByName(boneName);
    if (found && (found as THREE.Bone).isBone) {
      bones[key] = found as THREE.Bone;
    }
  }
  return bones;
}

/**
 * Validate a loaded scene graph against the canonical rig schema.
 * Never throws: returns a structured report describing what is missing.
 */
export function validateRig(root: THREE.Object3D): RigReport {
  const foundMorphs = new Set<string>();

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!isMorphMesh(mesh)) return;
    const dict = mesh.morphTargetDictionary;
    if (!dict) return;
    for (const name of Object.keys(dict)) {
      if (CANONICAL_MORPHS.includes(name)) foundMorphs.add(name);
    }
  });

  const missingBones: string[] = [];
  for (const key of BONE_KEYS) {
    const boneName = RIG_BONES[key];
    const found = root.getObjectByName(boneName);
    if (!found || !(found as THREE.Bone).isBone) {
      missingBones.push(boneName);
    }
  }

  const missingMorphs = CANONICAL_MORPHS.filter((n) => !foundMorphs.has(n));
  const conformant = missingMorphs.length === 0 && missingBones.length === 0;
  return { missingMorphs, missingBones, conformant };
}

/**
 * Assemble a LoadedAvatar from an already-parsed scene graph.
 *
 * - Collects the meshes that carry canonical morph targets.
 * - Resolves canonical bones by name.
 * - Warns once (console.warn) on a non-conformant rig but still returns a usable avatar.
 * - `setMorph`/`getMorph` operate across every morph mesh, clamped to [0,1].
 * - `dispose()` is idempotent and frees geometries, materials, and textures.
 */
const FEATURE_GROUPS = {
  lips: ['viseme_pp', 'viseme_ff', 'viseme_ou', 'mouth_round', 'viseme_ss'],
  jaw: ['jaw_open', 'viseme_aa'],
  eyelid: ['exp_blink', 'exp_blink_l', 'exp_blink_r'],
  brow: ['exp_brow_up', 'exp_brow_down'],
} as const;

const ZONE_ATTR = {
  lips: 'aLips',
  jaw: 'aJaw',
  eyelid: 'aEyelid',
  brow: 'aBrow',
} as const;

export function bakeFeatureMasks(mesh: THREE.Mesh): void {
  const geo = mesh.geometry;
  if (!geo) return;
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos) return;
  const N = pos.count;
  if (!N) return;

  const dict = mesh.morphTargetDictionary || {};
  const morphs = ((geo.morphAttributes as Record<string, unknown> | undefined)?.position as THREE.BufferAttribute[] | undefined) || [];
  const nor = geo.attributes.normal as THREE.BufferAttribute | undefined;

  const out = {
    aLips: new Float32Array(N),
    aJaw: new Float32Array(N),
    aEyelid: new Float32Array(N),
    aBrow: new Float32Array(N),
    aCavity: new Float32Array(N),
    aNose: new Float32Array(N),
    aSocket: new Float32Array(N),
  };

  for (const [g, list] of Object.entries(FEATURE_GROUPS)) {
    const attrName = ZONE_ATTR[g as keyof typeof ZONE_ATTR];
    const arr = out[attrName];
    const isRelative = Boolean(geo.morphTargetsRelative);
    let gmax = 0;
    for (const nm of list) {
      const idx = dict[nm];
      if (idx === undefined || !morphs[idx]) continue;
      const m = morphs[idx];
      for (let i = 0; i < N; i++) {
        const dx = isRelative ? m.getX(i) : m.getX(i) - pos.getX(i);
        const dy = isRelative ? m.getY(i) : m.getY(i) - pos.getY(i);
        const dz = isRelative ? m.getZ(i) : m.getZ(i) - pos.getZ(i);
        const mag = Math.hypot(dx, dy, dz);
        const current = arr[i] ?? 0;
        if (mag > current) arr[i] = mag;
        const stored = arr[i] ?? 0;
        if (stored > gmax) gmax = stored;
      }
    }
    if (gmax > 0) {
      for (let i = 0; i < N; i++) arr[i] = Math.min(1, (arr[i] ?? 0) / gmax);
    }
  }

  // Vermilion lip band refinement: tight ellipsoidal falloff around positive-weight centroid
  {
    const lips = out.aLips;
    let cx = 0, cy = 0, cz = 0, cw = 0, wmax = 0;
    for (let i = 0; i < N; i++) {
      const v = lips[i] ?? 0;
      if (v > wmax) wmax = v;
    }
    const cut = wmax * 0.8;
    if (cut > 0) {
      for (let i = 0; i < N; i++) {
        const w = lips[i] ?? 0;
        if (w < cut) continue;
        cx += pos.getX(i) * w;
        cy += pos.getY(i) * w;
        cz += pos.getZ(i) * w;
        cw += w;
      }
      if (cw > 0) {
        cx /= cw;
        cy /= cw;
        cz /= cw;
        const RX = 0.16, RY = 0.075, RZ = 0.12;
        for (let i = 0; i < N; i++) {
          const dx = (pos.getX(i) - cx) / RX;
          const dy = (pos.getY(i) - cy) / RY;
          const dz = (pos.getZ(i) - cz) / RZ;
          lips[i] = (lips[i] ?? 0) * Math.exp(-(dx * dx + dy * dy + dz * dz));
        }
      }
    }
  }

  // Geometric cavity
  const cav = out.aCavity;
  const idxAttr = geo.index;
  if (nor && idxAttr) {
    const acc = new Float64Array(N);
    const cnt = new Uint32Array(N);
    const ia = idxAttr.array;
    const add = (a: number, b: number) => {
      const dx = pos.getX(b) - pos.getX(a);
      const dy = pos.getY(b) - pos.getY(a);
      const dz = pos.getZ(b) - pos.getZ(a);
      const len = Math.hypot(dx, dy, dz) || 1;
      acc[a] = (acc[a] ?? 0) + (dx / len) * nor.getX(a) + (dy / len) * nor.getY(a) + (dz / len) * nor.getZ(a);
      cnt[a] = (cnt[a] ?? 0) + 1;
    };
    for (let t = 0; t < ia.length; t += 3) {
      const a = ia[t], b = ia[t + 1], c = ia[t + 2];
      if (a === undefined || b === undefined || c === undefined) continue;
      add(a, b); add(a, c); add(b, a); add(b, c); add(c, a); add(c, b);
    }
    let cmax = 0;
    for (let i = 0; i < N; i++) {
      const count = cnt[i] ?? 0;
      const v = count > 0 ? Math.max(0, (acc[i] ?? 0) / count) : 0;
      cav[i] = v;
      if (v > cmax) cmax = v;
    }
    if (cmax > 0) {
      for (let i = 0; i < N; i++) cav[i] = Math.min(1, ((cav[i] ?? 0) / cmax) * 1.3);
    }
  }

  // Nose zone heuristic
  const noseArr = out.aNose;
  let zmax = -1e9;
  for (let i = 0; i < N; i++) {
    const y = pos.getY(i);
    if (y > 0.02 && y < 0.34 && Math.abs(pos.getX(i)) < 0.17) {
      if (pos.getZ(i) > zmax) zmax = pos.getZ(i);
    }
  }
  if (zmax > -1e9) {
    for (let i = 0; i < N; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (y <= 0.0 || y >= 0.36 || Math.abs(x) >= 0.17) continue;
      const depth = Math.max(0, Math.min(1, (z - (zmax - 0.30)) / 0.30));
      const lateral = Math.max(0, 1 - Math.abs(x) / 0.17);
      const band = Math.min(1, Math.min((y - 0.0) / 0.06, (0.36 - y) / 0.06));
      noseArr[i] = depth * depth * lateral * band;
    }
  }

  // Socket zone
  const sockArr = out.aSocket;
  const lid = out.aEyelid;
  const c = { l: { x: 0, y: 0, z: 0, w: 0 }, r: { x: 0, y: 0, z: 0, w: 0 } };
  for (let i = 0; i < N; i++) {
    const w = lid[i] ?? 0;
    if (w < 0.3) continue;
    const s = pos.getX(i) < 0 ? c.l : c.r;
    s.x += pos.getX(i) * w;
    s.y += pos.getY(i) * w;
    s.z += pos.getZ(i) * w;
    s.w += w;
  }
  if (c.l.w > 0) { c.l.x /= c.l.w; c.l.y /= c.l.w; c.l.z /= c.l.w; }
  if (c.r.w > 0) { c.r.x /= c.r.w; c.r.y /= c.r.w; c.r.z /= c.r.w; }
  const R = 0.16;
  if (c.l.w > 0 && c.r.w > 0) {
    for (let i = 0; i < N; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const s = x < 0 ? c.l : c.r;
      const d2 = (x - s.x) ** 2 + (y - s.y) ** 2 + (z - s.z) ** 2;
      sockArr[i] = Math.exp(-d2 / (R * R));
    }
  }

  const primary = new InterleavedBuffer(new Float32Array(N * 4), 4);
  const secondary = new InterleavedBuffer(new Float32Array(N * 3), 3);
  const packed = [
    ['aLips', primary, 0, out.aLips],
    ['aJaw', primary, 1, out.aJaw],
    ['aEyelid', primary, 2, out.aEyelid],
    ['aBrow', primary, 3, out.aBrow],
    ['aCavity', secondary, 0, out.aCavity],
    ['aNose', secondary, 1, out.aNose],
    ['aSocket', secondary, 2, out.aSocket],
  ] as const;
  for (const [name, buffer, offset, values] of packed) {
    for (let index = 0; index < N; index++) {
      buffer.array[index * buffer.stride + offset] = values[index] ?? 0;
    }
    geo.setAttribute(name, new InterleavedBufferAttribute(buffer, 1, offset));
  }
}
export function buildLoadedAvatar(
  root: THREE.Object3D,
  animations: THREE.AnimationClip[] = [],
): LoadedAvatar {
  const report = validateRig(root);
  if (!report.conformant && !warnedNonConformant) {
    warnedNonConformant = true;
    console.warn(
      `[hologlyph] Non-conformant rig loaded: missing morphs [${report.missingMorphs.join(', ')}], ` +
        `missing bones [${report.missingBones.join(', ')}]. The avatar still renders, ` +
        `but some expressions or visemes may be unavailable.`,
    );
  }

  const morphMeshes: THREE.Mesh[] = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      if (isMorphMesh(mesh)) morphMeshes.push(mesh);
      bakeFeatureMasks(mesh);
    }
  });

  const bones = collectBones(root);

  let disposed = false;

  const setMorph = (name: string, weight: number): void => {
    const w = clamp01(weight);
    for (const mesh of morphMeshes) {
      const dict = mesh.morphTargetDictionary;
      const infl = mesh.morphTargetInfluences;
      if (!dict || !infl) continue;
      const idx = dict[name];
      if (idx === undefined) continue;
      infl[idx] = w;
    }
  };

  const getMorph = (name: string): number => {
    for (const mesh of morphMeshes) {
      const dict = mesh.morphTargetDictionary;
      const infl = mesh.morphTargetInfluences;
      if (!dict || !infl) continue;
      const idx = dict[name];
      if (idx === undefined) continue;
      return infl[idx] ?? 0;
    }
    return 0;
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        for (const value of Object.values(material)) {
          const texture = value as THREE.Texture;
          if (texture?.isTexture) texture.dispose();
        }
        material.dispose();
      }
    });
  };

  return {
    root: root as THREE.Group,
    morphMeshes,
    bones,
    animations,
    setMorph,
    getMorph,
    dispose,
  };
}
