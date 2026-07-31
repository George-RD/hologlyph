---
id: src.melt-internals-material-audit
file: ./assets/hologlyph-bust.glb
verification: verified
sha256: 1f28c3b4cec2a53bef53255b3bf1cf50fb737ec399f4d7d68af99dded028d0e8
type: Shipped GLB material-state audit input
date: 2026-07-31
---

# Melt internals audited asset

This records the exact shipped GLB inspected by
`meta/research/melt-internals-material-audit.md`. The audit used Bun with
`@gltf-transform/core` `NodeIO`, registered `EXTMeshoptCompression` and
`KHRMeshQuantization`, and registered the installed `meshoptimizer`
`MeshoptDecoder` as `meshopt.decoder`. It enumerated `mouth_interior` and
`eye_trim` material factors, texture slots, alpha fields, sidedness, and the
semantics of their primitives from `assets/hologlyph-bust.glb`.

After the 2026-07-31 silhouette-hull rebake, this audit was run again against
the new GLB rather than reusing prior results: `mouth_interior` and `eye_trim`
retain every recorded material property, and `eye_trim` remains a 46-vertex,
168-index, 56-triangle primitive with the recorded semantics.

```js
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const targets = new Set(['mouth_interior', 'eye_trim']);
const document = await new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  .read('assets/hologlyph-bust.glb');
for (const material of document.getRoot().listMaterials()) {
  if (!targets.has(material.getName())) continue;
  console.log({
    name: material.getName(),
    baseColorFactor: material.getBaseColorFactor(),
    metallic: material.getMetallicFactor(),
    roughness: material.getRoughnessFactor(),
    emissiveFactor: material.getEmissiveFactor(),
    baseColorMap: Boolean(material.getBaseColorTexture()),
    metallicRoughnessMap: Boolean(material.getMetallicRoughnessTexture()),
    normalMap: Boolean(material.getNormalTexture()),
    occlusionMap: Boolean(material.getOcclusionTexture()),
    emissiveMap: Boolean(material.getEmissiveTexture()),
    alphaMode: material.getAlphaMode(),
    alphaCutoff: material.getAlphaCutoff(),
    doubleSided: material.getDoubleSided(),
  });
}
for (const mesh of document.getRoot().listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    if (targets.has(primitive.getMaterial()?.getName() ?? '')) {
      console.log(primitive.getMaterial()?.getName(), primitive.listSemantics());
    }
  }
}
```
