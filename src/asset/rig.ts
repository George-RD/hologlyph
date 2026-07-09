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

import * as THREE from 'three';
import {
  RIG_VISEME_MORPHS,
  RIG_EXPRESSION_MORPHS,
  RIG_BONES,
  clamp01,
  type LoadedAvatar,
} from '../contracts';

/** Canonical morph-target names every conformant rig must expose. */
const CANONICAL_MORPHS: readonly string[] = [
  ...RIG_VISEME_MORPHS,
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
    if (mesh.isMesh && isMorphMesh(mesh)) morphMeshes.push(mesh);
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
          if (texture && texture.isTexture) texture.dispose();
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
