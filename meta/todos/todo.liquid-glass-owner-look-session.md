---
node: hologlyph.runtime.shaders
status: blocked
created: 2026-07-27
---

# Owner look session over the five gated labs

Not an engineering item, and the reason `cairn brief` has nothing to offer.
This is next unit of work 1 in `dec.liquid-glass-architecture`, and it needs the
owner, not an agent. It is tracked here so the gate is visible in the backlog
rather than buried in a decision artefact.

Five features shipped between 2026-07-26 and 2026-07-27, every one of them
deliberately gated to zero and reachable only from a lab page. That was the
plan: land the mechanism, defer the look, and settle all five in one sitting
against the two criteria in `dec.liquid-glass-architecture`, that it must look
great and it must feel authentic.

Run `bun run dev`, then walk these in order. Each ships off; each has a slider
that takes it to full.

| Lab | Knob | What to rule on |
| --- | --- | --- |
| `demo/pool-lab.html` | `pool.amount`, 0 | The waterline at the bust base: ripple scale, meniscus, and whether the head emerging from it reads as water or as a mirror |
| `demo/lens-lab.html` | `lens.amount`, gated by a bound `refract` element | Whether true per-pixel lensing beats the shipped flat-colour adaptation enough to justify the host naming a subtree |
| `demo/interior-glyph-lab.html` | `interior.count`, 0 | Glyphs suspended inside the glass: density, drift, and whether they fight the surface text |
| `demo/fluid-lab.html` | `fluid.amount`, 0 | Sag and wobble on the rig. Check a viseme sentence at every setting, since the whole tier 3 argument is that the mouth stays exact |
| `demo/stage-lab.html` | `stage.amount` plus marked participants | Whether the head squeezing against page elements reads as physics or as a glitch. Needs `fluid.amount` above zero to show anything, so judge it after the fluid lab |

What a ruling looks like: for each lab, either a default value to ship, or
"stays at zero", plus anything that has to change first. Record the outcome as a
source artefact under `meta/sources/`, the way
`src.owner-approved-look-2026-07-21` recorded the last one, and open a todo per
accepted default. Do not change a shipped default without that artefact.

Two of these interact and should not be judged in isolation: `fluid.amount`
moves the surface the interior glyphs are suspended behind, and `pool.amount`
sets the waterline the stage participants dent. If both are approved, look at
them together once before fixing either default.

Acceptance: a ruling on all five, recorded as a source artefact, and this todo
set to done.
