import type { Material } from 'three';
import type { NodeMaterial } from 'three/webgpu';
import type { SkinMaterials, TextSkinEngine, VFXEngine } from '../src/contracts';
import { buildSkinMaterial } from '../src/shaders/materials';

/** Test-only probe, imported by the capture runner, not the application. */
export function surfaceProbe(engine: {
  skinMaterials: SkinMaterials;
  sysTextSkin: TextSkinEngine;
  vfx: VFXEngine;
}): { apply(mode: string): void; dispose(): void } {
  const built = buildSkinMaterial(engine.sysTextSkin, engine.vfx.headConfig);
  built.scroll.value = engine.sysTextSkin.scrollOffset;
  const current = Object.values(engine.skinMaterials) as NodeMaterial[];
  const reference = [built.material, built.interior, built.mask] as NodeMaterial[];
  const fields = ['positionNode', 'normalNode', 'colorNode', 'opacityNode', 'emissiveNode'] as const;
  type Field = typeof fields[number];
  const original = current.map(material => Object.fromEntries(fields.map(field =>
    [field, (material as unknown as Record<Field, unknown>)[field]])));
  const depth = current.map(material => material.depthTest);
  function apply(mode: string): void {
    current.forEach((material, i) => {
      const target = material as unknown as Record<Field, unknown>;
      const baseline = reference[i] as unknown as Record<Field, unknown>;
      for (const field of fields) {
        target[field] = original[i]?.[field];
        const replace = mode === 'reference-all'
          || (mode === 'reference-normal' && field === 'normalNode')
          || (mode === 'reference-position' && field === 'positionNode')
          || (mode === 'reference-colour' && ['colorNode', 'opacityNode', 'emissiveNode'].includes(field));
        if (replace) target[field] = baseline?.[field];
      }
      material.depthTest = mode === 'no-depth' && i === 0 ? false : depth[i] ?? true;
      material.needsUpdate = true;
    });
  }
  return {
    apply,
    dispose(): void {
      apply('actual');
      for (const material of reference as Material[]) material.dispose();
    },
  };
}
