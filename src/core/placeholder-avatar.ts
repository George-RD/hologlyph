/**
 * Assetless demo bust. Builds a simple sphere-ish head with `jaw_open` and
 * `exp_blink` morph targets so the engine runs without a loaded GLB
 * (dec.asset-rig-schema: VRM-like morph vocabulary). Real avatars come from the
 * asset loader; this exists only so the demo and headless tests work with no
 * network asset.
 */
import * as THREE from 'three';
import { clamp01 } from '../contracts.js';
import type { LoadedAvatar } from '../contracts.js';

const JAW_OPEN_INDEX = 0;
const BLINK_INDEX = 1;

function buildHeadMesh(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(0.5, 32, 32);
  const position = geometry.attributes.position as THREE.BufferAttribute;

  const jawDelta = new Float32Array(position.count * 3);
  const blinkDelta = new Float32Array(position.count * 3);

  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    const z = position.getZ(i);
    // Jaw drops the lower hemisphere downward and slightly forward.
    if (y < 0) {
      jawDelta[i * 3 + 1] = -0.16 * (1 + y);
      jawDelta[i * 3 + 2] = 0.04;
    }
    // Blink squashes the front of the head inward vertically.
    if (z > 0.3) {
      blinkDelta[i * 3 + 1] = -0.14 * z;
    }
  }

  geometry.morphAttributes.position = [
    new THREE.BufferAttribute(jawDelta, 3),
    new THREE.BufferAttribute(blinkDelta, 3),
  ];
  geometry.morphTargetsRelative = true;

  const material = new THREE.MeshStandardMaterial({
    color: 0x88ccff,
    roughness: 0.55,
    metalness: 0.0,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.morphTargetInfluences = [0, 0];
  mesh.morphTargetDictionary = { jaw_open: JAW_OPEN_INDEX, exp_blink: BLINK_INDEX };
  mesh.name = 'placeholder-head';
  return mesh;
}

export function createPlaceholderAvatar(): LoadedAvatar {
  const root = new THREE.Group();
  root.name = 'placeholder-avatar';

  const head = buildHeadMesh();
  root.add(head);

  const rootBone = new THREE.Bone();
  rootBone.name = 'root';
  const headBone = new THREE.Bone();
  headBone.name = 'head';
  rootBone.add(headBone);

  let disposed = false;

  return {
    root,
    morphMeshes: [head],
    bones: { root: rootBone, head: headBone },
    animations: [],
    setMorph(name, weight) {
      const w = clamp01(weight);
      for (const mesh of this.morphMeshes) {
        const dict = mesh.morphTargetDictionary;
        const index = dict ? dict[name] : undefined;
        if (index !== undefined && mesh.morphTargetInfluences) {
          mesh.morphTargetInfluences[index] = w;
        }
      }
    },
    getMorph(name) {
      for (const mesh of this.morphMeshes) {
        const dict = mesh.morphTargetDictionary;
        const index = dict ? dict[name] : undefined;
        if (index !== undefined && mesh.morphTargetInfluences) {
          return mesh.morphTargetInfluences[index] ?? 0;
        }
      }
      return 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) {
          for (const m of material) m.dispose();
        } else if (material) {
          material.dispose();
        }
      });
      root.removeFromParent();
    },
  };
}
