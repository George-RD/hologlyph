# Implementation notes: liquid-glass-snapshot-lens

Deviations from the todo, what the measurements changed, and what the browser
found that no test would have.

## The compositing seam, which is the important thing in this file

Switching the lens on does not only add refraction. It also moves one blend
across a colour-space boundary, and that is inherent rather than a defect
waiting to be fixed.

The live page never enters the canvas. `RendererHost` clears to transparent,
three renders the scene into a LINEAR render target, an output pass encodes it
to sRGB, and only then does the browser compositor add `page * (1 - A)` to the
encoded, premultiplied result. So the unrefracted head is

    encode(C * a) + encode(page) * (1 - a)

while a fragment substituting the snapshot can only produce

    encode(C * a + L * (1 - a))

and `encode(x * a)` is not `encode(x) * a`. No formulation inside the scene
closes that gap: the front pass's own alpha is not known at the interior pass,
and the encode sits between them. A separate opaque lens pass drawn before the
interior was worked through on paper and produces exactly the same expression.

An sRGB round trip on both operands was not assumed to help, it was built and
measured: the residual against the unrefracted head went from 42,705 pixels to
45,306. It bought nothing and cost two transfer functions per fragment, so the
mix stays in the linear working space, consistent with every other blend in the
scene and the more correct of the two.

The consequence is stated at the API and bounded by a smoke leg rather than
asserted away: at 25.8 per cent of the head box and a peak of 84.7 luma it is a
tone shift, and a mapping break would be far larger.

**This is why the visibility leg compares two LENSED captures.** Comparing
`strength 0` against `strength 0.06` cancels the seam exactly, because both
have the head opaque and the snapshot bound, so the difference is displacement
and nothing else. Comparing against the unrefracted head would have measured
the seam and the refraction together and proved neither.

## The alignment leg that caught the design, not a bug

The first version of the smoke asserted that at zero displacement the snapshot
must be indistinguishable from the live page it replaced. It failed at 42,705
pixels, which read as a mapping error and cost the investigation above before
it turned out to be the seam.

Three hypotheses were tested and killed by measurement rather than by argument:

| hypothesis | test | result |
| --- | --- | --- |
| `flipY` is the wrong way round | flip the bound texture at runtime | 56,515 px, worse than 45,306 |
| the mix is in the wrong colour space | sRGB round trip on both operands | 45,306 px, slightly worse |
| the window is off by a scroll offset | recompute it from the live rects | exact to 1e-9 |

The leg was replaced by one that proves what it was trying to prove and nothing
else: the bound window is recomputed in the smoke from
`getBoundingClientRect` plus the page scroll and compared exactly. On the lab
page that is `offsetU 0, offsetV 1, scaleU 1, scaleV -0.9714816993340037`, which
is `-800/823.484`, the canvas height over the hero height, to the digit.

## A periodic test pattern is worse than a flat one

The lab hero started as 44 px diagonal stripes, chosen for hard edges. It is
the wrong pattern for exactly the property under test: a displacement of one
period is indistinguishable from no displacement, to the eye and to a
correlation search alike. A patch-matching pass over the striped captures
returned `(-20, -20)` at the search boundary almost everywhere, which is the
stripe direction aliasing, not a measurement.

The hero is now five aperiodic radial blobs over a diagonal gradient, and the
lower band is a single non-repeating multi-stop gradient rather than a 32 px
grid.

Patch correlation still cannot recover the displacement field, and the reason
is worth writing down: the head's own glyph texture is identical between the
two captures, so every non-zero shift is penalised by the head mismatching
itself, and SAD always returns zero. The evidence that this is a displacement
rather than an overlay is elsewhere and is strong: mean luminance, standard
deviation and mean horizontal gradient over the head box are unchanged to two
decimal places (61.14/62.84/14.438 against 60.58/62.84/14.344), which is what a
displacement does to a histogram and an overlay does not, and flipping the sign
of `strength` moves 14,681 pixels.

## Displacement is small in the middle of the face, and that is correct

`normalView.xy` is near zero where the surface faces the camera, so the centre
of the head shows the page barely moved and the bending concentrates towards
the silhouette. That is what a slab does: a flat piece of glass viewed head on
shows no lateral shift, and the offset is `t * tan(theta)` in the view normal's
direction.

It also means the head does not MAGNIFY. True magnification comes from the
curvature of two surfaces forming an image, which a per-fragment screen-space
offset cannot express; a radial contraction about a screen-space centre would
fake it, and that is a look decision for the owner, not something to smuggle in
under a physical model.

Strength was swept in the browser rather than guessed, at amount 1 against the
zero-displacement capture:

| strength | px over 3 luma | peak luma |
| --- | --- | --- |
| 0.03 | 8,155 | 117.5 |
| 0.06 | 9,327 | 133.5 |
| 0.10 | 11,880 | 140.5 |
| 0.16 | 13,944 | 140.5 |
| 0.24 | 16,273 | 140.5 |
| 0.35 | 19,528 | 140.5 |

It saturates early, for the reason above. The default stays at the conservative
0.06 and the lab slider spans -0.3 to 0.3, because the owner has not seen it
yet and a default nobody has judged should be the quiet one.

## The lazy chunk was built, measured, and thrown away, again

`page-lens.ts` shares nothing with the entry (three is external, the contracts
are types), so unlike the pool it looked like a clean split. Measured:

| build | first-load gzip | on demand |
| --- | --- | --- |
| baseline, `glass` | 28.32 kB | - |
| static import | 30.93 kB | - |
| dynamic import | 30.21 kB | 1.58 kB |

Only 0.72 kB of the 2.61 kB the feature adds is movable; the rest is the
material's lens nodes, the VFX binding and the engine reconciler, which the
entry needs whatever a host does. That is under the 0.9 kB the tier 1 pool
already rejected for the same trade, and it buys three race windows (dispose
during load, a second `setLensSource` during load, a capture request arriving
before the chunk resolves). Static import stands.

What DOES stay lazy is the thing the todo actually asked to be lazy: the
rasteriser. `@zumer/snapdom` is an optional peer, external to the build, and
reached through a dynamic import that only runs once a host has named a
subtree.

## Recapture policy, and where it departs from the todo

The todo says "on resize, on host request, and debounced during scroll". The
implementation is:

- host request, immediately (`engine.captureLens()`);
- debounced when the SOURCE rect moves or resizes in document space, which
  covers the resize case and every reflow it did not name;
- debounced on scroll, capture phase on the owner window so an inner scrolling
  container counts too.

The scroll leg is deliberately NOT there for geometry. Both rectangles are in
document space, so a page scroll leaves the window untouched and needs no
recapture at all; that is the whole reason to snapshot in document space, and
there is a test pinning 600 frames of scrolling to zero captures. It is there
for CONTENT: a hero is exactly the kind of subtree that carries scroll-driven
animation, and it would otherwise stay frozen.

What is not implemented, and is not hidden: arbitrary content mutation. A
`MutationObserver` on a subtree the host chose is a cost nobody asked for, and
snapdom's own `burst` mode already offers it to a host that wants it through an
injected rasteriser.

## Smaller things worth knowing

`lens.amount` ships at 1, not 0, and that is not an inconsistency with
`pool.amount`. The gate here is a RESOURCE, not a number: with no texture bound
the material's derived `lensGate` is 0 and the graph is an exact identity, so
naming a subtree is sufficient to switch the lens on and `amount` is free to be
a strength dial. A number gate would have meant `refract="#hero"` doing
nothing until the host also set a config field.

The snapshot texture is created with `colorSpace = SRGBColorSpace`. A
`THREE.Texture` defaults to `NoColorSpace`, and without the decode the
refracted page comes out visibly washed out and too bright.

The 1x1 placeholder texture is a module-level singleton and is deliberately
never disposed. A sampler needs something bound whether or not a lens exists,
it is four bytes and immutable, and the renderer's teardown walk only disposes
textures held as direct material properties, so nothing can free it out from
under a second engine anyway. The real snapshot is disposed by
`PageLens.dispose`, which is the only owner it has for the same reason.

`RendererHost.backend` reports what `navigator.gpu` advertises, not what three
built. Headless Chromium advertises WebGPU and then logs
`WebGPURenderer: WebGPU is not available, running under WebGL2 backend`, so the
first smoke run recorded the wrong backend. The smoke now asks
`renderer.backend.isWebGPUBackend`. Everything here is backend independent by
construction (`screenUV` is top-down on both, `flipY` is honoured on both), but
the captures in `tools/smoke/out/` were taken on WebGL2 and a WebGPU pass on a
real GPU has not happened.

## Not verified by me, and the owner should look

The vision tooling available in this session was quota-exhausted and the
desktop had no screen-recording permission, so the captures were characterised
numerically and never actually looked at. Every claim above is a measurement.
Whether it LOOKS like liquid glass is an owner judgement, and the frames are at
`tools/smoke/out/lens-source-off.png`, `lens-aligned.png` and
`lens-source-on.png`, with the lab at `bun run dev` then
`/hologlyph/lens-lab.html`.

## Review, and it was not independent either

Three delegated reviews were dispatched and all three died on provider usage
limits: a `reviewer` and a `gemini-reviewer` on the first attempt, then two
general agents on the second. The tier 1 pool change lost its reviewers the
same way. So this is a self-review against the checklist written for them, and
it is recorded as such rather than dressed up.

What it found and fixed:

1. **A disposed snapshot stayed bound to a live sampler.** `teardownLens`
   disposed the texture and then cleared the binding, and clearing only wrote
   `lensGate = 0` while leaving `uniforms.lensTexture.value` pointing at the
   dead texture. That retains the whole rasterised canvas and makes three
   re-upload it from `image` on the next frame. `setLens(null)` now rebinds the
   1x1 placeholder, and `teardownLens` unbinds before it disposes.
2. **`setLensSource` was not idempotent.** Calling it with the same element
   tore the lens down and rasterised again, which is 10 to 150 ms of main
   thread per call and exactly the shape of a framework effect with no
   dependency array. It now returns early when the element and the rasteriser
   are both unchanged.
3. **A remount onto a different canvas kept the old sample window.**
   `buildLens` early-returns when a lens exists, so the second mount left the
   window measured against a detached canvas. `doMount` now tears the lens down
   when the canvas identity changes.
4. **A failed rasteriser import was cached forever.** `snapdomLoader ??= ...`
   kept a rejected promise, so one transient dev-server hiccup made the lens
   permanently unavailable for the life of the page. The rejection handler now
   clears the cache and rethrows.

What it checked and found sound, so the next reader does not redo it:

- The composite algebra against three's `SRC_ALPHA, ONE_MINUS_SRC_ALPHA` colour
  blend and its separate `ONE, ONE_MINUS_SRC_ALPHA` alpha blend. The emitted
  quotient is bounded above by the brighter of the wall and the snapshot at
  every combination of gate, amount and alpha, and cannot go negative because
  `output` is already `.max(0)`.
- `mix(x, lensRgb, 0)` really is an exact identity, because `lensRgb` cannot be
  NaN: the divide is guarded at `1e-4` and both operands come from a texture
  sample and from `output`. This is the trap that cost the pool a head.
- Setting `outputNode` changes nothing else. `NodeMaterial.setup` applies fog
  and premultiplied alpha before assigning `output`, adds the clipping node
  independently, and only overrides the result with the MRT node when one is
  configured, which it is not here.

What it deliberately did not fix:

- Overlapping backfaces on a non-convex body all draw with alpha driven to 1
  and the last one wins. It varies smoothly and it is the interior wall's
  existing behaviour, not something the lens introduced.
- `sync` measures the source rect once per frame even before the first capture
  lands. One `getBoundingClientRect` on a feature the host opted into.
