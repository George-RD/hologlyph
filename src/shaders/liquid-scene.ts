import { Group, type Mesh } from 'three';

export interface LiquidSceneState {
  readonly amount: number;
  readonly targetAmount: number;
  readonly position: readonly [number, number];
}

export interface LiquidSceneBinding {
  update(state: LiquidSceneState): void;
  dispose(): void;
}

/**
 * Placement belongs to the scene, not to a vertex-only offset. Carrying the
 * bones, meshes and overlays together keeps eye trim, culling and projected
 * bounds at the same place as the rendered head. Emergence still owns root Y.
 * This binding owns no geometry or materials.
 */
export function createLiquidScene(root: Group): LiquidSceneBinding {
  const carrier = new Group();
  carrier.name = 'hologlyph_liquid_carrier';
  for (const child of [...root.children]) carrier.add(child);
  root.add(carrier);
  const meshes: Array<{ mesh: Mesh; trim: boolean; visible: boolean; culled: boolean }> = [];
  carrier.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    meshes.push({ mesh, trim: materials.some(material => material.name === 'eye_trim'),
      visible: mesh.visible, culled: mesh.frustumCulled });
  });
  let active = false;
  let disposed = false;

  function restore(): void {
    for (const entry of meshes) {
      entry.mesh.frustumCulled = entry.culled;
      if (entry.trim) entry.mesh.visible = entry.visible;
    }
  }

  return {
    update(state): void {
      if (disposed) return;
      carrier.position.set(state.position[0], state.position[1], 0);
      const next = state.amount > 0 || state.targetAmount > 0;
      if (next === active) return;
      active = next;
      if (!active) { restore(); return; }
      for (const entry of meshes) {
        entry.culled = entry.mesh.frustumCulled;
        entry.visible = entry.mesh.visible;
        // CPU bind bounds cannot describe the collapsed, spreading shell.
        entry.mesh.frustumCulled = false;
        // Authored corner trim has no liquid shader. Hide it during the
        // transition; it returns with the complete rig, never at the origin.
        if (entry.trim) entry.mesh.visible = false;
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (active) restore();
      for (const child of [...carrier.children]) root.add(child);
      carrier.removeFromParent();
      meshes.length = 0;
    },
  };
}
