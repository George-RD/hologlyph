# Implementation notes: liquid-head-melt

Running log of every deviation from the plan and every discovered edge case.
The escalation judgement from the melt lab session is written here.

## Deviations from the plan

### `status: pending` is not a cairn status

The plan specifies `status: pending` for the two new todos.
`cairn scan` rejects it with `CAIRN_TODO_STATUS_INVALID`, and the binary
enumerates the valid set as `open | in_progress | done | blocked`
(`cairn todo set <slug> <open|in_progress|done|blocked>`). Used `open`, which
is the semantic the plan wanted. The plan's own step 2 preamble already noted
that the todo vocabulary is narrower than it looks; it just named the wrong
member. Not logged as cairn friction: the tool is right and the plan was
wrong.

## Discovered edge cases

### The puddle has no thickness at exactly `amount: 1`

The plan's map collapses every height onto the single plane
`target = minY + floor * H`. At `amount: 1`, `mi` saturates to 1 at every
height, including the crown, because `amount` is scaled by `1 + lag`. So every
vertex of a closed shell lands on one plane: the front and back faces become
coincident, the shell has no volume, and `g'` reaches exactly 0, which is the
case the `MELT_MIN_JACOBIAN` guard exists for.

That also means `floor` does not do what its name says. It sets the height of
the puddle plane above the base, not the puddle's thickness, and no value of it
recovers thickness at full melt. The docstring says the honest thing rather
than the plan's phrasing.

A thickness-preserving variant is a one-line change: map `target` to
`minY + floor * H * h` instead, which compresses the body into the band
`[minY, minY + floor * H]`, keeps a front and a back, bottoms `g'` out at
`floor` rather than 0, and still satisfies every acceptance test the plan
lists. It was not taken: the plan fixes the map, its `g'` formula, and the TSL
mirror of both, and changing the map would invalidate the mandated normal
maths that the visual judgement is supposed to test.

So this is a thing to look at in the lab rather than a thing to pre-empt. The
escalation criterion is judged exactly as `dec.liquid-glass-melt` states it,
and if it fires, mesh displacement has failed and
`todo.liquid-glass-topology-fluid` is warranted. This note exists only so that
whoever reads the judgement afterwards knows the endpoint is degenerate by
construction and that the sweep, not only `amount: 1`, is what was looked at.

### `meltNormal` has to short-circuit at 0, not merely evaluate to the identity

At `amount: 0` every term collapses to the identity, but the final
renormalisation still divides a unit vector by a length that is `1` only to
within floating point. The plan requires the input normal back exactly, so the
function returns early. The shader gate does the same thing for the same
reason: `mix(a, b, 0)` is `a` bit for bit, so the shipped chain is reproduced
rather than approximated.

### The authored internals do not melt, and it is the loudest thing in the lab

Found by eye at `melt.amount: 0.7`, and it is worse than the flat puddle.

The eyeballs, `mouth_interior` and `eye_trim` are separate meshes carrying
their own materials. Step 4d melted the occlusion mask so the shell would keep
bounding them, but the internals themselves still sit at their bind positions
while the shell collapses out from under them. The result at 0.7 is two
eyeballs and a dark mouth cavity hanging in mid-air above a squashed body, and
at 1 they are still there, floating a head's height above the puddle.

Only one of the three is reachable: the eyeball is a node material
(`buildEyeballMaterial`) and could take the map. `mouth_interior` and
`eye_trim` are authored glTF materials in `KEEP_MATERIALS` and cannot take a
`positionNode` at all, so melting them means replacing them with node-material
clones and inheriting whatever maps and emissive they carry. `materials.ts`
already records that trade being declined once, for the waterline fade.

A visibility gate on the melt amount was considered and deliberately NOT
built: hiding a mesh mid-sweep is itself the popping the plan's acceptance
forbids, and a new visibility system is outside the approved map. Recorded
here and tracked as `todo.melt-internals`, to be settled with the owner
alongside the melt itself.

This is a spike gap, not evidence about mesh displacement. It says nothing
about whether the shell reads as liquid, so it does not fire the escalation
criterion, which is about the shell.

## Escalation judgement

The criterion, from `dec.liquid-glass-melt`:

> if the puddle at `melt.amount: 1` reads as a squashed head rather than as
> liquid, specifically if the rim shows facial features instead of a
> surface-tension edge, mesh displacement has failed and the particle field in
> `todo.liquid-glass-topology-fluid` is warranted.

**Judged 2026-07-27, headless Chromium at 1000 by 1000, motion frozen, camera
at distance 4.2 and height 1.0, glass at 1.**

**The criterion does not fire. It also does not pass cleanly.**

On the specific diagnostic the criterion names, the melt is fine: at
`amount: 1` the rim is a smooth ellipse with no facial features anywhere on
it, no nose, no brow, no jaw. Nothing about the outline says squashed head.
The `g'` guard holds across the whole sweep: no black patch, no inside-out
shading, no collapsed silhouette at any amount, and `amount: 0` returns the
approved head with no residue.

On the broader question the criterion is asking, it does not read as liquid
either, and the reasons are both known and both fixable inside mesh
displacement:

1. **The puddle is a zero-thickness sheet.** Predicted above from the map, and
   confirmed by eye: at `amount: 1` it is a papery flat disc with no depth, no
   volume, and no meniscus. Glass with no thickness has no Beer-Lambert term
   left, so it loses exactly the quality that makes the head read as a block of
   material. The band map recorded above fixes this without leaving mesh
   displacement.
2. **The internals are left behind.** Two eyeballs and a mouth cavity floating
   above the puddle, per the edge case above. Nothing about that is a statement
   on displacement; it is three meshes that were not wired.

So: **mesh displacement has NOT failed, and the particle field in
`todo.liquid-glass-topology-fluid` is NOT warranted on this evidence.** The
criterion tests whether the SHAPE the displacement produces is fundamentally
head-like, and it is not: it is a spread disc. What is missing is thickness and
three unwired meshes, and a particle field would fix neither for free while
costing the rig, the visemes and the WebGL2 path.

What the owner should be shown is a sweep with both fixed. Judging the melt as
it stands would be judging the two defects, not the direction.

## Compare lab observations

Captured headless at 1000 by 1700, both pages with their own chrome hidden and
their own cameras untouched, per the plan's instruction not to synchronise
framing.

**The confound, stated first.** `demo/index.html` frames the bust to fill the
viewport; `demo/engine.html` sits much further back, so the library head
occupies roughly a third of the screen width the hand-rolled one does. Glyph
scale, apparent density and apparent contrast all move with that, and the plan
forbids equalising it. So anything below that could be explained by on-screen
size is flagged as such.

What is NOT explained by framing:

- **Specular.** The library head carries a broad, smeared sheen across the
  forehead and one cheek that washes the glyphs out under it. The hand-rolled
  head's highlights are tighter and read as clusters of bright glyphs rather
  than as a smooth wash. This is a shading difference: a wash that size does
  not appear or disappear with camera distance.
- **Feature contrast.** The hand-rolled head has strong dark shading in the eye
  sockets, under the nose, at the lip line and under the jaw. The library head
  reads flatter through the same regions.

What IS probably framing:

- The hand-rolled glyphs are legible as words; the library glyphs read as a
  fine speckle. At three times the on-screen size the same grid would read
  legibly too.
- The iris is a large structured magenta disc on the left and a small magenta
  dot on the right.

Same in both: the warm brown mouth region, the magenta iris hue, the ear
silhouette, and the glyph rim on the edge.

**Out of scope, but found here.** `demo/main.ts` registers no `resize`
listener, so `engine.html` never calls `engine.resize` after mount and the head
stretches if the window changes size. Every lab page has its own listener; the
shipped demo page does not. Not touched in this change, because no step in the
plan edits `main.ts` and `tools/evals/capture.mjs` targets that page.

## Adversarial review, 2026-07-27

Run through `completion(model="slow")` in the eval kernel, per the plan: the
delegated reviewers are quota-refused and every subagent type tunnels through
the same backend. The whole `src/`, `test/` and blueprint diff plus
`src/shaders/melt.ts` were pasted in, since the reviewer cannot read the repo.

It found two things the plan's own prescriptions cause. Neither is fixed here,
because both values are fixed by `dec.liquid-glass-melt` and changing them
needs an accepted decision, not an implementer's judgement. Both are recorded
so that decision can be taken with the evidence in hand.

### 1. `max(g', 1e-4)` destroys the sign of a genuinely negative Jacobian

The guard is specified as a one-sided positive clamp. But `g'` does not
approach 0 from above everywhere: near the base it goes NEGATIVE before `mi`
saturates, because `dmi * (target - y)` is negative there and outruns
`1 - mi`.

Swept numerically at the shipped `lag: 0.55`, `floor: 0.06` over the bust's
extent: `g'` is negative for `amount` in **0.624 to 0.665**, at normalised
heights **h 0.000 to 0.055**, reaching **-0.0328**. That is a real local fold
in the map at the very base of the bust, and the correct inverse-transpose
normal there points the other way. Clamping to `+1e-4` instead yields an
almost vertical normal of the wrong orientation, so a thin band at the base
shades inside-out for about four per cent of the sweep.

It is not visible in the lab captures, because the base of the bust is a small
dark band and the window is brief. It is still wrong.

The fix, for whoever takes the decision, is a sign-preserving regularisation
rather than a one-sided clamp:
`|g'| < eps ? (g' < 0 ? -eps : eps) : g'`. That still guards the divide, which
is the guard's stated purpose, and stops it lying about orientation.

### 2. `meltNormalGate = clamp01(amount)` attenuates the melt normal twice

The gate is used as the weight of `mix(normalView, meltNormalView, gate)`. The
melt normal is already the exact transform for that amount, so weighting it by
the amount again means that at `amount: 0.5` the shading normal is halfway
between the undeformed view normal and the correct one. The shading lags the
geometry through the whole middle of the sweep, which is exactly where the
"does it read as liquid" judgement is made.

The endpoints are right: 0 is the shipped chain bit for bit, 1 is the exact
melt normal. The plan requires this value, and `poolNormalGate` and
`fluidNormalGate` do the same thing, so it is the house pattern rather than an
oversight. Note though that both `HeadUniforms.meltNormalGate` and
`HeadUniforms.poolNormalGate` document themselves as "0 or 1", which is what
the mix weight should be and is not what either holds.

The fix is a binary gate: `amount > 0 ? 1 : 0`. It keeps the bit-exact
identity at 0, which is the whole reason the gate exists, and gives the true
transform everywhere else. It does raise `surfaceNormalGate`, which is the max
of the three, to 1 whenever the melt is on; since `surfaceGradient` already
carries `breatheAmp` and `fluidAmount` internally, that makes the pool and
fluid normals more correct rather than less, but it is a change to their look
and belongs in the same decision.

### Findings judged not to be defects

- **The mask now follows the breathe and fluid displacement**, where the old
  `MeshBasicMaterial` followed neither. At shipped defaults `pool.amount` and
  `fluid.amount` are both 0, so `surfaceOffset` is exactly 0 and
  `surfacePosition` is `positionLocal` bit for bit. No shipped pixel moves, and
  `bun run eval` confirms it. With either feature on, a mask that tracks the
  shell is the correct behaviour, not a regression.
- **`meltH` reads `surfacePosition.y`, not `positionLocal.y`.** That is the
  plan's composition order: the melt is the outermost map, so its input is the
  already-displaced position and its Jacobian is taken with respect to that.
  The comment claiming pure bind space was overstated and has been tightened.
  At shipped defaults the two are identical anyway.
- **`spread`, `floor` and `lag` are floored at 0 but not capped.** A host
  passing `Number.MAX_VALUE` gets `Infinity` in a float32 uniform and `0 * Inf`
  is NaN, which would break the identity at `amount: 0`. Real, but it is the
  existing house pattern: `fluid.sag`, `fluid.wobble` and `stage.squeeze` all
  have the same shape, and the plan prescribes `Math.max(0, finiteOr(...))`
  explicitly. Capping the melt alone would be an inconsistency; capping all of
  them is its own change.
- **Derivative of a saturated `h`.** The reviewer wants `dh` to be 0 outside
  the extent. Deliberate and commented in `melt.ts`: the crown and base
  vertices sit exactly on the clamp, and giving them a zero gradient while
  their neighbours have a finite one puts a shading seam at the poles.

### Acted on

Finding 12, that nothing tested the mask's ownership move, was correct and is
fixed: `test/core.test.ts` now counts disposals of all three passes across an
avatar replacement and an engine teardown.
