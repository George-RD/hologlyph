# Implementation notes: 2026-07-26-liquid-glass-solid-body

Deviations from the todo, and the edge cases the work turned up.

## Deviation: the thickness bake is a load-time mask, not a pipeline artefact

The todo says "bake a per-vertex thickness attribute in the asset pipeline
alongside the existing feature masks". The existing feature masks are not
pipeline artefacts: all seven are computed at load in
`src/asset/rig.ts:bakeFeatureMasks`, and `tools/asset-pipeline/` never touches
them. Thickness follows them.

Doing it offline instead would have meant a new accessor in the GLB, a re-pin of
the asset provenance, a rewrite of the byte-equality regen test, and, worst,
nothing at all for a custom `avatarUrl` rig, which would render with no
absorption while the shipped bust had it. The load-time bake gives every avatar
the same treatment for 72 ms of one-time work on the shipped bust.

That 72 ms is real main-thread time, so the bake carries four budgets. Three
are per-mesh shape limits; `THICKNESS_WORK_BUDGET` counts intersection tests
and is one object per avatar load threaded through every `bakeThickness` call,
because a rig of many individually legal meshes would otherwise add up without
limit. Over any budget the bake returns zeros and absorption switches off.

## Deviation: absorption is tinted on the interior wall, not on the front

The todo asks for "Beer-Lambert absorption tinted by `skin.glass.tint`". Tinting
the front glyph colour in proportion to what the body hides was implemented and
then measured out: it flattens the glyph field exactly where the body is
thickest and the visual eval's yaw legibility fell to 23.8 and 22.1 against
pass cutoffs of 26.0 and 25.8, a straight fail. Capping the mix at 0.22 still
cost 29.7 and 27.4 against a 32.5 and 32.3 baseline. Removing it holds 32.0 and
29.4. What that rejects is mixing the tint into the front glyph field, which is
what the yaw metric reads; it says nothing about tinting light that has passed
through the body, which is what the interior wall does.

So the front carries a colourless thickness term, which is the part of
Beer-Lambert that matters there (a thick body transmits less of the page), and
the tint-coloured transmission is applied to the interior wall, which is the
light that has actually travelled through the body. The measurement is recorded
beside the constants in `src/shaders/materials.ts` so the next person does not
retry it blind.

## Deviation: no chromatic split

Item 3 of the todo is explicitly optional and conditional on the ghosting
budget. It is not implemented. The budget turned out to be fine (0.646 against
a 0.768 cutoff, baseline 0.640), so it remains available.

## Deviation: no new configuration surface

The todo does not ask for one, and `dec.liquid-glass-architecture` states that
items 1 to 4 need no host-facing contract and no new public surface. So
`GLASS_ABSORPTION`, `INTERIOR_OPACITY` and `INTERIOR_DIM` are module constants
in `src/shaders/materials.ts`, tuned in source and gated by the existing
`skin.glass.amount`. `VFXEngine.createSkinMaterial` did have to widen to return
both materials; that is an internal subsystem interface, not host-facing.

## The todo's open question, answered by sidestepping it

The todo asks whether `NodeMaterial.clone()` shares uniform-node references,
because if it deep-copies then about 30 uniforms plus the per-frame
`scrollOffset` must fan out to both halves or they drift on `setHeadConfig`.

Nothing is cloned. `buildSkinMaterial` builds one node graph and assigns
different terminal nodes to two materials, so both reference the identical
`uniform()` objects by construction. `applyConfigToBindings` is unchanged, and
`test/shaders.test.ts` walks both graphs to assert that every uniform the
interior consumes is the same object the front consumes, with the front-only
rim colour as a negative control. The VFX binding is retired only once both
materials have been disposed, since either half can outlive the other.

## Edge case: grid buckets hold bounding-box overlaps, not intersections

The first raycast took the first hit found in the origin cell. That is wrong:
a triangle is filed under every cell its bounding box touches, so a long
slanted wall can sit in the origin cell while intersecting the ray four cells
downrange, past a nearer surface. The DDA now only stops once the best hit is
inside the span already traversed. The regression probe in `test/asset.test.ts`
returns 0.7526 instead of 0.3158 without the fix.

The same overlap makes the walk quadratic if a triangle is re-tested in every
cell it spans, so each ray stamps the triangles it has already tested.

## Edge case: escaped rays leave holes exactly where the bust is cut

About 9% of the skin mesh's rays escape through the open neck boundary. Left at
zero they read as a bright speckled band. Three neighbour-fill passes plus one
Laplacian pass close them. Degenerate normals and vertices no face references
take the same unresolved path rather than claiming zero thickness.

## Edge case: `renderOrder` cannot reorder across the opaque/transparent split

Three renders the whole opaque list before the transparent one, and
`renderOrder` only sorts within a list. The occlusion mask was opaque, so a
transparent interior pass at `renderOrder -1` still drew after it and was
depth-rejected. Giving the interior `depthTest: false` instead would have
painted it over the mouth cavity whenever the jaw opened.

The fix is to flag every layer transparent while the glass is on. The mask and
the internals are alpha 1 with depth write on, and they keep `NoBlending`, so
the move is a straight write. It is still not free: with the jaw open it shifts
the mouth cavity by about 15 luma over the aperture, which was only caught
because the acceptance capture was extended to `jaw_open = 1`. So
`applyGlassLayering` unwinds the whole arrangement at `glass.amount = 0`, and
runs every frame off `sysVfx.headConfig` so it holds however the config was
changed.

## Measurement trap that cost most of the session

The acceptance criterion is that `glass.amount = 0` leaves the approved look
unchanged. Captured naively it showed a 5% pixel difference against the merge
base, which looked like a real regression and survived reverting the opacity
restructure, the interior graph, the transparent flags and even the thickness
attribute read one at a time.

It was none of them. `setMotionFrozen` holds whatever pose idle motion had
reached, and idle phases off wall-clock time. The thickness raycast adds about
70 ms to boot, so the head froze a couple of milliradians away from where the
base branch froze. Glyphs are welded to the bind pose, so that slid every one
of them a pixel or two: a difference with mean signed luminance +0.66 and a
sign flip between half of all adjacent pixels, which is the signature of a
shifted high-frequency pattern rather than a shading change.

Reading the frozen bone quaternions confirmed it. `tools/smoke/solid-body-shot.mjs`
now zeroes the bones and every morph influence array before capturing, refuses
to run if a named morph is not in the rig, compares channel-for-channel as well
as by luminance, fails rather than skips when a requested baseline is missing,
and writes a manifest. With that, amount 0 moves no pixel's luminance in any of
the four cases and differs by at most 3/255 on at most 115 pixels, which is the
extra additive term rounding differently rather than a look change. Two runs of
the same code are bit-identical, so that residue is measured, not noise.

Two smaller traps on the way: `decodePng` in `tools/evals/score.mjs` returns
three channels, not four, so an RGBA-strided reader silently compares garbage;
and emulating `prefers-reduced-motion` already pins the glyph row scroll at
zero, because `setReduced(true)` makes `TextSkinEngine.update` return before
advancing the offset.

## Review

Two independent reviews ran against the staged change before it was committed:
a correctness pass and an adversarial pass on a different model. Between them
they raised three major budget failures, an interior cloned off the wrong mesh,
an unclamped interior alpha, a binding that died with the wrong half of the
pair, unsupported non-indexed geometry, scale-dependent tolerances, a
zero-direction DDA fault, a smoke tool that pinned only one morph array and
never actually compared against a baseline, and the front-tint question above.
All were fixed or measured out; the jaw-open aperture regression came out of
the adversarial pass and is the reason the layering is now conditional.

## Bundle cost

`dist/hologlyph.js` grows from 22.82 kB to 23.77 kB gzip; the thickness bake
lives in the asset module, which the main bundle already pulls in.
