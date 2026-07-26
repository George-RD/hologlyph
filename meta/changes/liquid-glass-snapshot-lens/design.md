# Design: liquid-glass-snapshot-lens

## Approach

Three separable pieces, split so that almost all of it is testable without a
browser: arithmetic in `src/core/lens.ts`, DOM and GPU resources in
`src/core/page-lens.ts`, and one node-graph term in
`src/shaders/materials.ts`.

### Where the substitution happens, and why it is the interior pass

What the head shows of the page is `front * a + dst * (1 - a)`, where `dst` is
whatever the framebuffer already holds. A fragment can only replace its own
destination; it cannot reach into a layer that was already blended. So the
substitution has to happen on the DEEPEST pass, which is the back-facing
interior wall drawn at `renderOrder -1`.

Doing it on the front surface would substitute the interior wall along with the
page, and delete the far side of the head at full strength. Doing it on the
interior leaves the front glass composite untouched and puts the refracted page
exactly where the page was.

The exchange, with `a` the interior's own alpha, `w` the lens amount and `L`
the sampled snapshot: emit

    rgb' = (C * a + L * (1 - a) * w) / a'      at   a' = a + (1 - a) * w

Source-alpha blending then produces `C*a + L*(1-a)*w + page*(1-a)*(1-w)`: the
page crossfading into its lensed copy, with the wall's own colour untouched at
either end.

### The gate is derived, not configured

`lensGate` is 0 or 1 and comes from whether a texture is bound, never from
`lens.amount`. At 0 the material's `outputNode` is `mix(output, lensed, 0)`,
which is `output * 1 + lensed * 0`, bit for bit. `lens.amount` therefore ships
at 1 and behaves as a strength dial: with nothing named to refract there is no
rasteriser loaded, no texture, no layout read and no lens term, so the
owner-approved look is reproduced exactly. Same shape as `pool.amount`, but
gated on a resource rather than on a number, because a lens with no snapshot
would sample a 1x1 placeholder and fill the head with a flat colour.

### The displacement model

    shift = normalView.xy * aThickness * lensDisplacement

A slab of thickness `t` bends what is behind it by roughly
`n.xy * t * (1 - 1/ior)`, so the cranium (thickness 0.835 on the shipped bust)
displaces several times what the nose tip (0.149) does. That is what makes the
head read as a block of glass rather than a decal, and it is why the offset is
not the front surface's fresnel band: fresnel is a reflection weight, not a
refraction distance.

`lensDisplacement` is a `vec2` computed on the CPU from `strength` and the
canvas aspect, so the offset is isotropic in device pixels and `strength` can
be quoted in canvas heights. Its y is negated because view space points up and
`screenUV.y` points down. The sign is left free: it decides whether the head
reads as a converging or a diverging lens, and both are legitimate looks.

### Document space is what makes scrolling free

Both rectangles are measured in document space, so a page scroll moves the head
and the source together and the sampled window is unchanged. Only a source that
moves or reflows needs a new snapshot. A debounced scroll recapture exists on
top of that, not for geometry but for content: a hero section is exactly the
kind of subtree that carries scroll-driven animation, and it would otherwise
stay frozen.

### The rasteriser is injected

`LensRasteriser` is `(element) => Promise<CanvasImageSource>`. The library
ships none; the default lazily imports `@zumer/snapdom`, declared as an
optional peer and external to the build, so a consumer who never names a
subtree neither ships nor installs it. A host with its own rasteriser needs no
peer at all.

## Changes

ADDED:
- `src/core/lens.ts` - projection window, displacement scale, recapture
  scheduler. Pure.
- `src/core/page-lens.ts` - capture, upload, per-frame window sync, teardown.
- `test/core-lens.test.ts` - 28 cases over both.
- `demo/lens-lab.html` - lab page with an aperiodic hero to refract.
- `tools/smoke/lens-shot.mjs` - seven-leg browser smoke.

MODIFIED:
- `src/contracts.ts` - `HeadLensConfig`, `LensWindow`, `LensBinding`,
  `LensRasteriser`, `LensSourceOptions`, `VFXEngine.setLens`,
  `Engine.setLensSource` / `captureLens`.
- `src/shaders/materials.ts` - lens uniforms, the placeholder texture, the
  interior `outputNode` composite, `lens` normalisation.
- `src/shaders/index.ts` - `setLens` and the uniform fan-out.
- `src/core/engine.ts` - lens lifecycle and the per-frame sync.
- `src/element/hologlyph-head.ts` - the `refract` attribute.
- `vite.config.ts`, `package.json`, `THIRD-PARTY-NOTICES.md` - the optional
  peer.
- `cairn.blueprint` - the new test path under `hologlyph.runtime.core`.

REMOVED: none.

RENAMED: none.

## Risks

- **The compositing seam.** Switching the lens on makes the head opaque and
  folds the page into the scene, moving one blend from the browser
  compositor's encoded space into three's linear working space. Measured, and
  shown in `implementation-notes.md` to be unavoidable from inside the scene.
- **Staleness and CORS.** Inherent to snapshotting; documented at the API
  rather than papered over.
- **Cost.** Two `getBoundingClientRect` reads per frame, and only while a
  source is named.
