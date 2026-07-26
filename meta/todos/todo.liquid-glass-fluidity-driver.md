---
node: hologlyph.runtime.shaders
status: blocked
created: 2026-07-25
---

# Tier 3: fluidity as a driver of the rig, not a replacement for it

Order 8 (`dec.liquid-glass-architecture`). Blocked on
`todo.liquid-glass-tier1-pool`.

The head stays the head. How molten it behaves is a parameter
(`dec.liquid-glass-architecture`). Follows tier 1 and tier 2; needs WebGPU
compute for the simulation, and degrades to tier 1 on WebGL2.

## Why visemes are safe here

Three's `setupPosition` runs morph targets, then skinning, then any
`positionNode`. Viseme morphs are already baked into `positionLocal` before a
displacement node reads it, so

```
positionNode = positionLocal.add(offset.mul(f))
```

deforms an already-correct face. `f = 0` is today's rig exactly. `f = 1` is
maximally molten. The mouth shape is upstream of `f` at every value, so there is
no fidelity trade to make at this tier.

Fixed topology also means the three-layer depth scheme in `replaceAvatar`
survives: the occlusion mask still bounds eyeballs, `mouth_interior`, and
`eye_trim`, as long as displacement stays outward-bounded.

## Work

1. `f` as a spatial field, not a scalar. Weight it with baked masks in
   `buildLoadedAvatar`, reusing the pattern that already drives per-zone
   opacity: high at the base and neck, low over the mouth and eyes. The head can
   flow at the bottom and stay crisp at the face in the same frame.
2. A shape-matched simulation writes the offset field. Particles bound to rest
   positions on the rig; stiffness is the liquidity. Sag, wobble, surface
   tension, squeeze against declared obstacles, flow into the pool.
3. **Normals must follow the displacement.** `positionNode` does not update
   them: `normalLocal` still comes from the undeformed attribute, so a wobble
   with rig normals reads as texture swim, not as liquid. Derive them from the
   gradient of the offset field, or from screen-space derivatives of the
   deformed world position.
   - `normalWorld` in the matte shade term must follow.
   - `normalView` in the fresnel rim must follow. This one carries the glass.
   - `bindNormal`, which is `normalGeometry` and drives the triplanar glyph
     projection, must **not** follow. Glyphs stay anchored to the bind pose,
     which is the approved look. The surface flows; the text stays welded to the
     skin.
4. Drive `f` from behaviour state, scroll velocity, emergence, and `HeadConfig`,
   with reduced motion damping it as everywhere else.

## Limits

Fixed topology cannot split, merge, or close a hole, and a mesh pushed far
enough self-intersects. Beyond that band the head must hand over to tier 4
(`todo.liquid-glass-topology-fluid`), and by then it is not a head.

## Acceptance

A lab page with a fluidity slider from 0 to 1. At 0 the render is
byte-comparable to today. At 1 the head visibly flows, sags, and wobbles. Speech
runs at every setting with visemes unaffected, verified against the existing
viseme e2e fixture. Glyphs stay welded to the skin throughout. `bun run eval`
overall pass at `f = 0`.
