# Implementation notes: liquid-glass-chromium-lens

Deviations from the plan and edge cases found while building it.

## The todo names `texElementImage2D`; the implementation does not use it

This is the one real deviation, and it is deliberate. Reasoning is in
`design.md`: three's `WebGPURenderer` owns every texture in the TSL graph and
may be on either backend, so injecting a raw GL texture means pinning WebGL2
and reaching into the backend. The 2D `drawElementImage` route costs one canvas
upload per frame, the same thing the text skin already does, and is
backend-agnostic.

The capability check still requires `texElementImage2D`. Both halves ship
behind one flag, so one without the other means the API changed shape, and
"changed shape" reads as "gone" for something this experimental.

## The spike never measured cross-canvas drawing, so nothing assumes it

The first design sketched a scratch canvas owned by the lens, drawing an
element that lives elsewhere. Re-reading `demo/html-in-canvas-spike.html`
line 225 killed it: every probe does `probeCanvas.append(child)` before
`drawElementImage`. Element under canvas A, drawn into canvas B, was never
tested. So the gate requires the element to be a child of the canvas being
drawn into, which is exactly what was measured.

## The overlap warning was wrong on the first pass

It warned whenever the head canvas overlapped the refract source. Then the lab
showed why that is useless: the head must overlap the source for the sample
window to land inside `[0, 1]` at all, so refracting anything means overlapping
it, so the warning would fire on every correct use.

The acceptance clause is about CONTROLS, not overlap: "no interactive control
is ever placed inside a distorted region." So the check became overlap AND at
least one focusable descendant, counting the named element itself in case a
host points `refract` straight at a control. Silent on decorative content,
which is the intended source.

## `THREE.Texture.needsUpdate` is write-only

A test asserted `texture.needsUpdate === true` after a re-upload and failed
with `undefined`. The accessor has a setter and no getter; `version` is the
counter the renderer actually reads. The test now asserts the version
increments.

## `emulateMedia({ reducedMotion })` is what makes the liveness leg meaningful

The first smoke run had the snapshot path changing 47,566 px over a second,
against 48,404 for the live path: no signal at all. The text-skin row flow
animates the head independently of the lens, and `setMotionFrozen` explicitly
leaves it running (see the contract for `Engine.setMotionFrozen`). Reduced
motion pins it, as `lens-shot.mjs` already relies on.

A residual floor leg was added anyway, capturing the same one-second delta with
no source bound, and the liveness assertions are relative to it. It measures 0
in practice, but the alternative is a leg that silently becomes a tautology if
a future shader adds any idle animation.

## The "outside is untouched" control strip had to move

It started inside the live canvas, which animates everywhere by design, and
scored 4,056 px. It now sits below the canvas, on static page.

## Numbers, Chrome 150.0.7871.129, 2026-07-26

All eleven legs pass; `tools/smoke/out/live-lens-shot.json` has the detail.

| Leg | Result |
| --- | --- |
| capability, flag on | `drawElementImage` and `texElementImage2D` both present |
| capability, flag off | both absent |
| residual floor, no source, 1 s apart | 0 px over 3 luma |
| live subtree refracted through the head | 46,482 px over 3 luma |
| live, two frames 1 s apart | 1,904 px over 3 luma |
| snapshot, two frames 1 s apart | 0 px over 3 luma |
| page outside the silhouette | 0 px over 3 luma |
| control beside the head | hit-tests and focuses as itself |
| control under the head | layout box hits `holo`; engine warned |
| flag off, source on against off | 33,943 px over 3 luma through the snapshot fallback |
| page errors, both runs | none |

`bun run eval` overall pass, unchanged: `flow` 25.652 against a 24.952
baseline, `blendZoneGhosting` 0.635 against a 0.640 baseline and a 0.768
cutoff. Nothing in this change touches the shipped head, and the numbers say
so.

## Bundle cost, measured rather than assumed

First-load gzip of `dist/hologlyph.js`, built from a clean worktree at each
point:

| Build | gzip |
| --- | --- |
| `glass` at da8ee33 | 31.58 kB |
| with this change | 32.99 kB |
| with the probe, the branch and the live lens stripped out | 31.98 kB |

So the feature costs 1.41 kB and at most 1.01 kB of that could move behind a
dynamic import, because the capability probe has to stay synchronous on the
build path and the engine branch is in the entry either way. That is the same
trade the tier 1 pool rejected at 0.9 kB and the snapshot lens rejected at
0.72 kB, and it buys the same three race windows: dispose during load, a second
`setLensSource` during load, and a capture arriving before the chunk resolves.
Static import, consistent with both.

## What is NOT measured, and is therefore an assumption

`drawElementImage(element, 0, 0)` places the element at the canvas origin. Both
the spike and the lab put the child at the canvas origin at the canvas's own
size, so the case of a child laid out at an OFFSET inside a larger canvas is
untested. The code assumes the draw ignores the layout offset and honours the
destination coordinates, which is what a 2D canvas draw call normally does and
what makes the texture cover exactly the element's box. If it turns out to
respect the layout offset instead, the symptom is a misaligned refraction on an
offset child only, and the fix is one translate in `draw`.

The `warnIfLensTrapsControls` check runs once, when the source is bound. A
control added to the subtree afterwards, or a head that moves over one later,
goes unmentioned. Re-checking per frame would be two layout reads and a
`querySelectorAll` on the hot path to catch a mistake that is static in every
realistic page, so it is documented in the README instead.

A live lens that exhausts its failure budget goes dark rather than falling back
to the snapshot lens. Falling back would lazily import `@zumer/snapdom`, an
optional peer a Chromium-path host has no reason to have installed, and would
turn one reported error into two. The head keeps rendering unrefracted, which
is the documented degrade everywhere else in this module.

## Cairn friction

None worth logging. `cairn brief` named this todo correctly, and the `Order N`
convention in `dec.liquid-glass-architecture` did its job.
