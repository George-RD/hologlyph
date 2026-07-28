# Design: liquid-head-melt

## Approach

### The melt map

A displacement that is a function of bind-space `y` alone, which is what makes
its Jacobian triangular and closed form. With `H = maxY - minY`,
`h = saturate((y - minY) / H)`, `mi = saturate(amount * (1 + lag) - lag * h)`,
and `target = minY + floor * H`:

- `y' = y + mi * (target - y)`
- `s = 1 + spread * mi * h`, applied to x and z.

At `amount: 0`, `mi` is 0, so `y' = y` and `s = 1`. An exact identity, not an
approximate one, which is what keeps the shipped head safe behind the gate.

The crown lags the base, so the head pools from below rather than shrinking
uniformly.

### Normals

Displacing `positionNode` does not update normals
(`dec.liquid-glass-architecture`). The melt is not a scalar along the vertex
normal, so it cannot reuse the existing `surfaceGradient` path; it needs the
inverse transpose of its own Jacobian. For `x' = x·s(y)`, `y' = g(y)`,
`z' = z·s(y)`, before normalising:

```
n' = ( n.x,  ( s·n.y - s'·(x·n.x + z·n.z) ) / g',  n.z )
```

with `g' = (1 - mi) + dmi·(target - y)` and `s' = spread·(dmi·h + mi/H)`, where
`dmi` is `-lag/H` inside the unsaturated band of `mi` and 0 outside it.

`g'` reaches 0 at full melt. The divide is guarded with `max(g', 1e-4)`: an
unguarded one puts an infinity into the normal, which reaches the fresnel,
which reaches the alpha, and collapses the silhouette. That failure is already
recorded at `src/shaders/materials.ts`.

`bindNormal` (`normalGeometry`, which drives the triplanar glyph projection)
deliberately does not follow the melt, exactly as it must not follow the fluid.
The glyphs stay welded to the skin and flow with it, which is the approved look.

### The bust extent

Not derivable in the shader, and there is no spare vertex attribute. `VFXEngine`
grows `setBodyExtent(minY, maxY)`, called by `EngineImpl` from the existing
`poolRadialProfile` result at avatar load. The profile is not gated on
`pool.amount`, so cutting the pool does not remove it.

### The occlusion mask

It is a plain `MeshBasicMaterial`, which cannot take a `positionNode`. A rigid
mask behind a melting body would show the mouth cavity and eyeballs through the
puddle. `buildSkinMaterial` therefore builds and owns the mask too, from
`MeshBasicNodeMaterial` with the same `positionNode`, and its dispose moves with
its ownership.

## Changes

ADDED:
- `src/shaders/melt.ts`: `MELT_LAG`, `MELT_SPREAD`, `MELT_FLOOR`, `meltHeight`,
  `meltProgress`, `meltCollapse`, `meltNormal`.
- `test/shaders-melt.test.ts`.
- `HeadMeltConfig` in `src/contracts.ts`, `melt` on `HeadConfig` and
  `HeadConfigOverrides`, `melt` in `DEFAULT_HEAD_CONFIG`.
- `VFXEngine.setBodyExtent(minY, maxY)`.
- `mask` on `BuiltSkinMaterial`.
- `demo/compare-lab.html`, `demo/melt-lab.html`.
- `meta/sources/src.owner-look-2026-07-27.md`,
  `meta/decisions/liquid-glass-melt.md`,
  `meta/todos/todo.interior-glyph-containment.md`,
  `meta/todos/todo.silhouette-hull-halo.md`.

MODIFIED:
- `src/shaders/materials.ts`: `normaliseHeadConfig` gains a `melt` block; the
  melt composes as the outermost position map on both the surface and the
  interior; the melt normal transform joins the gated normal chain;
  `buildSkinMaterial` returns the mask.
- `src/shaders/index.ts`: seven new melt uniforms pushed in
  `applyConfigToBindings`.
- `src/core/engine.ts`: `setBodyExtent` at avatar load, the mask taken from
  `buildSkinMaterial`, dispose adjusted.
- `test/core.test.ts`: melt engine coverage.
- Five liquid-glass todos demoted or annotated with the session ruling.

REMOVED:
- Nothing. The pool, fluid and stage code all stay; only their looks are cut or
  superseded.

RENAMED:
- Nothing.
