---
node: hologlyph.runtime.shaders
status: open
created: 2026-07-27
---

# The internals do not melt with the body

Found in `demo/melt-lab.html` on 2026-07-27, the day the melt landed
(`dec.liquid-glass-melt`). Recorded in full in
`meta/changes/archive/*-liquid-head-melt/implementation-notes.md`.

**Seen and accepted by the owner, 2026-07-28**
(`src.owner-consolidation-2026-07-28`):

> "i was aware of the eyeballs/internals thing, i could see, which is why i just
> approved the directio here!"

So this does not block the direction, it does not block exposing the melt, and it
was never mistaken for evidence against mesh displacement. The owner explicitly
wants the melt reachable in the studio's developer tier precisely so this class
of thing can be found and worked on together, which is why the defect is stated
inline on the page rather than hidden behind a threshold.

What it does block is calling the sweep finished. A presentation pass that shows
the melt as a polished thing (`todo.studio-showcase-overhaul`) wants this fixed
first. The melt is now active development rather than an experimental spike,
which makes this the first real piece of work on it.

## The defect

At `melt.amount: 0.7` the two eyeballs and the mouth cavity hang in mid-air
above a squashed body. At 1 they are still there, floating roughly a head's
height above the puddle.

`buildSkinMaterial` melts three passes: the front surface, the interior wall
and the occlusion mask. The mask was moved into it precisely so the shell would
keep bounding the internals. But the internals are separate meshes carrying
their own materials, and nothing displaces them, so they stay at their bind
positions while the shell collapses out from under them.

Three meshes are involved and they are not equally reachable:

- The eyeballs use `buildEyeballMaterial`, which is a node material. It can
  take the melt map directly; the cost is the melt uniform block duplicated
  into `EyeUniforms`, and `setBodyExtent` writing the eye bindings too.
- `mouth_interior` and `eye_trim` are authored glTF materials in
  `KEEP_MATERIALS`. They cannot take a `positionNode` at all. Melting them
  means replacing them with node-material clones, which silently drops whatever
  maps and emissive the asset carried. `src/shaders/materials.ts` records that
  same trade being declined once already, for the waterline fade.

## What was deliberately not done

A visibility gate on the melt amount. Hiding a mesh partway through the sweep
is exactly the popping the melt's own acceptance forbids, and it would add a
visibility system that no decision covers. The defect is recorded rather than
papered over.

## The fix

Factor the melt map in `materials.ts` into one helper both material builders
call, wire the eyeball through it, and decide the authored pair with the owner:
either clone them into node materials and accept re-authoring what the clone
drops, or accept that a fully melted head has no mouth cavity and no eye trim
and fold them into the shell.

## Acceptance

A full `melt.amount` sweep in `demo/melt-lab.html` with nothing left behind at
any point: no floating eyeball, no cavity poking out of the puddle, no pop. The
shipped head at `melt.amount: 0` is unchanged and `bun run eval` still passes
against the existing baseline.
