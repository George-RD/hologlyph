---
id: res.melt-internals-material-audit
nodes: [hologlyph.runtime.shaders, hologlyph.asset.loader]
sources: [src.melt-internals-material-audit]
date: 2026-07-31
---

# Melt internals material audit

This audit tests the assumption in `todo.melt-internals` that converting the
`mouth_interior` and `eye_trim` materials to node materials would silently lose
authored map or emissive state. It is false for the shipped asset.

## Three r178 conversion behaviour

Installed Three is `0.178.0` (`node_modules/three/package.json:1-5`). Its
internal `NodeLibrary` is explicitly marked `@private` at
`node_modules/three/src/renderers/common/nodes/NodeLibrary.js:1-8`. The
private `fromMaterial()` method at lines 40-72 creates the registered node
material class and, at lines 62-66, copies every enumerable source property:

```js
for ( const key in material ) {
  nodeMaterial[ key ] = material[ key ];
}
```

That exhaustive enumerable-property copy preserves standard PBR, map, alpha,
side, blending and vertex-colour fields. This library must own the equivalent
helper rather than call `renderer.library.fromMaterial()`, because
`NodeLibrary` is a private Three API and its availability is not a compatible
minor-version contract.

`NodeMaterial.copy()` is not a replacement. At
`node_modules/three/src/materials/nodes/NodeMaterial.js:1236-1265`, it copies
node-specific fields then delegates to `super.copy(source)` at line 1264. That
is `Material.copy()`, not the standard-material property conversion, so it
cannot be relied on to carry classic PBR and map state into a blank
`MeshStandardNodeMaterial`.

## Shipped GLB inspection

Inspected asset: `assets/hologlyph-bust.glb`.

SHA-256 at inspection: `c08365a15f5295caeb0cada89a0a60102481877a21535a32b71459d66f4ec145`.

The GLB was opened with `@gltf-transform/core` `NodeIO`, registering
`EXTMeshoptCompression`, `KHRMeshQuantization`, and the installed
`meshoptimizer` `MeshoptDecoder` dependency:

```js
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const document = await io.read('assets/hologlyph-bust.glb');
```

The complete inspection used to generate the table and primitive semantics was:

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

For each primitive using either material, `primitive.listSemantics()` returned
`POSITION`, `NORMAL`, `JOINTS_0`, `TEXCOORD_0`, and `WEIGHTS_0`: neither has a
`COLOR_0` attribute.

| Material | Base colour factor | Metallic | Roughness | Emissive factor / map | Base / MR / normal / occlusion / emissive maps | Alpha mode / cutoff | Double-sided |
| --- | --- | ---: | ---: | --- | --- | --- | --- |
| `mouth_interior` | `[0.04, 0.03, 0.035, 1]` | 1 | 0.9 | `[0, 0, 0]` / none | none / none / none / none / none | `OPAQUE` / 0.5 | false |
| `eye_trim` | `[0.09, 0.08, 0.09, 1]` | 1 | 0.8 | `[0, 0, 0]` / none | none / none / none / none / none | `OPAQUE` / 0.5 | false |

Therefore neither material has texture, emissive, vertex-colour, alpha, or
backface state that a node conversion could lose. The todo's premise was
measured rather than inherited and is false: there is no shipped asset-data
trade and no owner ruling is needed. The owned exhaustive-copy helper remains
necessary to preserve any future enumerable authored fields.
